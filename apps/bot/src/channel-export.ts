import { snowflake } from "@orbit/core";
import { ChannelType, PermissionFlagsBits, Routes } from "discord.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const bitfield = z.string().regex(/^\d+$/).max(100);
const guildSchema = z.object({
  id: snowflake,
  name: z.string(),
  owner_id: snowflake,
});
const roleSchema = z.object({
  id: snowflake,
  name: z.string(),
  position: z.number().int(),
  managed: z.boolean(),
  permissions: bitfield,
});
const overwriteSchema = z.object({
  id: snowflake,
  type: z.union([z.literal(0), z.literal(1)]),
  allow: bitfield,
  deny: bitfield,
});
const channelSchema = z.object({
  id: snowflake,
  guild_id: snowflake.optional(),
  name: z.string(),
  type: z.number().int().nonnegative(),
  position: z.number().int().optional(),
  parent_id: snowflake.nullable().optional(),
  permission_overwrites: z.array(overwriteSchema).optional(),
});
type RawChannel = z.infer<typeof channelSchema>;
type RawOverwrite = z.infer<typeof overwriteSchema>;

// Prefer the current name when Discord.js exposes a deprecated flag alias.
const namesByBit = new Map<bigint, string>();
for (const [name, bits] of Object.entries(PermissionFlagsBits))
  if (!namesByBit.has(bits) || name === "ManageGuildExpressions")
    namesByBit.set(bits, name);
const flags = [...namesByBit.entries()].sort(([a], [b]) =>
  a < b ? -1 : a > b ? 1 : 0
);
const knownMask = flags.reduce((mask, [bits]) => mask | bits, 0n);
export function exportPermissionBits(value: string) {
  const raw = bitfield.parse(value);
  const bits = BigInt(raw);
  return {
    bitfield: raw,
    names: flags
      .filter(([flag]) => (bits & flag) === flag)
      .map(([, name]) => name),
    unknownBitfield: (bits & ~knownMask).toString(),
  };
}
function byId(a: { id: string }, b: { id: string }) {
  return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;
}
function normalizeOverwrites(overwrites: RawOverwrite[]) {
  return overwrites
    .map((o) => `${o.type}:${o.id}:${BigInt(o.allow)}:${BigInt(o.deny)}`)
    .sort();
}
function overwritesMatch(a: RawChannel, b: RawChannel | undefined) {
  if (!b || !a.permission_overwrites || !b.permission_overwrites) return null;
  return (
    JSON.stringify(normalizeOverwrites(a.permission_overwrites)) ===
    JSON.stringify(normalizeOverwrites(b.permission_overwrites))
  );
}
const threadTypes = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);
function typeName(type: number) {
  if (type === ChannelType.GuildAnnouncement) return "GuildAnnouncement";
  return ChannelType[type] ?? `Unknown_${type}`;
}
export type ChannelExportSelection = { guildId: string; channelId?: string };

/** Whitelist metadata rather than exporting raw REST responses or SDK objects. */
export function buildChannelPermissionExport(
  input: { guild: unknown; roles: unknown; channels: unknown },
  selection: ChannelExportSelection,
  exportedAt = new Date()
) {
  const guildId = snowflake.parse(selection.guildId);
  const channelId =
    selection.channelId !== undefined
      ? snowflake.parse(selection.channelId)
      : undefined;
  const guild = guildSchema.parse(input.guild);
  const roles = z.array(roleSchema).parse(input.roles);
  const allChannels = z.array(channelSchema).parse(input.channels);
  if (
    guild.id !== guildId ||
    allChannels.some((c) => c.guild_id && c.guild_id !== guildId)
  )
    throw new Error(
      "Discord returned data for a different server; no export was written."
    );
  if (
    new Set(roles.map((r) => r.id)).size !== roles.length ||
    new Set(allChannels.map((c) => c.id)).size !== allChannels.length
  )
    throw new Error(
      "Discord returned duplicate role or channel IDs; retry the export."
    );
  const channels = allChannels.filter((c) => !threadTypes.has(c.type));
  const requested = channelId
    ? channels.find((c) => c.id === channelId)
    : undefined;
  if (channelId && !requested)
    throw new Error(
      "That channel was not returned for this server. Check the IDs and bot access. Thread exports are not supported."
    );
  const byChannelId = new Map(channels.map((c) => [c.id, c]));
  const byRoleId = new Map(roles.map((r) => [r.id, r]));
  const warnings: { code: string; channelId?: string; targetId?: string }[] =
    [];
  const included = new Set(channelId ? [channelId] : channels.map((c) => c.id));
  const contextChannelIds: string[] = [];
  if (requested?.parent_id) {
    const parent = byChannelId.get(requested.parent_id);
    if (parent) {
      included.add(parent.id);
      contextChannelIds.push(parent.id);
    } else
      warnings.push({ code: "PARENT_NOT_RETURNED", channelId: requested.id });
  }
  if (!byRoleId.has(guildId))
    warnings.push({ code: "EVERYONE_ROLE_NOT_RETURNED" });
  const selected = channels
    .filter((c) => included.has(c.id))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || byId(a, b));
  return {
    format: "orbit.discord-channel-permissions",
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    source: "discord-rest-api",
    guild: {
      id: guild.id,
      name: guild.name,
      ownerId: guild.owner_id,
      everyoneRoleId: guild.id,
    },
    selection: { channelId: channelId ?? null, contextChannelIds },
    limitations: [
      "Configured role permissions and explicit channel overwrites only; not calculated per-member effective permissions.",
      "Unset overwrite bits are unspecified/inherited, not an explicit deny or grant. Administrator and owner bypasses are not expanded.",
      "Threads, thread membership, member role assignments, messages, channel topics, webhooks, tokens, and secrets are not included.",
      "Multiple read-only REST requests are not an atomic snapshot. Concurrent Discord changes may require another export.",
      "This is a diagnostic export, not an import/restore file or a full server backup.",
    ],
    permissionFlags: Object.fromEntries(
      flags.map(([bits, name]) => [name, bits.toString()])
    ),
    roles: [...roles]
      .sort((a, b) => b.position - a.position || byId(a, b))
      .map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        managed: r.managed,
        permissions: exportPermissionBits(r.permissions),
      })),
    channels: selected.map((c) => {
      if (!c.permission_overwrites)
        warnings.push({ code: "OVERWRITES_NOT_RETURNED", channelId: c.id });
      if (
        c.parent_id &&
        !byChannelId.has(c.parent_id) &&
        !warnings.some(
          (w) => w.code === "PARENT_NOT_RETURNED" && w.channelId === c.id
        )
      )
        warnings.push({ code: "PARENT_NOT_RETURNED", channelId: c.id });
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        typeName: typeName(c.type),
        position: c.position ?? null,
        parentId: c.parent_id ?? null,
        overwritesMatchParent: c.parent_id
          ? overwritesMatch(c, byChannelId.get(c.parent_id))
          : null,
        permissionOverwrites: c.permission_overwrites
          ? [...c.permission_overwrites]
              .sort((a, b) => a.type - b.type || byId(a, b))
              .map((o) => {
                const role = o.type === 0 ? byRoleId.get(o.id) : undefined;
                if (o.type === 0 && !role)
                  warnings.push({
                    code: "OVERWRITE_ROLE_NOT_RETURNED",
                    channelId: c.id,
                    targetId: o.id,
                  });
                return {
                  id: o.id,
                  type: o.type,
                  targetType: o.type === 0 ? "role" : "member",
                  targetName: role?.name ?? null,
                  allow: exportPermissionBits(o.allow),
                  deny: exportPermissionBits(o.deny),
                };
              })
          : null,
      };
    }),
    warnings,
  };
}
export type ChannelPermissionExport = ReturnType<
  typeof buildChannelPermissionExport
>;
export type ReadOnlyDiscordApi = { get(route: `/${string}`): Promise<unknown> };
export async function collectChannelPermissionExport(
  api: ReadOnlyDiscordApi,
  selection: ChannelExportSelection,
  now: () => Date = () => new Date()
) {
  const guildId = snowflake.parse(selection.guildId);
  if (selection.channelId !== undefined) snowflake.parse(selection.channelId);
  // No gateway login, privileged intents, members lookup, or mutation endpoints.
  const [guild, roles, channels] = await Promise.all([
    api.get(Routes.guild(guildId)),
    api.get(Routes.guildRoles(guildId)),
    api.get(Routes.guildChannels(guildId)),
  ]);
  return buildChannelPermissionExport(
    { guild, roles, channels },
    selection,
    now()
  );
}

export function parseChannelExportArgs(args: string[]) {
  const { values, tokens } = parseArgs({
    args,
    options: {
      guild: { type: "string" },
      channel: { type: "string" },
      out: { type: "string" },
      stdout: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  if (values.help) return { help: true } as const;
  const used = new Set<string>();
  for (const token of tokens)
    if (token.kind === "option") {
      if (used.has(token.name))
        throw new Error(`Provide --${token.name} only once.`);
      used.add(token.name);
    }
  if (!values.guild || !snowflake.safeParse(values.guild).success)
    throw new Error(
      "Provide --guild with a valid 17–20 digit Discord server ID."
    );
  if (
    values.channel !== undefined &&
    !snowflake.safeParse(values.channel).success
  )
    throw new Error(
      "Provide --channel with a valid 17–20 digit Discord channel ID."
    );
  if (values.stdout && values.out !== undefined)
    throw new Error("Choose either --out or --stdout, not both.");
  if (
    values.out !== undefined &&
    (!values.out.trim() || values.out.includes("\0"))
  )
    throw new Error("Provide a nonempty file path for --out.");
  return {
    help: false,
    guildId: values.guild,
    channelId: values.channel,
    out: values.out,
    stdout: values.stdout,
  } as const;
}
export async function writeChannelPermissionExport(
  data: ChannelPermissionExport,
  out?: string
) {
  const timestamp = data.exportedAt.replace(/[:.]/g, "-");
  const path = resolve(
    out ?? `.exports/channels-${data.guild.id}-${timestamp}.json`
  );
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Exclusive creation: never truncate a previous export or follow a file symlink.
  try {
    await writeFile(path, json, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    )
      throw new Error(
        "The output file already exists. Choose another --out path; existing files are never overwritten."
      );
    throw error;
  }
  return path;
}

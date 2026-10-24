import { ChannelType, PermissionFlagsBits as P, Routes } from "discord.js";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChannelPermissionExport,
  collectChannelPermissionExport,
  exportPermissionBits,
  parseChannelExportArgs,
  writeChannelPermissionExport,
} from "../apps/bot/src/channel-export";

const guildId = "120000000000000001";
const roleId = "120000000000000201";
const memberId = "120000000000000099";
const categoryId = "120000000000000301";
const textId = "120000000000000302";
const voiceId = "120000000000000303";
const at = new Date("2026-10-24T12:00:00.000Z");
const baseOverwrites = () => [
  { id: guildId, type: 0, allow: "0", deny: P.ViewChannel.toString() },
  {
    id: roleId,
    type: 0,
    allow: (P.ViewChannel | P.SendMessages).toString(),
    deny: "0",
  },
];
function channel(id: string, type: number, parentId: string | null = null) {
  return {
    id,
    guild_id: guildId,
    name: `channel-${id.slice(-3)}`,
    type,
    parent_id: parentId,
    position: 0,
    permission_overwrites: baseOverwrites(),
  };
}
function fixture() {
  return {
    guild: { id: guildId, name: "Test server", owner_id: memberId },
    roles: [
      {
        id: guildId,
        name: "@everyone",
        position: 0,
        managed: false,
        permissions: (P.ViewChannel | P.SendMessages).toString(),
      },
      {
        id: roleId,
        name: "Community",
        position: 2,
        managed: false,
        permissions: P.Connect.toString(),
      },
    ],
    channels: [
      channel(categoryId, ChannelType.GuildCategory),
      channel(textId, ChannelType.GuildText, categoryId),
      channel(voiceId, ChannelType.GuildVoice),
    ],
  };
}
const build = (data = fixture(), channelId?: string) =>
  buildChannelPermissionExport(data, { guildId, channelId }, at);

describe("read-only Discord channel permission export", () => {
  it("exports raw role baselines and channel overwrites without calculating effective permissions", () => {
    const data = build();
    expect(data.format).toBe("orbit.discord-channel-permissions");
    expect(data.exportedAt).toBe(at.toISOString());
    expect(data.guild.everyoneRoleId).toBe(guildId);
    expect(data.roles.find((r) => r.id === guildId)?.permissions.names).toEqual(
      ["ViewChannel", "SendMessages"]
    );
    expect(
      data.channels
        .find((c) => c.id === textId)
        ?.permissionOverwrites?.find((o) => o.id === guildId)?.deny.names
    ).toEqual(["ViewChannel"]);
    expect(JSON.stringify(data)).not.toContain('"effectivePermissions"');
    expect(data.warnings).toEqual([]);
  });

  it("preserves bits beyond Number.MAX_SAFE_INTEGER and unknown future permissions", () => {
    const future = 1n << 63n;
    const bits = (future | P.SendMessages).toString();
    expect(exportPermissionBits(bits)).toEqual({
      bitfield: bits,
      names: ["SendMessages"],
      unknownBitfield: future.toString(),
    });
    const raw = fixture();
    raw.roles[0].permissions = bits;
    expect(
      JSON.parse(JSON.stringify(build(raw))).roles.find(
        (r: { id: string }) => r.id === guildId
      ).permissions.bitfield
    ).toBe(bits);
  });

  it("does not expand Administrator or turn unset bits into an explicit deny", () => {
    expect(exportPermissionBits(P.Administrator.toString()).names).toEqual([
      "Administrator",
    ]);
    expect(exportPermissionBits("0")).toEqual({
      bitfield: "0",
      names: [],
      unknownBitfield: "0",
    });
    expect(
      exportPermissionBits(P.ManageGuildExpressions.toString()).names
    ).toEqual(["ManageGuildExpressions"]);
  });

  it("preserves member-specific overwrites without requesting or inventing member names", () => {
    const raw = fixture();
    raw.channels[1].permission_overwrites.push({
      id: memberId,
      type: 1,
      allow: "0",
      deny: P.SendMessages.toString(),
    });
    const overwrite = build(raw)
      .channels.find((c) => c.id === textId)
      ?.permissionOverwrites?.find((o) => o.id === memberId);
    expect(overwrite).toMatchObject({
      id: memberId,
      type: 1,
      targetType: "member",
      targetName: null,
      deny: { names: ["SendMessages"] },
    });
  });

  it("includes a requested channel and its parent, but no unrelated channels", () => {
    const data = build(fixture(), textId);
    expect(data.channels.map((c) => c.id).sort()).toEqual([categoryId, textId]);
    expect(data.selection).toEqual({
      channelId: textId,
      contextChannelIds: [categoryId],
    });
    expect(data.roles).toHaveLength(2);
  });

  it("exports a selected category alone, not an undocumented recursive subtree", () => {
    expect(build(fixture(), categoryId).channels.map((c) => c.id)).toEqual([
      categoryId,
    ]);
  });

  it("compares parent overwrites independently of API order", () => {
    const raw = fixture();
    raw.channels[1].permission_overwrites.reverse();
    expect(
      build(raw).channels.find((c) => c.id === textId)?.overwritesMatchParent
    ).toBe(true);
    raw.channels[1].permission_overwrites.push({
      id: memberId,
      type: 1,
      allow: "0",
      deny: P.SendMessages.toString(),
    });
    expect(
      build(raw).channels.find((c) => c.id === textId)?.overwritesMatchParent
    ).toBe(false);
    expect(
      build(raw).channels.find((c) => c.id === voiceId)?.overwritesMatchParent
    ).toBeNull();
  });

  it("reports omitted overwrite data as unknown, not an empty or inherited policy", () => {
    const raw = fixture();
    const { permission_overwrites: _overwrites, ...missing } = raw.channels[1];
    const data = buildChannelPermissionExport(
      { ...raw, channels: [raw.channels[0], missing] },
      { guildId },
      at
    );
    expect(data.channels.find((c) => c.id === textId)).toMatchObject({
      permissionOverwrites: null,
      overwritesMatchParent: null,
    });
    expect(data.warnings).toContainEqual({
      code: "OVERWRITES_NOT_RETURNED",
      channelId: textId,
    });
  });

  it("preserves genuinely empty overwrite arrays", () => {
    const raw = fixture();
    raw.channels[0].permission_overwrites = [];
    raw.channels[1].permission_overwrites = [];
    const data = build(raw);
    expect(data.channels.find((c) => c.id === textId)).toMatchObject({
      permissionOverwrites: [],
      overwritesMatchParent: true,
    });
    expect(data.warnings).toEqual([]);
  });

  it("preserves unresolved role overwrites and warns about a non-atomic snapshot", () => {
    const raw = fixture();
    raw.roles = raw.roles.filter((r) => r.id !== roleId);
    const data = build(raw);
    expect(
      data.channels[0].permissionOverwrites?.find((o) => o.id === roleId)
        ?.targetName
    ).toBeNull();
    expect(data.warnings).toContainEqual({
      code: "OVERWRITE_ROLE_NOT_RETURNED",
      channelId: categoryId,
      targetId: roleId,
    });
  });

  it("reports a missing parent rather than fabricating category permissions", () => {
    const raw = fixture();
    raw.channels = raw.channels.filter((c) => c.id !== categoryId);
    const data = build(raw, textId);
    expect(data.channels).toHaveLength(1);
    expect(data.channels[0].overwritesMatchParent).toBeNull();
    expect(data.warnings).toContainEqual({
      code: "PARENT_NOT_RETURNED",
      channelId: textId,
    });
  });

  it.each([
    [ChannelType.GuildText, "GuildText"],
    [ChannelType.GuildVoice, "GuildVoice"],
    [ChannelType.GuildCategory, "GuildCategory"],
    [ChannelType.GuildAnnouncement, "GuildAnnouncement"],
    [ChannelType.GuildStageVoice, "GuildStageVoice"],
    [ChannelType.GuildForum, "GuildForum"],
    [ChannelType.GuildMedia, "GuildMedia"],
    [999, "Unknown_999"],
  ])(
    "retains channel type %i (%s) rather than flattening everything to text",
    (type, name) => {
      const data = buildChannelPermissionExport(
        { ...fixture(), channels: [channel(textId, type as number)] },
        { guildId },
        at
      );
      expect(data.channels[0]).toMatchObject({ type, typeName: name });
    }
  );

  it("does not export unexpected thread records as ordinary channels", () => {
    const raw = fixture();
    raw.channels.push(
      channel("120000000000000304", ChannelType.PrivateThread, textId)
    );
    expect(build(raw).channels).toHaveLength(3);
    expect(() => build(raw, "120000000000000304")).toThrow(
      "Thread exports are not supported"
    );
  });

  it("rejects channels not in the requested guild and mismatched guild responses", () => {
    expect(() => build(fixture(), "990000000000000001")).toThrow(
      "not returned for this server"
    );
    const raw = fixture();
    raw.guild.id = "990000000000000001";
    expect(() => build(raw)).toThrow("different server");
    const other = fixture();
    other.channels[0].guild_id = "990000000000000001";
    expect(() => build(other)).toThrow("different server");
  });

  it("rejects duplicate IDs and malformed masks rather than silently losing data", () => {
    const raw = fixture();
    raw.channels.push(raw.channels[0]);
    expect(() => build(raw)).toThrow("duplicate");
    expect(() => exportPermissionBits("-1")).toThrow();
    expect(() => exportPermissionBits("not-permissions")).toThrow();
  });

  it("whitelists configuration metadata instead of exporting raw tokens or other fields", () => {
    const raw = fixture();
    const data = buildChannelPermissionExport(
      {
        guild: { ...raw.guild, token: "secret-not-to-export" },
        roles: raw.roles.map((r) => ({
          ...r,
          internal_secret: "secret-not-to-export",
        })),
        channels: raw.channels.map((c) => ({
          ...c,
          topic: "secret-not-to-export",
          messages: ["secret-not-to-export"],
          webhook_url: "secret-not-to-export",
        })),
      },
      { guildId },
      at
    );
    expect(JSON.stringify(data)).not.toContain("secret-not-to-export");
  });

  it("uses exactly three server-scoped GET requests and no gateway or mutation API", async () => {
    const raw = fixture();
    const get = vi.fn(async (route: `/${string}`) => {
      if (route === Routes.guild(guildId)) return raw.guild;
      if (route === Routes.guildRoles(guildId)) return raw.roles;
      if (route === Routes.guildChannels(guildId)) return raw.channels;
      throw new Error("Unexpected endpoint");
    });
    const data = await collectChannelPermissionExport(
      { get },
      { guildId },
      () => at
    );
    expect(data.channels).toHaveLength(3);
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      Routes.guild(guildId),
      Routes.guildRoles(guildId),
      Routes.guildChannels(guildId),
    ]);
  });

  it("validates server and channel IDs before any REST request", async () => {
    const get = vi.fn();
    await expect(
      collectChannelPermissionExport({ get }, { guildId: "../another-server" })
    ).rejects.toThrow();
    await expect(
      collectChannelPermissionExport({ get }, { guildId, channelId: "" })
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it("propagates missing-access or transport errors instead of returning a partial export", async () => {
    const get = vi.fn(async () => {
      throw new Error("Missing Access");
    });
    await expect(
      collectChannelPermissionExport({ get }, { guildId })
    ).rejects.toThrow("Missing Access");
  });
});

describe("channel export command-line and file safety", () => {
  const folders: string[] = [];
  afterEach(async () => {
    for (const folder of folders.splice(0))
      await rm(folder, { recursive: true, force: true });
  });
  async function folder() {
    const path = await mkdtemp(join(tmpdir(), "orbit-channel-export-"));
    folders.push(path);
    return path;
  }

  it("supports explicit server/channel selection and new output paths", () => {
    expect(
      parseChannelExportArgs([
        "--guild",
        guildId,
        "--channel",
        textId,
        "--out",
        "my export.json",
      ])
    ).toEqual({
      help: false,
      guildId,
      channelId: textId,
      rolesOnly: false,
      out: "my export.json",
      stdout: false,
    });
    expect(
      parseChannelExportArgs(["--guild", guildId, "--stdout"])
    ).toMatchObject({ stdout: true });
    expect(parseChannelExportArgs(["--help"])).toEqual({ help: true });
  });

  it.each([
    [],
    ["--guild", "wrong"],
    ["--guild", guildId, "--channel", ""],
    ["--guild", guildId, "--channel", "not-an-id"],
    ["--guild", guildId, "--stdout", "--out", "file.json"],
    ["--guild", guildId, "--out", ""],
    ["--guild", guildId, "--guild", "990000000000000001"],
    ["--guild", guildId, "--token", "do-not-put-tokens-on-command-lines"],
  ])("rejects ambiguous or unsafe arguments (%j)", (...args) => {
    expect(() => parseChannelExportArgs(args)).toThrow();
  });

  it("writes parseable JSON to a new private file, creating parent directories", async () => {
    const path = join(await folder(), "nested", "channels.json");
    expect(await writeChannelPermissionExport(build(), path)).toBe(path);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed.guild.id).toBe(guildId);
    expect(parsed.channels).toHaveLength(3);
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("never overwrites an existing output file", async () => {
    const path = join(await folder(), "keep.json");
    await writeFile(path, "keep this data");
    await expect(writeChannelPermissionExport(build(), path)).rejects.toThrow(
      "already exists"
    );
    expect(await readFile(path, "utf8")).toBe("keep this data");
  });

  it.skipIf(process.platform === "win32")(
    "does not follow an output-file symlink",
    async () => {
      const dir = await folder();
      const target = join(dir, "target.json");
      const path = join(dir, "link.json");
      await writeFile(target, "keep this data");
      await symlink(target, path);
      await expect(writeChannelPermissionExport(build(), path)).rejects.toThrow(
        "already exists"
      );
      expect(await readFile(target, "utf8")).toBe("keep this data");
    }
  );

  it("offers real CLI help without live credentials or services", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "apps/bot/src/export-channels.ts", "--help"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, DEMO_MODE: "true", DISCORD_TOKEN: "" },
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("channels:export");
    expect(result.stderr).toBe("");
  });

  it("refuses real network exports in demo mode without writing fake JSON", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "apps/bot/src/export-channels.ts",
        "--guild",
        guildId,
        "--stdout",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          DEMO_MODE: "true",
          DISCORD_TOKEN: "private-test-token",
        },
      }
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Set DEMO_MODE=false");
    expect(result.stderr).not.toContain("private-test-token");
  });
});

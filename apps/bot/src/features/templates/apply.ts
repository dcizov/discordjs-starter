import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import {
  buildTemplate,
  previewTemplate,
  templateChannelTypes,
  type GuildApplyTarget,
  type TemplatePlan,
} from "@orbit/core/templates";
import {
  getGuild,
  getTemplate,
  getTemplateRun,
  saveConfig,
  saveTemplate,
  updateTemplateRun,
} from "@orbit/db";
import {
  ChannelType,
  PermissionsBitField,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";

/**
 * Bot-side half of server templates.
 *
 * The dashboard cannot read a guild's permission overwrites — Orbit's own snapshot
 * deliberately stores only effective bot permissions per channel — so a template
 * is *captured* here, from the live structure Discord owns, and *applied* here,
 * because only the bot has the Discord session that can create the resources.
 *
 * Both halves are deliberately dumb about policy: the document schema, the
 * preview and the fingerprint all live in `@orbit/core/templates`, so the plan an
 * operator approved is the plan this module executes.
 */

const TYPE_MAP: Record<string, (typeof templateChannelTypes)[number]> = {
  text: "text",
  voice: "voice",
  category: "category",
  forum: "forum",
  stage: "stage",
  media: "media",
};

export function channelTemplateType(
  channel: GuildBasedChannel
): (typeof templateChannelTypes)[number] | null {
  switch (channel.type) {
    case ChannelType.GuildText:
    case ChannelType.GuildAnnouncement:
      return TYPE_MAP.text;
    case ChannelType.GuildVoice:
      return TYPE_MAP.voice;
    case ChannelType.GuildCategory:
      return TYPE_MAP.category;
    case ChannelType.GuildForum:
      return TYPE_MAP.forum;
    case ChannelType.GuildStageVoice:
      return TYPE_MAP.stage;
    case ChannelType.GuildMedia:
      return TYPE_MAP.media;
    default:
      return null;
  }
}

/** Read the live structure a template is captured from. */
export function captureStructure(guild: Guild) {
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => !channel.isThread())
    .flatMap((channel) => {
      const type = channelTemplateType(channel);
      if (!type) return [];
      const overwrites =
        "permissionOverwrites" in channel && channel.permissionOverwrites
          ? [...channel.permissionOverwrites.cache.values()].map(
              (overwrite) => ({
                // `id === guild.id` is the @everyone overwrite.
                targetId:
                  overwrite.type === 0 && overwrite.id === guild.id
                    ? "*everyone"
                    : overwrite.id,
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString(),
              })
            )
          : [];
      return [
        {
          id: channel.id,
          name: channel.name,
          type,
          topic: "topic" in channel ? (channel.topic ?? null) : null,
          nsfw: "nsfw" in channel ? !!channel.nsfw : false,
          parentId: channel.parentId,
          overwrites,
        },
      ];
    });
  const roles = [...guild.roles.cache.values()].map((role) => ({
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    managed: role.managed,
  }));
  return { roles, channels };
}

export type CapturedTemplate = {
  id: string;
  name: string;
  description: string;
  sourceGuildId: string;
};

/**
 * Capture a template from a live guild and store it.
 *
 * Called from the action consumer, so the name and inclusion choices come from a
 * dashboard request that was already authorized for this guild. Nothing secret is
 * read: no tokens, no webhook URLs, no member data.
 */
export async function captureTemplate(
  guild: Guild,
  input: {
    name: string;
    description?: string;
    include: { structure?: boolean; config?: boolean };
    actorId: string;
  }
): Promise<CapturedTemplate> {
  const stored = await getGuild(guild.id);
  if (!stored)
    throw new Error("This server is not synchronized yet; try again.");
  const document = buildTemplate({
    name: input.name,
    description: input.description,
    include: input.include,
    structure: captureStructure(guild),
    config: stored.config,
  });
  const saved = await saveTemplate({
    sourceGuildId: guild.id,
    name: document.name,
    description: document.description,
    createdBy: input.actorId,
    document,
  });
  logger.info(
    {
      guildId: guild.id,
      templateId: saved.id,
      roles: document.structure?.roles.length ?? 0,
      channels: document.structure?.channels.length ?? 0,
      omitted: document.omitted.length,
    },
    "Template captured"
  );
  return {
    id: saved.id,
    name: saved.name,
    description: saved.description,
    sourceGuildId: saved.sourceGuildId,
  };
}

/** The live target shape the pure preview function needs. */
export function applyTarget(guild: Guild): GuildApplyTarget {
  const me = guild.members.me;
  return {
    id: guild.id,
    name: guild.name,
    botRolePosition: me?.roles?.highest?.position ?? 0,
    botPermissions: me?.permissions?.bitfield?.toString() ?? "0",
    roles: [...guild.roles.cache.values()].map((role) => ({
      id: role.id,
      name: role.name,
      managed: role.managed,
      position: role.position,
    })),
    channels: [...guild.channels.cache.values()]
      .filter((channel) => !channel.isThread())
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channelTemplateType(channel) ?? "other",
        parentId: channel.parentId,
      })),
  };
}

const CHANNEL_TYPE: Record<string, ChannelType> = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
  media: ChannelType.GuildMedia,
};

export type ApplyResult = {
  state: "completed" | "partial" | "failed" | "stale";
  created: {
    key: string;
    name: string;
    id: string;
    kind: "role" | "channel";
  }[];
  reused: { key: string; name: string; id: string; kind: "role" | "channel" }[];
  configured: string[];
  failed: { key: string; name: string; error: string }[];
  message: string;
};

/**
 * Apply a previewed template to one target guild.
 *
 * Semantics, in the order they matter:
 *
 * 1. **Revalidate.** The plan is recomputed from the live guild. If the decisions
 *    differ from the ones the operator approved, nothing is touched and the run is
 *    reported as stale. Permissions and structure can change between preview and
 *    apply, so the second look is not optional.
 * 2. **Additive only.** Missing roles and channels are created; anything that
 *    already has the same name and type is reused. Nothing is deleted, renamed or
 *    overwritten, and `Administrator` is never granted (it is stripped when the
 *    template is captured, and again here).
 * 3. **Idempotent.** Reuse-by-name means a retry after a partial failure creates
 *    only what is still missing, so a double submission cannot duplicate a channel.
 * 4. **Bounded.** One resource at a time with Discord's own backoff; the run row is
 *    updated after each step so progress is real rather than optimistic.
 */
export async function applyTemplateRun(
  guild: Guild,
  input: {
    templateId: string;
    runId: string;
    fingerprint: string;
    mapping?: Record<string, string>;
  }
): Promise<ApplyResult> {
  const run = await getTemplateRun(input.runId);
  if (!run) throw new Error("This apply run no longer exists.");
  if (run.state !== "queued" && run.state !== "running")
    throw new Error(
      "This apply run was already finished; start a new preview."
    );
  const template = await getTemplate(
    input.templateId,
    [guild.id, run.plan?.sourceGuildId].filter((id): id is string => !!id)
  );
  if (!template) throw new Error("This template is no longer available.");

  await updateTemplateRun(input.runId, { state: "running", error: null });
  const plan: TemplatePlan = previewTemplate({
    template: template.data,
    target: applyTarget(guild),
    mapping: input.mapping,
  });
  if (plan.blockers.length) {
    const message = plan.blockers.map((b) => b.message).join(" ");
    await updateTemplateRun(input.runId, { state: "failed", error: message });
    return {
      state: "failed",
      created: [],
      reused: [],
      configured: [],
      failed: [],
      message,
    };
  }
  if (plan.fingerprint !== input.fingerprint) {
    const message =
      "This server changed since the preview, so nothing was applied. Preview again to see the current plan.";
    await updateTemplateRun(input.runId, { state: "failed", error: message });
    return {
      state: "stale",
      created: [],
      reused: [],
      configured: [],
      failed: [],
      message,
    };
  }

  const created: ApplyResult["created"] = [];
  const reused: ApplyResult["reused"] = [];
  const failed: ApplyResult["failed"] = [];
  const roleIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  const me = guild.members.me;

  for (const item of plan.items) {
    if (item.kind !== "role") continue;
    if (item.action === "reuse" && item.targetId) {
      roleIds.set(item.key, item.targetId);
      reused.push({
        key: item.key,
        name: item.name,
        id: item.targetId,
        kind: "role",
      });
    }
  }
  for (const item of plan.items) {
    if (item.kind !== "channel") continue;
    if (item.action === "reuse" && item.targetId) {
      channelIds.set(item.key, item.targetId);
      reused.push({
        key: item.key,
        name: item.name,
        id: item.targetId,
        kind: "channel",
      });
    }
  }

  // Roles first: channel overwrites reference them.
  for (const role of template.data.structure?.roles ?? []) {
    const item = plan.items.find((i) => i.key === role.key);
    if (!item || item.action !== "create") continue;
    // Last-moment re-check: a retry of this same run must not duplicate a role
    // that the previous attempt already created.
    const existing = guild.roles.cache.find(
      (r) => !r.managed && r.name.toLowerCase() === role.name.toLowerCase()
    );
    if (existing) {
      roleIds.set(role.key, existing.id);
      reused.push({
        key: role.key,
        name: existing.name,
        id: existing.id,
        kind: "role",
      });
      continue;
    }
    try {
      const bits = new PermissionsBitField(BigInt(role.permissions));
      bits.remove(PermissionsBitField.Flags.Administrator);
      const createdRole = await guild.roles.create({
        name: role.name,
        color: (role.color ?? undefined) as `#${string}` | undefined,
        permissions: bits,
        hoist: role.hoist,
        mentionable: role.mentionable,
        reason: `Orbit template “${template.name}”`,
      });
      roleIds.set(role.key, createdRole.id);
      created.push({
        key: role.key,
        name: createdRole.name,
        id: createdRole.id,
        kind: "role",
      });
      await updateTemplateRun(input.runId, {
        state: "running",
        result: { created, reused, failed },
      });
    } catch (error) {
      failed.push({
        key: role.key,
        name: role.name,
        error: errorDiagnostic(error),
      });
    }
  }

  // Categories before the channels that live inside them.
  const channels = template.data.structure?.channels ?? [];
  const ordered = [
    ...channels.filter((c) => c.type === "category"),
    ...channels.filter((c) => c.type !== "category"),
  ];
  for (const channel of ordered) {
    const item = plan.items.find((i) => i.key === channel.key);
    if (!item || item.action !== "create") continue;
    const existing = guild.channels.cache.find(
      (c) =>
        !c.isThread() &&
        c.name.toLowerCase() === channel.name.toLowerCase() &&
        channelTemplateType(c as GuildBasedChannel) === channel.type
    );
    if (existing) {
      channelIds.set(channel.key, existing.id);
      reused.push({
        key: channel.key,
        name: existing.name,
        id: existing.id,
        kind: "channel",
      });
      continue;
    }
    try {
      const parentId = channel.parentKey
        ? channelIds.get(channel.parentKey)
        : undefined;
      if (channel.parentKey && !parentId)
        throw new Error(
          `Its category (${channel.parentKey}) is not available in this server.`
        );
      const type = CHANNEL_TYPE[channel.type];
      const create = {
        name: channel.name,
        type,
        parent: parentId,
        reason: `Orbit template “${template.name}”`,
        ...(channel.type === "category"
          ? {}
          : { topic: channel.topic ?? undefined, nsfw: channel.nsfw }),
      };
      const made = await guild.channels.create(create as never);
      channelIds.set(channel.key, made.id);
      created.push({
        key: channel.key,
        name: made.name,
        id: made.id,
        kind: "channel",
      });
      // Overwrites are applied after creation so a failure here does not leave a
      // half-configured channel that claims to be complete.
      if (channel.overwrites.length) {
        // Applied as one edit with full bitfields, so a permission this code has
        // never heard of still travels with the template.
        const overwrites = channel.overwrites.flatMap((overwrite) => {
          const id =
            overwrite.roleKey === "role:everyone"
              ? guild.id
              : roleIds.get(overwrite.roleKey);
          if (!id) return [];
          return [
            {
              id,
              allow: BigInt(overwrite.allow),
              deny: BigInt(overwrite.deny),
            },
          ];
        });
        if (overwrites.length) {
          try {
            await made.edit({
              permissionOverwrites: overwrites,
              reason: `Orbit template “${template.name}”`,
            });
          } catch (error) {
            failed.push({
              key: `${channel.key}#overwrites`,
              name: `Permission overwrites on ${channel.name}`,
              error: errorDiagnostic(error),
            });
          }
        }
      }
      await updateTemplateRun(input.runId, {
        state: "running",
        result: { created, reused, failed },
      });
    } catch (error) {
      failed.push({
        key: channel.key,
        name: channel.name,
        error: errorDiagnostic(error),
      });
    }
  }

  const configured: string[] = [];
  const config = template.data.config;
  if (config && !failed.length) {
    const stored = await getGuild(guild.id);
    if (stored) {
      const next = structuredClone(stored.config);
      if (config.locale) next.locale = config.locale;
      if (config.timezone) next.timezone = config.timezone;
      Object.assign(next.modules, config.modules ?? {});
      Object.assign(next.economy, config.economy ?? {});
      if (config.music) {
        const { djRoleKey, ...rest } = config.music;
        Object.assign(next.music, rest);
        if (djRoleKey) {
          const id = roleIds.get(djRoleKey);
          if (id) {
            next.music.djRoleId = id;
            configured.push("music.djRoleId");
          }
        }
      }
      if (config.moderation) {
        const { exemptRoleKeys, ...rest } = config.moderation;
        Object.assign(next.moderation, rest);
        if (exemptRoleKeys?.length) {
          const ids = exemptRoleKeys
            .map((key) => roleIds.get(key))
            .filter((id): id is string => !!id);
          if (ids.length) {
            next.moderation.exemptRoleIds = ids;
            configured.push("moderation.exemptRoleIds");
          }
        }
      }
      if (config.bindings?.auditChannelKey) {
        const id = channelIds.get(config.bindings.auditChannelKey);
        if (id) {
          next.auditChannelId = id;
          configured.push("auditChannelId");
        }
      }
      if (config.bindings?.notificationRoleKey) {
        const id = roleIds.get(config.bindings.notificationRoleKey);
        if (id) {
          next.notificationRoleId = id;
          configured.push("notificationRoleId");
        }
      }
      await saveConfig(guild.id, next, {
        id: me?.id ?? guild.client.user.id,
        name: `Orbit template “${template.name}”`,
        avatar: guild.client.user.avatar,
      });
      configured.push("modules", "economy");
    }
  }

  const state: ApplyResult["state"] = failed.length
    ? created.length || reused.length
      ? "partial"
      : "failed"
    : "completed";
  const message = failed.length
    ? `${created.length} created, ${reused.length} reused, ${failed.length} could not be applied. Nothing was deleted; fix the reported permissions and retry — resources that already exist will be reused.`
    : `${created.length} created and ${reused.length} reused. Nothing existing was changed or deleted.`;
  await updateTemplateRun(input.runId, {
    state,
    result: { created, reused, failed, configured },
    error: failed.length
      ? failed.map((f) => `${f.name}: ${f.error}`).join(" ")
      : null,
  });
  logger.info(
    {
      guildId: guild.id,
      templateId: template.id,
      runId: input.runId,
      created: created.length,
      reused: reused.length,
      failed: failed.length,
    },
    "Template apply finished"
  );
  return { state, created, reused, configured, failed, message };
}

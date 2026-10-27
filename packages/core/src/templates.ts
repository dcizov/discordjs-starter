import { z } from "zod";
import type { GuildConfig } from "./types";

/**
 * A portable blueprint of a Discord server's structure, plus the Orbit settings
 * that belong to that structure.
 *
 * **Why this is not Discord's server template.** Discord's own template link
 * copies channels and roles between servers and nothing else: it has no concept
 * of Orbit's modules, currency, DJ role, audit channel or self-role panels, and
 * it cannot be edited, previewed against a specific target or applied from a
 * dashboard. Orbit templates are application-managed documents that additionally
 * carry the Orbit configuration that refers to those channels and roles. Anything
 * Discord itself owns (member lists, messages, audit history) is not portable and
 * is not included — see `TEMPLATE_OMISSIONS`.
 *
 * **Portable by construction.** Nothing in this document stores a Discord snowflake
 * except as an optional note: roles and channels are addressed by stable logical
 * keys (`role:moderator`, `channel:general`). Applying a template maps those keys
 * onto the target guild, so a template can move between servers — and so a
 * template id can never be used to read another guild's live structure.
 *
 * **Bounded and versioned.** Every array has a maximum length and the document
 * carries `version`, so an old or hand-edited document is rejected rather than
 * half-applied.
 */
export const TEMPLATE_SCHEMA_VERSION = 1;
export const TEMPLATE_LIMITS = {
  roles: 100,
  channels: 200,
  overwritesPerChannel: 50,
  nameLength: 100,
  descriptionLength: 500,
  topicLength: 1024,
  documentBytes: 256_000,
} as const;

const roleKey = z.string().regex(/^role:[a-z0-9][a-z0-9-]{0,40}$/);
const channelKey = z.string().regex(/^channel:[a-z0-9][a-z0-9-]{0,40}$/);

const permissionBits = z
  .string()
  .regex(/^\d{1,20}$/)
  .describe("Discord permission bitfield as a decimal string");

export const templateChannelTypes = [
  "text",
  "voice",
  "category",
  "forum",
  "stage",
  "media",
] as const;
export type TemplateChannelType = (typeof templateChannelTypes)[number];

export const templateOverwriteSchema = z
  .object({
    /** `role:everyone` is the @everyone overwrite, which has no role key of its own. */
    roleKey: z.union([roleKey, z.literal("role:everyone")]),
    allow: permissionBits,
    deny: permissionBits,
  })
  .strict();

export const templateRoleSchema = z
  .object({
    key: roleKey,
    name: z.string().min(1).max(TEMPLATE_LIMITS.nameLength),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    permissions: permissionBits,
    hoist: z.boolean(),
    mentionable: z.boolean(),
    /** Relative order inside this template; never a Discord position. */
    position: z.number().int().min(0).max(1000),
  })
  .strict();

export const templateChannelSchema = z
  .object({
    key: channelKey,
    name: z.string().min(1).max(TEMPLATE_LIMITS.nameLength),
    type: z.enum(templateChannelTypes),
    /** Logical key of the parent category, if this channel sits in one. */
    parentKey: channelKey.nullable(),
    topic: z.string().max(TEMPLATE_LIMITS.topicLength).nullable(),
    nsfw: z.boolean(),
    position: z.number().int().min(0).max(1000),
    overwrites: z
      .array(templateOverwriteSchema)
      .max(TEMPLATE_LIMITS.overwritesPerChannel),
  })
  .strict();

const partialConfig = {
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(1).max(60).optional(),
  modules: z
    .object({
      roles: z.boolean().optional(),
      moderation: z.boolean().optional(),
      economy: z.boolean().optional(),
      music: z.boolean().optional(),
      deals: z.boolean().optional(),
      news: z.boolean().optional(),
      polls: z.boolean().optional(),
      announcements: z.boolean().optional(),
    })
    .strict()
    .optional(),
  economy: z
    .object({
      currency: z.string().min(1).max(40).optional(),
      symbol: z.string().min(1).max(8).optional(),
      dailyAmount: z.number().int().min(0).max(1_000_000).optional(),
      activityAmount: z.number().int().min(0).max(1_000_000).optional(),
      activityCooldown: z.number().int().min(0).max(86_400).optional(),
      transferEnabled: z.boolean().optional(),
    })
    .strict()
    .optional(),
  music: z
    .object({
      djRoleKey: roleKey.nullable().optional(),
      defaultVolume: z.number().int().min(0).max(100).optional(),
      maxQueue: z.number().int().min(1).max(1000).optional(),
      // 0 is a real setting ("no per-member cap"), not an absent value.
      maxPerMember: z.number().int().min(0).max(1000).optional(),
      idleDisconnectSeconds: z.number().int().min(0).max(3600).optional(),
    })
    .strict()
    .optional(),
  moderation: z
    .object({
      exemptRoleKeys: z.array(roleKey).max(50).optional(),
      escalationThreshold: z.number().int().min(1).max(100).optional(),
      escalationMinutes: z.number().int().min(1).max(10080).optional(),
    })
    .strict()
    .optional(),
  /** Orbit settings that point at a channel or role in *this* structure. */
  bindings: z
    .object({
      auditChannelKey: channelKey.nullable().optional(),
      notificationRoleKey: roleKey.nullable().optional(),
    })
    .strict()
    .optional(),
};

export const templateConfigSchema = z.object(partialConfig).strict();

export const templateStructureSchema = z
  .object({
    roles: z.array(templateRoleSchema).max(TEMPLATE_LIMITS.roles),
    channels: z.array(templateChannelSchema).max(TEMPLATE_LIMITS.channels),
  })
  .strict();

export const serverTemplateSchema = z
  .object({
    version: z.literal(TEMPLATE_SCHEMA_VERSION),
    kind: z.enum(["structure", "configuration", "both"]),
    name: z.string().min(1).max(TEMPLATE_LIMITS.nameLength),
    description: z.string().max(TEMPLATE_LIMITS.descriptionLength),
    createdAt: z.string().datetime(),
    structure: templateStructureSchema.optional(),
    config: templateConfigSchema.optional(),
    /** Fields that were deliberately not captured, named for the reader. */
    omitted: z.array(z.string().max(120)).max(30),
  })
  .strict();

export type ServerTemplateDocument = z.infer<typeof serverTemplateSchema>;
export type TemplateRole = z.infer<typeof templateRoleSchema>;
export type TemplateChannel = z.infer<typeof templateChannelSchema>;
export type TemplateConfig = z.infer<typeof templateConfigSchema>;
export type TemplateOverwrite = z.infer<typeof templateOverwriteSchema>;

/**
 * What a template can never carry, stated once so no surface has to imply
 * otherwise. These are either Discord-owned, secret, or personal.
 */
export const TEMPLATE_OMISSIONS = [
  "Members and their identities",
  "Messages, threads and attachments",
  "Audit history and moderation cases",
  "Economy balances, ledger entries and inventory",
  "Bot tokens, OAuth secrets and session data",
  "Webhook URLs and other delivery credentials",
  "Integration-managed roles (bots, apps, boosts)",
] as const;

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "item";

/** Stable logical keys: `role:moderator`, `channel:general`, deduplicated. */
function keyFactory(prefix: "role" | "channel") {
  const used = new Set<string>();
  return (name: string) => {
    const base = `${prefix}:${slug(name)}`;
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}-${n++}`;
    used.add(key);
    return key;
  };
}

/** A guild shape small enough that the pure functions here own the decision. */
export type GuildStructureInput = {
  roles: {
    id: string;
    name: string;
    color: string;
    position: number;
    permissions: string;
    managed: boolean;
  }[];
  channels: {
    id: string;
    name: string;
    type: "text" | "voice" | "stage" | "category" | "forum" | "media" | "other";
    topic?: string | null;
    nsfw?: boolean;
    parentId?: string | null;
    overwrites?: { targetId: string; allow: string; deny: string }[];
  }[];
};

const ADMINISTRATOR = 8n;

/**
 * Capture a template from a guild structure.
 *
 * Managed roles are dropped (Discord will not let an application create or copy
 * an integration role), and `Administrator` is stripped from every copied role:
 * a blueprint must never be able to hand out full control. Both removals are
 * recorded in `omitted` so the preview can say what was not carried across.
 */
export function buildTemplate(input: {
  name: string;
  description?: string;
  include: { structure?: boolean; config?: boolean };
  structure: GuildStructureInput;
  /**
   * The guild's own configuration. It is mapped onto logical keys here rather
   * than by the caller, so the key scheme exists in exactly one place.
   */
  config?: GuildConfig;
  createdAt?: Date;
}): ServerTemplateDocument {
  const omitted: string[] = [];
  const wantsStructure = input.include.structure !== false;
  const wantsConfig = input.include.config !== false;

  let structure: ServerTemplateDocument["structure"];
  const roleKeyOf = keyFactory("role");
  const channelKeyOf = keyFactory("channel");
  const roleKeys = new Map<string, string>();
  const channelKeyById = new Map<string, string>();
  if (wantsStructure) {
    const categories = input.structure.channels.filter(
      (c) => c.type === "category"
    );
    for (const channel of categories)
      channelKeyById.set(channel.id, channelKeyOf(channel.name));

    let strippedAdministrator = 0;
    const roles: TemplateRole[] = [];
    for (const role of [...input.structure.roles]
      .filter((r) => !r.managed)
      .sort((a, b) => b.position - a.position)) {
      if (!role) continue;
      let bits = BigInt(role.permissions || "0");
      if ((bits & ADMINISTRATOR) === ADMINISTRATOR) {
        bits &= ~ADMINISTRATOR;
        strippedAdministrator += 1;
      }
      const key = roleKeyOf(role.name);
      roleKeys.set(role.id, key);
      roles.push({
        key,
        name: role.name.slice(0, TEMPLATE_LIMITS.nameLength),
        color: /^#[0-9a-f]{6}$/i.test(role.color) ? role.color : null,
        permissions: bits.toString(),
        hoist: false,
        mentionable: false,
        position: 0,
      });
    }
    if (strippedAdministrator)
      omitted.push(
        `Administrator permission on ${strippedAdministrator} role(s) — templates never grant it`
      );

    const channels: TemplateChannel[] = [];
    let skippedTypes = 0;
    for (const channel of input.structure.channels) {
      if (channel.type === "other") {
        skippedTypes += 1;
        continue;
      }
      const key = channelKeyById.get(channel.id) ?? channelKeyOf(channel.name);
      channelKeyById.set(channel.id, key);
      channels.push({
        key,
        name: channel.name.slice(0, TEMPLATE_LIMITS.nameLength),
        type: channel.type,
        parentKey:
          channel.parentId && channel.type !== "category"
            ? (channelKeyById.get(channel.parentId) ?? null)
            : null,
        topic: channel.topic
          ? channel.topic.slice(0, TEMPLATE_LIMITS.topicLength)
          : null,
        nsfw: !!channel.nsfw,
        position:
          channel.type === "category"
            ? categories.findIndex((c) => c.id === channel.id)
            : 0,
        overwrites: (channel.overwrites ?? []).flatMap((overwrite) => {
          const target =
            overwrite.targetId === "*everyone"
              ? "role:everyone"
              : roleKeys.get(overwrite.targetId);
          // An overwrite for a managed role or a member cannot travel; dropping
          // it silently would change who can see what, so it is named instead.
          return target
            ? [
                {
                  roleKey: target as TemplateOverwrite["roleKey"],
                  allow: overwrite.allow,
                  deny: overwrite.deny,
                },
              ]
            : [];
        }),
      });
    }
    if (skippedTypes)
      omitted.push(
        `${skippedTypes} channel(s) of a type Orbit does not create (for example threads or other)`
      );
    const droppedOverwrites =
      input.structure.channels.reduce(
        (n, c) => n + (c.overwrites?.length ?? 0),
        0
      ) - channels.reduce((n, c) => n + c.overwrites.length, 0);
    if (droppedOverwrites)
      omitted.push(
        `${droppedOverwrites} permission overwrite(s) that belonged to members or integration roles`
      );
    if (input.structure.roles.some((r) => r.managed))
      omitted.push("Integration-managed roles (bots, apps, boosts)");
    structure = { roles, channels };
  }

  let config: TemplateConfig | undefined;
  if (wantsConfig && input.config) {
    const source = input.config;
    const roleKey = (id: string) => roleKeys.get(id) ?? null;
    const channelKey = (id: string) => channelKeyById.get(id) ?? null;
    config = templateConfigSchema.parse({
      locale: source.locale,
      timezone: source.timezone,
      modules: { ...source.modules },
      economy: { ...source.economy },
      music: {
        // Discord ids never enter the document: only the logical key.
        djRoleKey: source.music.djRoleId
          ? roleKey(source.music.djRoleId)
          : null,
        defaultVolume: source.music.defaultVolume,
        maxQueue: source.music.maxQueue,
        maxPerMember: source.music.maxPerMember,
        idleDisconnectSeconds: source.music.idleDisconnectSeconds,
      },
      moderation: {
        escalationThreshold: source.moderation.escalationThreshold,
        escalationMinutes: source.moderation.escalationMinutes,
        exemptRoleKeys: source.moderation.exemptRoleIds
          .map(roleKey)
          .filter((key): key is string => !!key) as never,
      },
      bindings: {
        auditChannelKey: source.auditChannelId
          ? channelKey(source.auditChannelId)
          : null,
        notificationRoleKey: source.notificationRoleId
          ? roleKey(source.notificationRoleId)
          : null,
      },
    });
  } else if (wantsConfig) {
    config = templateConfigSchema.parse({});
  }
  if (wantsConfig)
    omitted.push(
      "Anything Discord already copies natively: channel topics are included, message history is not"
    );
  if (!wantsStructure)
    omitted.push("Server structure (not selected for this template)");
  if (!wantsConfig)
    omitted.push("Orbit configuration (not selected for this template)");

  return serverTemplateSchema.parse({
    version: TEMPLATE_SCHEMA_VERSION,
    kind:
      wantsStructure && wantsConfig
        ? "both"
        : wantsStructure
          ? "structure"
          : "configuration",
    name: input.name.slice(0, TEMPLATE_LIMITS.nameLength),
    description: (input.description ?? "").slice(
      0,
      TEMPLATE_LIMITS.descriptionLength
    ),
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    ...(structure ? { structure } : {}),
    ...(config ? { config } : {}),
    omitted: [...new Set(omitted)],
  });
}

/** Target guild as stored from its own sync; the preview is computed from this. */
export type GuildApplyTarget = {
  id: string;
  name: string;
  /** The bot's own highest role position, when known. */
  botRolePosition: number;
  /** The bot role's permission bits, when known. */
  botPermissions: string;
  roles: { id: string; name: string; managed: boolean; position: number }[];
  channels: {
    id: string;
    name: string;
    type: string;
    parentId?: string | null;
  }[];
};

export type TemplatePlanItem = {
  key: string;
  name: string;
  kind: "role" | "channel";
  /** What applying will do to this item. */
  action: "create" | "reuse" | "skip";
  reason: string;
  /** Existing target id when reusing. */
  targetId?: string;
};

export type TemplatePlan = {
  templateName: string;
  targetGuildId: string;
  items: TemplatePlanItem[];
  /** Problems that make the plan unapplicable. */
  blockers: { code: string; message: string }[];
  /** Things the operator should know, but that do not stop the apply. */
  warnings: string[];
  counts: { create: number; reuse: number; skip: number };
  /** Hash of the create/reuse decisions; a later apply must match it. */
  fingerprint: string;
  config: {
    changes: { field: string; value: string }[];
    bindings: { field: string; target: string; resolution: string }[];
    warnings: string[];
  } | null;
};

const MANAGE_ROLES = 1n << 28n;
const MANAGE_CHANNELS = 1n << 4n;
const ROLE_LIMIT = 250;
const CHANNEL_LIMIT = 500;

function sameName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Work out what applying a template to one target would do.
 *
 * The default is additive: create what is missing, reuse what already has the
 * same name and type, and never delete or overwrite. Anything that would need an
 * update is reported as a skip plus a reason, not silently changed.
 */
export function previewTemplate(input: {
  template: ServerTemplateDocument;
  target: GuildApplyTarget;
  mapping?: Record<string, string>;
}): TemplatePlan {
  const { template, target, mapping = {} } = input;
  const items: TemplatePlanItem[] = [];
  const blockers: TemplatePlan["blockers"] = [];
  const warnings: string[] = [];
  const bits = BigInt(target.botPermissions || "0");
  const administrator = (bits & ADMINISTRATOR) === ADMINISTRATOR;
  const canManageRoles =
    administrator || (bits & MANAGE_ROLES) === MANAGE_ROLES;
  const canManageChannels =
    administrator || (bits & MANAGE_CHANNELS) === MANAGE_CHANNELS;

  const roles = template.structure?.roles ?? [];
  const channels = template.structure?.channels ?? [];
  const creators = {
    role: roles.filter(
      (r) =>
        !mapping[r.key] &&
        !target.roles.some((t) => !t.managed && sameName(t.name, r.name))
    ),
    channel: channels.filter(
      (c) =>
        !mapping[c.key] &&
        !target.channels.some(
          (t) => t.type === c.type && sameName(t.name, c.name)
        )
    ),
  };

  if (roles.length && !canManageRoles)
    blockers.push({
      code: "missing-manage-roles",
      message:
        "Orbit needs the Manage Roles permission in this server before it can create roles. Grant it and preview again.",
    });
  if (channels.length && !canManageChannels)
    blockers.push({
      code: "missing-manage-channels",
      message:
        "Orbit needs the Manage Channels permission in this server before it can create channels. Grant it and preview again.",
    });
  if (target.roles.length + creators.role.length > ROLE_LIMIT)
    blockers.push({
      code: "role-limit",
      message: `Discord allows at most ${ROLE_LIMIT} roles. This target has ${target.roles.length} and the template adds ${creators.role.length}.`,
    });
  if (target.channels.length + creators.channel.length > CHANNEL_LIMIT)
    blockers.push({
      code: "channel-limit",
      message: `Discord allows at most ${CHANNEL_LIMIT} channels. This target has ${target.channels.length} and the template adds ${creators.channel.length}.`,
    });
  if (target.botRolePosition <= 1 && creators.role.length && !administrator)
    warnings.push(
      "Orbit's role is at the bottom of the hierarchy. Roles it creates will also be low, so it may not be able to manage the channels it creates."
    );

  // Logical key → target id, for channels referenced by the template config.
  const channelIds = new Map<string, string>();

  for (const role of roles) {
    const mapped = mapping[role.key];
    const existingById = mapped
      ? target.roles.find((r) => r.id === mapped)
      : undefined;
    if (mapped && !existingById) {
      items.push({
        key: role.key,
        name: role.name,
        kind: "role",
        action: "skip",
        reason: "The mapped role no longer exists in this server.",
      });
      continue;
    }
    if (existingById) {
      items.push({
        key: role.key,
        name: role.name,
        kind: "role",
        action: "reuse",
        reason: `Mapped to the existing role “${existingById.name}”.`,
        targetId: existingById.id,
      });
      continue;
    }
    const same = target.roles.find(
      (r) => !r.managed && sameName(r.name, role.name)
    );
    if (same) {
      items.push({
        key: role.key,
        name: role.name,
        kind: "role",
        action: "reuse",
        reason: `A role named “${same.name}” already exists; it will be reused, not duplicated.`,
        targetId: same.id,
      });
      continue;
    }
    items.push({
      key: role.key,
      name: role.name,
      kind: "role",
      action: "create",
      reason: "New role, created below Orbit's own role.",
    });
  }

  for (const channel of channels) {
    const mapped = mapping[channel.key];
    const existingById = mapped
      ? target.channels.find((c) => c.id === mapped)
      : undefined;
    if (mapped && !existingById) {
      items.push({
        key: channel.key,
        name: channel.name,
        kind: "channel",
        action: "skip",
        reason: "The mapped channel no longer exists in this server.",
      });
      continue;
    }
    if (existingById) {
      channelIds.set(channel.key, existingById.id);
      items.push({
        key: channel.key,
        name: channel.name,
        kind: "channel",
        action: "reuse",
        reason: `Mapped to the existing channel “${existingById.name}”.`,
        targetId: existingById.id,
      });
      continue;
    }
    const same = target.channels.find(
      (c) => c.type === channel.type && sameName(c.name, channel.name)
    );
    if (same) {
      channelIds.set(channel.key, same.id);
      items.push({
        key: channel.key,
        name: channel.name,
        kind: "channel",
        action: "reuse",
        reason: `A ${channel.type} channel named “${same.name}” already exists; it will be reused.`,
        targetId: same.id,
      });
      continue;
    }
    items.push({
      key: channel.key,
      name: channel.name,
      kind: "channel",
      action: "create",
      reason: `New ${channel.type} channel${
        channel.parentKey ? " inside its category" : ""
      }.`,
    });
  }

  // A parent that will not exist on the target makes the nesting meaningless.
  const skippedKeys = new Set(
    items.filter((item) => item.action === "skip").map((item) => item.key)
  );
  for (const channel of channels) {
    if (!channel.parentKey || !skippedKeys.has(channel.parentKey)) continue;
    channelIds.delete(channel.key);
    const item = items.find((i) => i.key === channel.key);
    if (!item) continue;
    item.action = "skip";
    item.reason = `Its category “${channel.parentKey}” cannot be created here.`;
  }

  let config: TemplatePlan["config"] = null;
  if (template.config) {
    const changes: { field: string; value: string }[] = [];
    const bindings: { field: string; target: string; resolution: string }[] =
      [];
    const configWarnings: string[] = [];
    const c = template.config;
    for (const [field, value] of Object.entries(c.modules ?? {}))
      if (value !== undefined)
        changes.push({ field: `modules.${field}`, value: String(value) });
    for (const [field, value] of Object.entries(c.economy ?? {}))
      if (value !== undefined)
        changes.push({ field: `economy.${field}`, value: String(value) });
    for (const [field, value] of Object.entries(c.music ?? {}))
      if (field === "djRoleKey") continue;
      else if (value !== undefined)
        changes.push({ field: `music.${field}`, value: String(value) });
    for (const [field, value] of Object.entries(c.moderation ?? {}))
      if (field === "exemptRoleKeys") continue;
      else if (value !== undefined)
        changes.push({ field: `moderation.${field}`, value: String(value) });
    for (const field of ["locale", "timezone"] as const)
      if (c[field] !== undefined)
        changes.push({ field, value: String(c[field]) });

    const resolveRole = (key: string) => {
      const item = items.find((i) => i.key === key && i.kind === "role");
      if (!item) return null;
      return item.action === "reuse"
        ? { label: item.reason.split("“")[1]?.split("”")[0] ?? item.name }
        : { label: `${item.name} (created)` };
    };
    if (c.music?.djRoleKey) {
      const resolved = resolveRole(c.music.djRoleKey);
      if (resolved)
        bindings.push({
          field: "music.djRoleId",
          target: resolved.label,
          resolution: "role key",
        });
      else
        configWarnings.push(
          `The DJ role “${c.music.djRoleKey}” is not part of this template, so it will not be set.`
        );
    }
    if (c.moderation?.exemptRoleKeys?.length) {
      const resolved = c.moderation.exemptRoleKeys
        .map(resolveRole)
        .filter((r): r is { label: string } => !!r)
        .map((r) => r.label);
      if (resolved.length)
        bindings.push({
          field: "moderation.exemptRoleIds",
          target: resolved.join(", "),
          resolution: "role keys",
        });
      if (resolved.length !== c.moderation.exemptRoleKeys.length)
        configWarnings.push(
          "Some exempt roles are not part of this template and will be left out."
        );
    }
    if (c.bindings?.auditChannelKey) {
      const item = items.find((i) => i.key === c.bindings!.auditChannelKey);
      const channelId = channelIds.get(c.bindings.auditChannelKey);
      if (item && item.action !== "skip")
        bindings.push({
          field: "auditChannelId",
          target: item.name,
          resolution: channelId
            ? "existing channel"
            : "channel created by this apply",
        });
      else
        configWarnings.push(
          "The audit channel this template points at cannot be created here, so the setting will be left unchanged."
        );
    }
    if (c.bindings?.notificationRoleKey) {
      const resolved = resolveRole(c.bindings.notificationRoleKey);
      if (resolved)
        bindings.push({
          field: "notificationRoleId",
          target: resolved.label,
          resolution: "role key",
        });
      else
        configWarnings.push(
          "The notification role is not part of this template, so the setting will be left unchanged."
        );
    }
    config = { changes, bindings, warnings: configWarnings };
  }

  const counts = { create: 0, reuse: 0, skip: 0 };
  for (const item of items) counts[item.action] += 1;

  return {
    templateName: template.name,
    targetGuildId: target.id,
    items,
    blockers,
    warnings,
    counts,
    fingerprint: planFingerprint(items),
    config,
  };
}

/**
 * The decision set, not the prose: two previews of the same template against the
 * same target produce the same fingerprint, and a target that changed in a way
 * that would alter what gets created produces a different one.
 */
export function planFingerprint(items: TemplatePlanItem[]) {
  const parts = items
    .map((item) => `${item.key}:${item.action}:${item.targetId ?? ""}`)
    .sort();
  let hash = 0;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i++)
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `${parts.length}-${(hash >>> 0).toString(16)}`;
}

/** Reject a document that is too large before it costs a parse. */
export function parseTemplateDocument(raw: unknown): ServerTemplateDocument {
  const text = JSON.stringify(raw ?? null);
  if (text.length > TEMPLATE_LIMITS.documentBytes)
    throw new Error("This template document is larger than Orbit accepts.");
  return serverTemplateSchema.parse(raw);
}

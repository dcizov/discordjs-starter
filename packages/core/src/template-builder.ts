import { PERMISSION_BITS } from "./permission-bits";
import {
  TEMPLATE_LIMITS,
  TEMPLATE_SCHEMA_VERSION,
  templateChannelTypes,
  type ServerTemplateDocument,
  type TemplateChannel,
  type TemplateOverwrite,
  type TemplateRole,
} from "./templates";
import { serverTemplateSchema } from "./templates";

/**
 * Editing operations for server templates.
 *
 * Everything here is pure: the builder, the duplicate and the integrity checks
 * take a document and return a document or a list of issues. Nothing reads a
 * guild and nothing talks to Discord, so the rules that decide whether a
 * template can be saved at all are testable without a bot.
 */

/**
 * Discord's `Administrator` permission bit.
 *
 * It comes from the local `PERMISSION_BITS` table rather than from discord.js:
 * `packages/core` is pulled into the dashboard bundle, and importing discord.js
 * there drags node-only modules (`undici`, `node:async_hooks`) into a browser
 * build. The bot keeps using discord.js directly.
 */
export const ADMINISTRATOR_BIT = PERMISSION_BITS.Administrator;

/** Permissions an Orbit template is allowed to hand out, in a readable order. */
export const ASSIGNABLE_PERMISSIONS = [
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "EmbedLinks",
  "AttachFiles",
  "AddReactions",
  "UseExternalEmojis",
  "UseExternalStickers",
  "MentionEveryone",
  "ReadMessageHistory",
  "UseApplicationCommands",
  "Connect",
  "Speak",
  "Stream",
  "UseSoundboard",
  "UseVAD",
  "RequestToSpeak",
  "ManageThreads",
  "ManageMessages",
  "ModerateMembers",
  "MoveMembers",
  "MuteMembers",
  "DeafenMembers",
  "PrioritySpeaker",
  "ChangeNickname",
  "ManageNicknames",
  "ManageRoles",
  "ManageChannels",
  "ManageEvents",
  "CreateInstantInvite",
  "ViewAuditLog",
] as const;

export type AssignablePermission = (typeof ASSIGNABLE_PERMISSIONS)[number];

const isAssignable = (name: string): name is AssignablePermission =>
  (ASSIGNABLE_PERMISSIONS as readonly string[]).includes(name);

/** Parse a decimal bitfield into the permission names it carries. */
export function permissionNames(bitfield: string | null | undefined): string[] {
  const bits = BigInt(bitfield ?? "0");
  const names: string[] = [];
  for (const [name, flag] of Object.entries(PERMISSION_BITS)) {
    if (typeof flag !== "bigint") continue;
    if (flag !== 0n && (bits & flag) === flag) names.push(name);
  }
  return names;
}

/** Turn a set of permission names back into a decimal bitfield string. */
export function permissionBitfield(names: readonly string[]): string {
  let bits = 0n;
  for (const name of names) {
    const flag = PERMISSION_BITS[name];
    if (typeof flag === "bigint") bits |= flag;
  }
  return bits.toString();
}

/**
 * Split a bitfield into what a template may carry and what it refuses to.
 *
 * `Administrator` is stripped rather than rejected outright, matching capture:
 * a blueprint must never be the thing that hands out full control, but a
 * captured server's real roles should still be representable.
 */
export function splitPermissions(bitfield: string | null | undefined) {
  const names = permissionNames(bitfield);
  return {
    allowed: names.filter(isAssignable),
    refused: names.filter((name) => !isAssignable(name)),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type TemplateIssue = {
  /** Where in the document, in a form an editor can point at. */
  path: string;
  message: string;
  /** `error` blocks saving; `warning` is shown but does not. */
  severity: "error" | "warning";
};

/**
 * Reference integrity, on top of the schema.
 *
 * The schema checks the shape of one entry; it cannot know whether the category
 * a channel points at still exists. A dangling reference would either fail
 * halfway through an apply or silently create the channel at the top level, so
 * it is caught here instead — while the editor can still show which row it is.
 */
export function validateTemplateDocument(document: unknown): {
  issues: TemplateIssue[];
  document: ServerTemplateDocument | null;
} {
  const parsed = serverTemplateSchema.safeParse(document);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(document)",
        message: issue.message,
        severity: "error" as const,
      })),
      document: null,
    };
  }
  const doc = parsed.data;
  const issues: TemplateIssue[] = [];
  const roles = doc.structure?.roles ?? [];
  const channels = doc.structure?.channels ?? [];
  const roleKeys = new Set(roles.map((r) => r.key));
  const channelKeys = new Set(channels.map((c) => c.key));

  // Duplicate keys: two rows addressing the same logical key cannot be mapped.
  for (const key of duplicates(roles.map((r) => r.key)))
    issues.push({
      path: `structure.roles[${key}]`,
      message: `Two roles use the key “${key}”. Each role needs its own key.`,
      severity: "error",
    });
  for (const key of duplicates(channels.map((c) => c.key)))
    issues.push({
      path: `structure.channels[${key}]`,
      message: `Two channels use the key “${key}”. Each channel needs its own key.`,
      severity: "error",
    });

  // A category parent must exist and must actually be a category.
  for (const channel of channels) {
    if (!channel.parentKey) continue;
    const parent = channels.find((c) => c.key === channel.parentKey);
    if (!parent) {
      issues.push({
        path: `structure.channels[${channel.key}].parentKey`,
        message: `“${channel.name}” sits in the category “${channel.parentKey}”, which this template no longer contains. Pick another category or move it to the top level.`,
        severity: "error",
      });
    } else if (parent.type !== "category") {
      issues.push({
        path: `structure.channels[${channel.key}].parentKey`,
        message: `“${channel.name}” is inside “${parent.name}”, which is a ${parent.type} channel, not a category.`,
        severity: "error",
      });
    } else if (parent.key === channel.key) {
      issues.push({
        path: `structure.channels[${channel.key}].parentKey`,
        message: `“${channel.name}” cannot be its own parent.`,
        severity: "error",
      });
    }
  }

  // Permission overwrites must point at a role that exists.
  for (const channel of channels)
    for (const overwrite of channel.overwrites) {
      if (overwrite.roleKey === "role:everyone") continue;
      if (!roleKeys.has(overwrite.roleKey))
        issues.push({
          path: `structure.channels[${channel.key}].overwrites`,
          message: `“${channel.name}” sets permissions for “${overwrite.roleKey}”, but no role with that key is in this template.`,
          severity: "error",
        });
      const refused = splitPermissions(overwrite.allow).refused.concat(
        splitPermissions(overwrite.deny).refused
      );
      if (refused.length)
        issues.push({
          path: `structure.channels[${channel.key}].overwrites`,
          message: `“${channel.name}” grants ${refused.join(", ")}. A template never grants Administrator or other reserved permissions.`,
          severity: "error",
        });
    }

  const bindings = doc.config?.bindings;
  if (bindings?.auditChannelKey && !channelKeys.has(bindings.auditChannelKey))
    issues.push({
      path: "config.bindings.auditChannelKey",
      message: `The audit log channel points at “${bindings.auditChannelKey}”, which this template no longer contains.`,
      severity: "error",
    });
  if (
    bindings?.notificationRoleKey &&
    !roleKeys.has(bindings.notificationRoleKey)
  )
    issues.push({
      path: "config.bindings.notificationRoleKey",
      message: `The notification role points at “${bindings.notificationRoleKey}”, which this template no longer contains.`,
      severity: "error",
    });
  if (doc.config?.music?.djRoleKey && !roleKeys.has(doc.config.music.djRoleKey))
    issues.push({
      path: "config.music.djRoleKey",
      message: `The DJ role points at “${doc.config.music.djRoleKey}”, which this template no longer contains.`,
      severity: "error",
    });
  for (const key of doc.config?.moderation?.exemptRoleKeys ?? [])
    if (!roleKeys.has(key))
      issues.push({
        path: "config.moderation.exemptRoleKeys",
        message: `An exempt role points at “${key}”, which this template no longer contains.`,
        severity: "error",
      });

  // Advisory, not blocking: an empty structure is legal but rarely intended.
  if (
    doc.kind !== "configuration" &&
    roles.length === 0 &&
    channels.length === 0
  )
    issues.push({
      path: "structure",
      message:
        "This template has no roles and no channels. It will apply nothing until you add some.",
      severity: "warning",
    });

  return { issues, document: doc };
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export const nowIso = () => new Date().toISOString();

/** A fresh, empty document of the chosen scope. */
export function buildBlankTemplate(input: {
  name: string;
  description?: string;
  kind: ServerTemplateDocument["kind"];
}): ServerTemplateDocument {
  return {
    version: TEMPLATE_SCHEMA_VERSION,
    kind: input.kind,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    createdAt: nowIso(),
    ...(input.kind !== "configuration"
      ? { structure: { roles: [], channels: [] } }
      : {}),
    ...(input.kind !== "structure" ? { config: {} } : {}),
    omitted: [],
  };
}

/**
 * Copy a document under a new name, with fresh timestamps.
 *
 * Keys are copied verbatim on purpose: they are the template's own addressing
 * scheme, not Discord ids, so they stay valid wherever the copy is applied.
 */
export function duplicateTemplateDocument(
  document: ServerTemplateDocument,
  input: { name: string; description?: string }
): ServerTemplateDocument {
  return {
    // A deep copy, not a spread: the duplicate shares the original's role and
    // channel arrays otherwise, so the first edit in the builder would silently
    // rewrite the template it was copied from.
    ...structuredClone(document),
    name: input.name.trim(),
    ...(input.description === undefined
      ? {}
      : { description: input.description.trim() }),
    createdAt: nowIso(),
  };
}

export function renameTemplateDocument(
  document: ServerTemplateDocument,
  input: { name?: string; description?: string }
): ServerTemplateDocument {
  return {
    ...document,
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.description === undefined
      ? {}
      : { description: input.description.trim() }),
  };
}

/** Next free `role:…` / `channel:…` key, so two rows never share one. */
export function nextTemplateKey(
  prefix: "role" | "channel",
  taken: readonly string[],
  seed = "new"
): string {
  const used = new Set(taken);
  const base = `${prefix}:${seed}`;
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function blankRole(input: {
  key: string;
  name?: string;
  position?: number;
}): TemplateRole {
  return {
    key: input.key,
    name: input.name ?? "New role",
    color: null,
    permissions: "0",
    hoist: false,
    mentionable: false,
    position: input.position ?? 0,
  };
}

export function blankChannel(input: {
  key: string;
  name?: string;
  type?: TemplateChannel["type"];
  parentKey?: string | null;
  position?: number;
  topic?: string | null;
  nsfw?: boolean;
  overwrites?: TemplateOverwrite[];
}): TemplateChannel {
  return {
    key: input.key,
    name: input.name ?? "new-channel",
    type: input.type ?? "text",
    parentKey: input.parentKey ?? null,
    topic: input.topic ?? null,
    nsfw: input.nsfw ?? false,
    position: input.position ?? 0,
    overwrites: input.overwrites ?? [],
  };
}

export function blankOverwrite(roleKey: string): TemplateOverwrite {
  return { roleKey, allow: "0", deny: "0" };
}

/** Move an item and renumber every position, so order is stored explicitly. */
export function moveItem<T extends { position: number }>(
  items: readonly T[],
  from: number,
  to: number
): T[] {
  const next = items.map((item) => ({ ...item }));
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return renumber(next);
}

export const renumber = <T extends { position: number }>(items: T[]): T[] =>
  items.map((item, index) => ({ ...item, position: index }));

export const canMoveUp = (index: number) => index > 0;
export const canMoveDown = (index: number, length: number) =>
  index >= 0 && index < length - 1;

// ---------------------------------------------------------------------------
// Starter blueprints
// ---------------------------------------------------------------------------

export type TemplateBlueprint = {
  id: string;
  name: string;
  summary: string;
  /** What kind of community this suits, so the picker can explain itself. */
  bestFor: string;
  build: () => ServerTemplateDocument;
};

const P = (...names: AssignablePermission[]) => permissionBitfield(names);

/**
 * Three starters, chosen because they are the shapes a new server most often
 * needs and because each one is complete enough to apply meaningfully. They are
 * deliberately small: a blueprint is a starting point to edit, not a finished
 * community.
 *
 * None of them sets Administrator, and none of them carries any permission
 * beyond what the channels they create actually require.
 */
export const STARTER_BLUEPRINTS: TemplateBlueprint[] = [
  {
    id: "community",
    name: "Community starter",
    summary:
      "Announcements, a general chat and a small moderation team, with an audit channel bound to Orbit.",
    bestFor: "A general community server just getting started.",
    build: () => ({
      version: TEMPLATE_SCHEMA_VERSION,
      kind: "both",
      name: "Community starter",
      description:
        "A readable baseline: announcements, general chat, and a moderation role with an audit channel.",
      createdAt: nowIso(),
      structure: {
        roles: [
          {
            key: "role:moderator",
            name: "Moderator",
            color: "#e11d48",
            permissions: P(
              "ViewChannel",
              "ManageMessages",
              "ModerateMembers",
              "MuteMembers",
              "ViewAuditLog"
            ),
            hoist: true,
            mentionable: false,
            position: 0,
          },
          {
            key: "role:member",
            name: "Member",
            color: "#6366f1",
            permissions: P("ViewChannel", "SendMessages", "ReadMessageHistory"),
            hoist: true,
            mentionable: true,
            position: 1,
          },
        ],
        channels: [
          {
            key: "channel:information",
            name: "Information",
            type: "category",
            parentKey: null,
            topic: null,
            nsfw: false,
            position: 0,
            overwrites: [],
          },
          {
            key: "channel:announcements",
            name: "announcements",
            type: "text",
            parentKey: "channel:information",
            topic: "Read-only news from the team.",
            nsfw: false,
            position: 1,
            overwrites: [
              {
                roleKey: "role:everyone",
                allow: P("ViewChannel", "ReadMessageHistory"),
                deny: P("SendMessages"),
              },
            ],
          },
          {
            key: "channel:general",
            name: "general",
            type: "text",
            parentKey: null,
            topic: null,
            nsfw: false,
            position: 2,
            overwrites: [],
          },
          {
            key: "channel:audit-log",
            name: "audit-log",
            type: "text",
            parentKey: null,
            topic: "Orbit moderation audit trail.",
            nsfw: false,
            position: 3,
            overwrites: [
              {
                roleKey: "role:everyone",
                allow: "0",
                deny: P("ViewChannel"),
              },
              {
                roleKey: "role:moderator",
                allow: P("ViewChannel", "ReadMessageHistory"),
                deny: "0",
              },
            ],
          },
        ],
      },
      config: {
        modules: { moderation: true, announcements: true, roles: true },
        bindings: {
          auditChannelKey: "channel:audit-log",
          notificationRoleKey: "role:moderator",
        },
      },
      omitted: [],
    }),
  },
  {
    id: "gaming",
    name: "Gaming community",
    summary:
      "Voice-first: a voice lobby, two team channels and a text channel for looking for group.",
    bestFor: "Servers built around playing together rather than posting.",
    build: () => ({
      version: TEMPLATE_SCHEMA_VERSION,
      kind: "both",
      name: "Gaming community",
      description:
        "A voice-first layout with team channels, a lobby and a text channel for finding a group.",
      createdAt: nowIso(),
      structure: {
        roles: [
          {
            key: "role:captain",
            name: "Captain",
            color: "#0891b2",
            permissions: P(
              "ViewChannel",
              "SendMessages",
              "Connect",
              "Speak",
              "MoveMembers",
              "MuteMembers"
            ),
            hoist: true,
            mentionable: true,
            position: 0,
          },
        ],
        channels: [
          {
            key: "channel:voice",
            name: "Voice",
            type: "category",
            parentKey: null,
            topic: null,
            nsfw: false,
            position: 0,
            overwrites: [],
          },
          {
            key: "channel:lobby",
            name: "Lobby",
            type: "voice",
            parentKey: "channel:voice",
            topic: null,
            nsfw: false,
            position: 1,
            overwrites: [],
          },
          {
            key: "channel:team-alpha",
            name: "Team Alpha",
            type: "voice",
            parentKey: "channel:voice",
            topic: null,
            nsfw: false,
            position: 2,
            overwrites: [],
          },
          {
            key: "channel:looking-for-group",
            name: "looking-for-group",
            type: "text",
            parentKey: null,
            topic: "Post what you are playing and who you need.",
            nsfw: false,
            position: 3,
            overwrites: [],
          },
        ],
      },
      config: {
        modules: { music: true, roles: true },
        music: { djRoleKey: "role:captain", defaultVolume: 60, maxQueue: 50 },
      },
      omitted: [],
    }),
  },
  {
    id: "creator",
    name: "Creator / streaming",
    summary:
      "A stage for events, a media channel for uploads and a subscriber role with its own channel.",
    bestFor: "Broadcasting, streams, and a channel your supporters can see.",
    build: () => ({
      version: TEMPLATE_SCHEMA_VERSION,
      kind: "both",
      name: "Creator / streaming",
      description:
        "A stage for live events, a media channel for uploads, and a private channel for supporters.",
      createdAt: nowIso(),
      structure: {
        roles: [
          {
            key: "role:supporter",
            name: "Supporter",
            color: "#a855f7",
            permissions: P("ViewChannel", "SendMessages", "Connect", "Speak"),
            hoist: true,
            mentionable: true,
            position: 0,
          },
        ],
        channels: [
          {
            key: "channel:stage",
            name: "Live stage",
            type: "stage",
            parentKey: null,
            topic: null,
            nsfw: false,
            position: 0,
            overwrites: [
              {
                roleKey: "role:everyone",
                allow: P("ViewChannel", "Connect"),
                deny: P("Speak"),
              },
            ],
          },
          {
            key: "channel:media",
            name: "media",
            type: "media",
            parentKey: null,
            topic: "Uploads and clips.",
            nsfw: false,
            position: 1,
            overwrites: [
              {
                roleKey: "role:everyone",
                allow: P("ViewChannel", "ReadMessageHistory"),
                deny: P("SendMessages"),
              },
              {
                roleKey: "role:supporter",
                allow: P("SendMessages", "AttachFiles"),
                deny: "0",
              },
            ],
          },
          {
            key: "channel:supporters",
            name: "supporters",
            type: "text",
            parentKey: null,
            topic: null,
            nsfw: false,
            position: 2,
            overwrites: [
              {
                roleKey: "role:everyone",
                allow: "0",
                deny: P("ViewChannel"),
              },
              {
                roleKey: "role:supporter",
                allow: P("ViewChannel", "SendMessages"),
                deny: "0",
              },
            ],
          },
        ],
      },
      config: {
        modules: { announcements: true, roles: true },
        bindings: { notificationRoleKey: "role:supporter" },
      },
      omitted: [],
    }),
  },
];

export function getBlueprint(id: string): TemplateBlueprint | null {
  return STARTER_BLUEPRINTS.find((b) => b.id === id) ?? null;
}

/** Build a blueprint under an operator's own name and description. */
export function buildFromBlueprint(
  id: string,
  input: { name?: string; description?: string } = {}
): ServerTemplateDocument | null {
  const blueprint = getBlueprint(id);
  if (!blueprint) return null;
  const base = blueprint.build();
  return renameTemplateDocument(base, {
    ...(input.name?.trim() ? { name: input.name } : {}),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
  });
}

export { templateChannelTypes, TEMPLATE_LIMITS };

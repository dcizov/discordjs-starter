import type { Guild } from "@orbit/core";
import {
  previewTemplate,
  type GuildApplyTarget,
  type ServerTemplateDocument,
} from "@orbit/core/templates";

/**
 * Preview a template against a guild Orbit already synchronized.
 *
 * Pure mapping: no credentials, no Discord client, no network. It builds the
 * target shape from the stored guild snapshot (`guilds.roles`,
 * `guilds.channels`, `botRolePosition`) rather than a live Discord read: the
 * dashboard has no Discord session, and the snapshot is the same data the rest of
 * the UI shows. The bot revalidates against live state at apply time, which is
 * where a stale preview is caught.
 */
export function applyTargetFromSnapshot(guild: Guild): GuildApplyTarget {
  // The bot's own role is the only one flagged with `assignedToBot` at sync time.
  const botRole = guild.roles.find((role) => role.assignedToBot);
  return {
    id: guild.id,
    name: guild.name,
    botRolePosition: guild.botRolePosition,
    botPermissions: botRole?.permissions ?? "0",
    roles: guild.roles.map((role) => ({
      id: role.id,
      name: role.name,
      managed: role.managed,
      position: role.position,
    })),
    channels: guild.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: null,
    })),
  };
}

export function previewForTarget(input: {
  document: ServerTemplateDocument;
  target: Guild;
  mapping?: Record<string, string>;
}) {
  return previewTemplate({
    template: input.document,
    target: applyTargetFromSnapshot(input.target),
    mapping: input.mapping,
  });
}

/** A template can only be applied where Orbit is installed and the user manages. */
export function assertTargetAllowed(
  guild: Guild | null,
  authorized: { id: string }[]
) {
  if (!guild) throw new Error("That server is not available.");
  if (!authorized.some((g) => g.id === guild.id))
    throw new Error(
      "You need Manage Server permission on the target server to apply a template there."
    );
  if (!guild.installed)
    throw new Error(
      "Invite Orbit to the target server before applying a template."
    );
  return guild;
}

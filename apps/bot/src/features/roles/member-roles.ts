import { PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import { safeText } from "@orbit/core";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import {
  offerableRoles,
  planMemberRoleChanges,
  type EditableRole,
} from "@orbit/core/member-role-edit";
import { audit, upsertMembers } from "@orbit/db";
import { memberLock, roleView } from "./panels";

/**
 * Editing one member's roles from the dashboard.
 *
 * The rules themselves live in `@orbit/core/member-role-edit` and are tested
 * there without Discord. This file is the part that talks to the API: it
 * gathers the live facts the rules need, asks the rules what is allowed,
 * applies it, then re-reads the member so the answer comes from Discord rather
 * than from what we hoped happened.
 */

export type MemberRoleOutcome = {
  roleId: string;
  operation: "add" | "remove";
  applied: boolean;
  /** Present only when `applied` is false. Safe to show and to log. */
  error?: string;
};

export type MemberRoleEditResult = {
  /** Roles actually added, by id. */
  added: string[];
  /** Roles actually removed, by id. */
  removed: string[];
  /** Asked for and refused before anything was sent to Discord. */
  denied: { roleId: string; reason: string }[];
  /** Asked for, allowed, and rejected by Discord. */
  failed: MemberRoleOutcome[];
  /**
   * The member's roles after the change, re-read from Discord. This — not the
   * client's list, and not the plan — is what the dashboard shows afterwards.
   */
  roles: string[];
};

const REASON = "Role change from the Orbit dashboard";

/** The guild's roles in the shape the rules need, re-read from Discord. */
function editable(guild: Guild): EditableRole[] {
  return roleView(guild).map((role) => ({
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    managed: role.managed,
    permissions: role.permissions,
  }));
}

/** A member row rebuilt from Discord's own answer. */
function memberRow(member: GuildMember) {
  return {
    userId: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    nickname: member.nickname,
    avatar: member.user.avatar,
    guildAvatar: member.avatar,
    bot: member.user.bot,
    joinedAt: member.joinedAt,
    roles: [...member.roles.cache.keys()],
    present: true,
  };
}

async function apply(
  member: GuildMember,
  operation: "add" | "remove",
  roleIds: string[]
): Promise<MemberRoleOutcome[]> {
  if (!roleIds.length) return [];
  const ok = roleIds.map((roleId) => ({ roleId, operation, applied: true }));
  try {
    // One call for the whole set. Discord applies it atomically, so a failure
    // here means none of them landed.
    if (operation === "add") await member.roles.add(roleIds, REASON);
    else await member.roles.remove(roleIds, REASON);
    return ok;
  } catch (error) {
    // Something refused. Fall back to one call per role so the operator is
    // told which role failed instead of the whole change looking broken.
    const results: MemberRoleOutcome[] = [];
    for (const roleId of roleIds) {
      try {
        if (operation === "add") await member.roles.add(roleId, REASON);
        else await member.roles.remove(roleId, REASON);
        results.push({ roleId, operation, applied: true });
      } catch (individual) {
        results.push({
          roleId,
          operation,
          applied: false,
          error: errorDiagnostic(individual),
        });
      }
    }
    return results;
  }
}

export async function editMemberRoles(
  guild: Guild,
  input: { actorId: string; targetId: string; desiredRoleIds: string[] }
): Promise<MemberRoleEditResult> {
  return memberLock(guild.id, input.targetId, async () => {
    await guild.roles.fetch();
    const me = await guild.members.fetchMe();
    // The bot's own capability is checked before anything else: without it
    // every later check is academic.
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
      throw new Error("Orbit needs the Manage Roles permission.");

    const actor = await guild.members.fetch({
      user: input.actorId,
      force: true,
    });
    // Always read the target fresh. Stored rows can be a sync behind, and a
    // decision made from a stale list can hand out a role twice.
    let target = await guild.members.fetch({
      user: input.targetId,
      force: true,
    });
    if (target.id === guild.ownerId)
      throw new Error("The server owner's roles cannot be changed.");
    if (target.id === me.id)
      throw new Error("Orbit's own roles cannot be changed from here.");

    const roles = editable(guild);
    const currentRoleIds = [...target.roles.cache.keys()];
    const plan = planMemberRoleChanges({
      guildId: guild.id,
      currentRoleIds,
      desiredRoleIds: input.desiredRoleIds,
      roles,
      actorHighestPosition: actor.roles.highest.position,
      botHighestPosition: me.roles.highest.position,
      actorPermissionBits: actor.permissions.bitfield.toString(),
    });

    const added: string[] = [];
    const removed: string[] = [];
    const failed: MemberRoleOutcome[] = [];

    for (const outcome of await apply(target, "add", plan.add)) {
      if (outcome.applied) added.push(outcome.roleId);
      else failed.push(outcome);
    }
    for (const outcome of await apply(target, "remove", plan.remove)) {
      if (outcome.applied) removed.push(outcome.roleId);
      else failed.push(outcome);
    }

    // Re-read rather than infer. The roster the dashboard shows next must be
    // Discord's answer, not the plan we hoped to apply.
    target = await guild.members.fetch({ user: target.id, force: true });
    const rolesAfter = [...target.roles.cache.keys()];

    await upsertMembers(guild.id, [memberRow(target)]);

    const summary = [
      added.length ? `added ${added.length}` : null,
      removed.length ? `removed ${removed.length}` : null,
      plan.denied.length ? `refused ${plan.denied.length}` : null,
      failed.length ? `failed ${failed.length}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    await audit(
      guild.id,
      {
        id: actor.id,
        name: actor.user.displayName ?? actor.id,
        avatar: actor.user.avatar,
      },
      "update",
      "member-roles",
      `Changed roles for ${safeText(target.user.displayName ?? target.id, 60)} (${
        target.id
      }): ${summary || "no change"}`
    );

    return {
      added,
      removed,
      denied: plan.denied,
      failed: failed as MemberRoleOutcome[],
      roles: rolesAfter,
    };
  });
}

/**
 * What the editor may offer, and why it may offer nothing.
 *
 * Returned separately from the edit itself so the dashboard can build its
 * picker without pretending every role is available.
 */
export async function assignableRolesFor(
  guild: Guild,
  actorId: string
): Promise<{ roles: EditableRole[]; reason: string | null }> {
  await guild.roles.fetch();
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
    return {
      roles: [],
      reason:
        "Orbit needs the Manage Roles permission before roles can be changed.",
    };
  const actor = await guild.members.fetch({ user: actorId, force: true });
  if (!actor.permissions.has(PermissionFlagsBits.ManageRoles))
    return {
      roles: [],
      reason: "You no longer have the Manage Roles permission.",
    };
  const roles = offerableRoles(
    editable(guild),
    guild.id,
    actor.roles.highest.position,
    me.roles.highest.position,
    actor.permissions.bitfield.toString()
  );
  return {
    roles,
    reason: roles.length
      ? null
      : "No roles can be changed here. Every role is either managed by an integration, sits at or above the highest role Orbit and you can both reach, or would grant permissions you do not hold.",
  };
}

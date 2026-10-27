import { Permissions } from "./permissions";
import {
  assignableRoles,
  effectiveHierarchyCeiling,
  rolesBelowCeiling,
  type PresentableRole,
} from "./roles";

/**
 * A role the dashboard may offer in the member role editor.
 *
 * `permissions` is Discord's bit field as a decimal string, which is what the
 * synced guild carries. It is needed because a role change is not only a
 * hierarchy question: handing someone a role that grants permissions the actor
 * does not themselves hold is privilege escalation, even when the role sits
 * well below both ceilings.
 */
export type EditableRole = PresentableRole & { permissions: string };

export type RoleChangeDenial = {
  roleId: string;
  /** Human-readable, safe to show an operator and to write to the audit log. */
  reason: string;
};

export type RoleChangePlan = {
  /** Role ids to add. */
  add: string[];
  /** Role ids to remove. */
  remove: string[];
  /** Everything that was asked for and refused, with the reason why. */
  denied: RoleChangeDenial[];
  /** True when the request changes nothing that is allowed to change. */
  noop: boolean;
};

export type RoleChangeRequest = {
  guildId: string;
  /** The member's roles right now, as Discord (not the client) reports them. */
  currentRoleIds: readonly string[];
  /** What the client would like the member to hold. Never trusted on its own. */
  desiredRoleIds: readonly string[];
  /** Every role in the guild, as last synchronized. */
  roles: readonly EditableRole[];
  /** Position of the acting user's own highest role. */
  actorHighestPosition: number;
  /** Position of the bot's own highest role. */
  botHighestPosition: number;
  /** The acting user's effective permission bits, as a decimal string. */
  actorPermissionBits: string;
};

const emptyPlan: RoleChangePlan = {
  add: [],
  remove: [],
  denied: [],
  noop: true,
};

function bits(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Decide what a role change is allowed to do.
 *
 * This is the single place the rules live, and it is deliberately free of
 * Discord and of the database so it can be tested exhaustively. The bot calls
 * it with live values before it touches the API; a caller that skips it has no
 * protection at all.
 *
 * Everything is recomputed from `currentRoleIds`, `roles` and the two
 * hierarchy ceilings. The client's list is only ever a statement of intent —
 * it can ask for less than it is allowed, never for more.
 */
export function planMemberRoleChanges(
  request: RoleChangeRequest
): RoleChangePlan {
  const {
    guildId,
    currentRoleIds,
    desiredRoleIds,
    roles,
    actorHighestPosition,
    botHighestPosition,
    actorPermissionBits,
  } = request;

  const byId = new Map(roles.map((role) => [role.id, role]));
  const denied: RoleChangeDenial[] = [];
  const seen = new Set<string>();

  const deny = (roleId: string, reason: string) => {
    // The same role can be refused for more than one reason; the first, most
    // specific one is the useful one to show an operator.
    if (seen.has(roleId)) return;
    seen.add(roleId);
    denied.push({ roleId, reason });
  };

  // An actor without Manage Roles cannot make any change, no matter how low
  // the role sits or what the client asked for.
  const actorBits = bits(actorPermissionBits);
  if (actorBits === null)
    return {
      ...emptyPlan,
      denied: desiredRoleIds
        .filter((id) => !currentRoleIds.includes(id))
        .concat(currentRoleIds.filter((id) => !desiredRoleIds.includes(id)))
        .filter((id, index, all) => all.indexOf(id) === index)
        .map((roleId) => ({
          roleId,
          reason:
            "The acting member's permissions could not be read, so no role change was made.",
        })),
    };
  const actorIsAdmin = (actorBits & Permissions.Administrator) !== 0n;
  if (!actorIsAdmin && (actorBits & Permissions.ManageRoles) === 0n) {
    const asked = new Set([
      ...desiredRoleIds.filter((id) => !currentRoleIds.includes(id)),
      ...currentRoleIds.filter((id) => !desiredRoleIds.includes(id)),
    ]);
    return {
      ...emptyPlan,
      denied: [...asked].map((roleId) => ({
        roleId,
        reason: "The acting member no longer has Manage Roles permission.",
      })),
    };
  }

  // Whichever of the actor and the bot can reach least wins: a dashboard user
  // must not be able to borrow the bot's position.
  const ceiling = effectiveHierarchyCeiling(
    actorHighestPosition,
    botHighestPosition
  );

  // Roles that can never be added or removed by anyone here. @everyone is the
  // guild itself; managed roles belong to an integration and Discord rejects
  // any attempt to touch them.
  const assignable = new Set(
    assignableRoles(roles, guildId).map((role) => role.id)
  );
  // Roles inside the reach of both the actor and the bot.
  const reachable = new Set(rolesBelowCeiling(roles, ceiling).map((r) => r.id));

  const current = new Set(currentRoleIds);
  const desired = new Set(desiredRoleIds);

  const wanted = [
    ...new Set([
      ...desiredRoleIds.filter((id) => !current.has(id)),
      ...currentRoleIds.filter((id) => !desired.has(id)),
    ]),
  ];

  const add: string[] = [];
  const remove: string[] = [];

  for (const roleId of wanted) {
    const role = byId.get(roleId);
    if (!role) {
      deny(roleId, "This role no longer exists in this server.");
      continue;
    }
    if (role.id === guildId) {
      deny(roleId, "@everyone cannot be added or removed.");
      continue;
    }
    if (role.managed) {
      deny(
        roleId,
        "This role is managed by an integration and cannot be changed here."
      );
      continue;
    }
    if (!assignable.has(roleId)) {
      deny(roleId, "This role cannot be assigned from the dashboard.");
      continue;
    }
    if (!reachable.has(roleId)) {
      deny(
        roleId,
        `This role sits at or above the highest role the change can reach, so it cannot be changed.`
      );
      continue;
    }
    // Handing out permissions the actor does not hold is escalation. An
    // administrator already holds everything, so there is nothing to exceed.
    if (!actorIsAdmin) {
      const roleBits = bits(role.permissions);
      if (roleBits === null) {
        deny(
          roleId,
          "This role's permissions could not be read, so it was not changed."
        );
        continue;
      }
      const granted = roleBits & ~actorBits;
      if (granted !== 0n) {
        deny(
          roleId,
          "This role would grant permissions the acting member does not hold."
        );
        continue;
      }
    }

    if (current.has(roleId)) remove.push(roleId);
    else add.push(roleId);
  }

  return {
    add,
    remove,
    denied,
    noop: add.length === 0 && remove.length === 0,
  };
}

/**
 * The roles the editor should offer, in hierarchy order.
 *
 * This is advisory: it decides what the operator sees, never what the server
 * will accept. `planMemberRoleChanges` re-checks everything.
 */
export function offerableRoles(
  roles: readonly EditableRole[],
  guildId: string,
  actorHighestPosition: number,
  botHighestPosition: number,
  actorPermissionBits: string
): EditableRole[] {
  const actorBits = bits(actorPermissionBits);
  const actorIsAdmin =
    actorBits !== null && (actorBits & Permissions.Administrator) !== 0n;
  if (
    actorBits === null ||
    (!actorIsAdmin && (actorBits & Permissions.ManageRoles) === 0n)
  )
    return [];
  const ceiling = effectiveHierarchyCeiling(
    actorHighestPosition,
    botHighestPosition
  );
  return rolesBelowCeiling(assignableRoles(roles, guildId), ceiling).filter(
    (role) => {
      if (actorIsAdmin) return true;
      const roleBits = bits(role.permissions);
      if (roleBits === null) return false;
      // Cannot offer a role whose permissions the actor does not fully hold.
      return (roleBits & ~actorBits) === 0n;
    }
  );
}

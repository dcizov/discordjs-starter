/**
 * Shared role presentation rules.
 *
 * Roles are rendered in more than half a dozen places — the members table,
 * member detail, the roles view, pickers, channel overwrites, moderation
 * context — and each one had grown its own idea of what a role looks like.
 * These are the parts that are decisions rather than markup, kept pure so they
 * can be tested without rendering anything.
 */

/** The shape the dashboard holds for a guild role. */
export type PresentableRole = {
  id: string;
  name: string;
  /** Discord hex colour, `#rrggbb`. `""` for a role with no colour. */
  color: string;
  position: number;
  managed: boolean;
};

/**
 * What the UI needs in order to draw a role, resolved once.
 *
 * `hasColor` is deliberately separate from `color`: an uncoloured role still
 * needs a dot, just a neutral one, and callers must be able to tell the
 * difference between "Discord says no colour" and "this colour happens to be
 * dark". Colour is never the only signal — the name is always rendered.
 */
export type RoleSwatch = {
  /** A CSS colour to paint with, always safe to use. */
  css: string;
  /** True when Discord supplied a colour, false for the neutral fallback. */
  hasColor: boolean;
};

/** Used for `@everyone`-style and uncoloured roles in both themes. */
export const NEUTRAL_ROLE_COLOR = "#8b8b95";

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Resolve a role colour into something safe to paint.
 *
 * Discord stores `#000000` for "no colour" as well as for a genuinely black
 * role, and `""` for roles created without one; both are treated as uncoloured
 * so an uncoloured role never renders as a black dot that disappears on a dark
 * background. Anything unparseable falls back the same way rather than reaching
 * CSS as an invalid value.
 */
export function roleSwatch(color: string | null | undefined): RoleSwatch {
  if (!color) return { css: NEUTRAL_ROLE_COLOR, hasColor: false };
  const trimmed = color.trim();
  if (!HEX.test(trimmed)) return { css: NEUTRAL_ROLE_COLOR, hasColor: false };
  // #000000 is Discord's "no colour" sentinel, not a chosen colour.
  if (trimmed.toLowerCase() === "#000000")
    return { css: NEUTRAL_ROLE_COLOR, hasColor: false };
  return { css: trimmed.toLowerCase(), hasColor: true };
}

/**
 * Order roles the way Discord does: highest position first.
 *
 * Alphabetical or insertion order makes the list look arbitrary and hides which
 * role actually wins a permission conflict, so hierarchy is the only sensible
 * order. Equal positions are broken by name so the order is stable between
 * renders instead of depending on whatever order Discord sent rows in.
 */
export function sortRolesByHierarchy<
  T extends Pick<PresentableRole, "name" | "position">,
>(roles: readonly T[]): T[] {
  return [...roles].sort(
    (a, b) => b.position - a.position || a.name.localeCompare(b.name)
  );
}

export type RoleSplit<T> = {
  /** The roles to draw. */
  visible: T[];
  /** The roles collapsed into a "+N" affordance. */
  overflow: T[];
};

/**
 * Split roles for compact display.
 *
 * `max` counts drawn roles, not total roles; when nothing overflows the
 * remainder is empty and callers can skip the "+N" entirely. A non-positive
 * `max` collapses everything rather than drawing a nonsensical negative slice.
 */
export function splitRolesForDisplay<T>(
  roles: readonly T[],
  max: number
): RoleSplit<T> {
  const limit = Math.max(0, Math.floor(max));
  return {
    visible: roles.slice(0, limit),
    overflow: roles.slice(limit),
  };
}

/**
 * A readable summary of collapsed roles.
 *
 * The overflow control needs an accessible name listing everything it stands
 * for, so the screen-reader label and the tooltip come from the same string
 * rather than being written twice and drifting apart.
 */
export function describeRoles(
  roles: readonly Pick<PresentableRole, "name">[]
): string {
  const names = roles.map((role) => role.name);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Roles a member can be given from the dashboard.
 *
 * `@everyone` is the guild id and cannot be assigned or removed. Managed roles
 * belong to an integration — bots, boosts, linked roles — and Discord rejects
 * any attempt to touch them, so offering them produces an error the operator
 * cannot act on.
 */
export function assignableRoles<
  T extends Pick<PresentableRole, "id" | "managed">,
>(roles: readonly T[], everyoneRoleId: string): T[] {
  return roles.filter((role) => role.id !== everyoneRoleId && !role.managed);
}

/**
 * Roles a caller is allowed to touch, by hierarchy.
 *
 * Discord refuses to let a role be managed by someone whose own highest role
 * sits at or below it, and the same rule applies to the bot. Both ceilings are
 * checked because a dashboard user must not be able to borrow the bot's reach:
 * whichever limit is lower wins.
 *
 * `highestPosition` is the position of the caller's own top role. A role is
 * out of reach when its position is greater than or equal to that, so the
 * caller's own role is excluded too — Discord's rule, not a conservative
 * reinterpretation.
 */
export function rolesBelowCeiling<T extends Pick<PresentableRole, "position">>(
  roles: readonly T[],
  highestPosition: number
): T[] {
  return roles.filter((role) => role.position < highestPosition);
}

/**
 * The lower of the actor's and the bot's reach.
 *
 * Returns the effective ceiling for a role change, so callers cannot
 * accidentally use only one of the two and grant more than they should.
 */
export function effectiveHierarchyCeiling(
  actorHighestPosition: number,
  botHighestPosition: number
): number {
  return Math.min(actorHighestPosition, botHighestPosition);
}

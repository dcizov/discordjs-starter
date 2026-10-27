/**
 * Level rewards: which roles a member should hold for the level they have
 * reached, and what needs to change to get there.
 *
 * The policy is here, pure and testable. Applying it needs Discord — hierarchy,
 * whether the bot may manage a role, whether the role still exists — and that
 * lives in the bot. Nothing here assumes a reward will actually succeed.
 */

export type LevelReward = { level: number; roleId: string };

export type RewardGrantRecord = {
  level: number;
  roleId: string;
  /** Null when it was attempted and refused. */
  grantedAt: string | null;
  error: string | null;
};

/**
 * The rewards a member at `level` should hold.
 *
 * `stack` is the whole policy question, so it is explicit rather than implied:
 *
 * - **Stack** — every reward up to and including the current level is held. A
 *   level-10 member holds the level-5 and level-10 roles. This is the default,
 *   because members read a stack as a record of what they have passed through.
 * - **Replace** — only the highest reward reached is held; earlier ones are
 *   removed. Servers that use reward roles as a "current tier" marker want
 *   this, and it is why the choice exists at all.
 */
export function owedRewards(
  level: number,
  rewards: readonly LevelReward[],
  stack: boolean
): LevelReward[] {
  const reached = rewards
    .filter((reward) => reward.level > 0 && reward.level <= level)
    .sort((a, b) => a.level - b.level);
  if (!reached.length) return [];
  if (stack) return reached;
  const highest = reached[reached.length - 1];
  // With replace, rewards sharing the top level all apply — two roles at the
  // same level is a deliberate configuration, not a conflict.
  return reached.filter((reward) => reward.level === highest.level);
}

/**
 * Rewards the member should hold but does not yet have recorded.
 *
 * `availableRoleIds` is the set of roles that still exist. A reward whose role
 * was deleted is reported separately rather than silently dropped: an
 * operator needs to see that a configured reward is now dangling, and
 * pretending it is fine hides a broken configuration.
 */
export function pendingRewards(input: {
  owed: readonly LevelReward[];
  grants: readonly RewardGrantRecord[];
  availableRoleIds: readonly string[];
}): {
  /** Owed, never successfully granted, and the role still exists. */
  toGrant: LevelReward[];
  /** Owed and already recorded as granted. Nothing to do. */
  already: LevelReward[];
  /** Owed but the role is gone from the server. */
  missingRole: LevelReward[];
  /** Previously attempted and refused; worth retrying. */
  retry: LevelReward[];
} {
  const done = new Set(
    input.grants
      .filter((grant) => grant.grantedAt)
      .map((grant) => `${grant.level}:${grant.roleId}`)
  );
  const failed = new Set(
    input.grants
      .filter((grant) => !grant.grantedAt)
      .map((grant) => `${grant.level}:${grant.roleId}`)
  );
  const available = new Set(input.availableRoleIds);

  const toGrant: LevelReward[] = [];
  const already: LevelReward[] = [];
  const missingRole: LevelReward[] = [];
  const retry: LevelReward[] = [];

  for (const reward of input.owed) {
    const key = `${reward.level}:${reward.roleId}`;
    // Already granted means done, and it stays done. This is what stops a
    // retry from announcing the same level twice.
    if (done.has(key)) {
      already.push(reward);
      continue;
    }
    if (!available.has(reward.roleId)) {
      missingRole.push(reward);
      continue;
    }
    if (failed.has(key)) retry.push(reward);
    else toGrant.push(reward);
  }
  return { toGrant, already, missingRole, retry };
}

/**
 * Rewards a member has outranked.
 *
 * Only meaningful when stacking: with replace, earlier reward roles are meant
 * to be let go, so this returns every held reward that is no longer owed.
 */
export function rewardsToRevoke(input: {
  owed: readonly LevelReward[];
  grants: readonly RewardGrantRecord[];
  /** Roles the member currently holds, as Discord reports them. */
  heldRoleIds: readonly string[];
  stack: boolean;
}): string[] {
  const owedRoles = new Set(input.owed.map((reward) => reward.roleId));
  const granted = new Set(
    input.grants.filter((g) => g.grantedAt).map((g) => g.roleId)
  );
  // Only roles we actually granted are candidates. A role the member holds for
  // any other reason must never be taken away because a reward configuration
  // changed underneath them.
  const noLongerOwed = [...granted].filter((id) => !owedRoles.has(id));
  // With `replace`, losing the earlier tiers is the whole point, so the same
  // rule applies in both modes; only the set of owed roles differs.
  return noLongerOwed.filter((id) => input.heldRoleIds.includes(id));
}

/**
 * Whether a reward role may be granted at all.
 *
 * Administrator is refused outright: a leveling system must never be the way
 * someone acquires it, and no configuration should be able to ask.
 */
export function rewardRoleIssue(input: {
  roleExists: boolean;
  managed: boolean;
  isEveryone: boolean;
  hasAdministrator: boolean;
  /** Role sits at or above the highest role the bot can manage. */
  aboveBotReach: boolean;
}): string | null {
  if (!input.roleExists) return "This role no longer exists.";
  if (input.isEveryone) return "@everyone cannot be a level reward.";
  if (input.managed)
    return "This role is managed by an integration and cannot be granted.";
  if (input.hasAdministrator)
    // The one rule with no override. Reaching a level must never be a route to
    // Administrator.
    return "A level reward must never grant Administrator.";
  if (input.aboveBotReach)
    return "Move the Orbit role above the roles it rewards.";
  return null;
}

/**
 * The announcement text, with only the placeholders that exist.
 *
 * `{member}`, `{level}` and `{role}` are replaced and nothing else is
 * interpreted, so a server cannot smuggle a mention or a code block into a
 * message that gets posted publicly.
 */
export function renderAnnouncement(
  template: string,
  values: { member: string; level: number; role?: string | null }
): string {
  return template
    .replace(/\{member\}/g, values.member)
    .replace(/\{level\}/g, String(values.level))
    .replace(/\{role\}/g, values.role ?? "");
}

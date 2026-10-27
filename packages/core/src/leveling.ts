/**
 * Leveling: a guild-scoped progression record, separate from economy currency.
 *
 * The curve is the one MEE6 made standard and Carl-bot adopted, so levels
 * mean roughly what a member already expects them to mean. It is deliberately
 * fixed — a configurable curve would make every published level threshold
 * wrong the moment someone changed it.
 *
 * Checked 2026-10-27:
 *
 * - MEE6 documents the per-level cost as `5 * lvl^2 + 50 * lvl + 100` where
 *   `lvl` is the *current* level, and publishes a table whose first row is
 *   "level 0, 100 needed, 0 total".
 *   (github.com/Mee6/Mee6-documentation, docs/levels_xp.md)
 * - Carl-bot documents the same per-level cost and the cumulative closed form
 *   `(5/3)n^3 + (55/2)n^2 + (755/6)n + 100`.
 *   (github.com/botlabs-gg/carlbot-docs, docs/levels.md)
 *
 * Those two cumulative formulas are **not** the same polynomial, and that is
 * worth stating plainly because it is an off-by-one waiting to happen:
 * Carl-bot's `n` is one behind MEE6's level. `carl(n)` returns what MEE6 calls
 * the total for level `n + 1`. Both sources agree on the curve; they index it
 * differently. `totalXpForLevel` below is indexed the way MEE6's table is, and
 * a test asserts the two readings agree under that shift.
 */

/** Cost, in XP, to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const l = Math.max(0, Math.floor(level));
  return 5 * l * l + 50 * l + 100;
}

/**
 * Total XP a member must have accumulated to *reach* `level`.
 *
 * Level 0 is where everyone starts, so reaching it costs nothing. Reaching
 * level 1 costs 100. This is the cumulative figure, and it is not the same
 * question as "how much for the next level" — mixing the two is the single
 * most common way to get a leveling system wrong.
 */
export function totalXpForLevel(level: number): number {
  const L = Math.max(0, Math.floor(level));
  if (L === 0) return 0;
  // Sum of xpForLevel(k) for k in [0, L), in closed form. Verified against the
  // brute-force sum in tests up to level 1000.
  return Math.round((5 / 3) * L ** 3 + (45 / 2) * L ** 2 + (455 / 6) * L);
}

/** The highest level a member with `total` XP has reached. */
export function levelFromTotalXp(total: number): number {
  const t = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  // Walk the closed form backwards with a bounded search. The curve is
  // strictly increasing, so this is exact, and the search space is small
  // because a level costs quadratically more each time.
  let lo = 0;
  let hi = 1;
  while (totalXpForLevel(hi) <= t) hi *= 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (totalXpForLevel(mid) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type LevelProgress = {
  level: number;
  /** Total XP ever earned. */
  total: number;
  /** XP earned since reaching `level`. */
  into: number;
  /** XP needed to go from `level` to `level + 1`. */
  needed: number;
  /** XP still to earn before the next level. */
  remaining: number;
  /** 0..100, rounded, for progress bars. */
  percent: number;
};

export function levelProgress(total: number): LevelProgress {
  const t = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const level = levelFromTotalXp(t);
  const floorXp = totalXpForLevel(level);
  const into = t - floorXp;
  const needed = xpForLevel(level);
  return {
    level,
    total: t,
    into,
    needed,
    remaining: Math.max(0, needed - into),
    percent: needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 0,
  };
}

/**
 * A whole-number amount in `[min, max]`.
 *
 * `random` is injected so awards are seeded in tests. The caller is
 * responsible for using a source it is happy with.
 */
export function rollAward(
  min: number,
  max: number,
  random: () => number = Math.random
): number {
  const lo = Math.max(0, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  if (lo === hi) return lo;
  const r = random();
  const value = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  return lo + Math.floor(value * (hi - lo + 1));
}

// ---------------------------------------------------------------------------
// Voice eligibility
// ---------------------------------------------------------------------------

/**
 * What a voice award decision needs to know about one member in a channel.
 *
 * Deliberately does not mention Discord types: the bot builds this from
 * `VoiceState`, which is the only signal we are allowed to use. Presence is
 * not a substitute — Discord deprecated using it for this, and it cannot say
 * whether someone is muted.
 */
export type VoicePresence = {
  userId: string;
  bot?: boolean;
  /** Server-muted. */
  mute?: boolean;
  /** Server-deafened. */
  deaf?: boolean;
  /** Self-muted. */
  selfMute?: boolean;
  /** Self-deafened. */
  selfDeaf?: boolean;
};

export type VoiceEligibilityRules = {
  /** Humans required in the channel, including this member. Bots never count. */
  minParticipants: number;
  /** Whether a self-muted member still earns. */
  allowSelfMute: boolean;
  /** Whether a self-deafened member still earns. */
  allowSelfDeaf: boolean;
  /** Whether a server-muted member still earns. */
  allowServerMute: boolean;
  /** Whether a server-deafened member still earns. */
  allowServerDeaf: boolean;
};

export const defaultVoiceEligibility: VoiceEligibilityRules = {
  // Two humans, because one person sitting alone in a channel is not
  // participation and every maintained implementation excludes it.
  minParticipants: 2,
  // Self-muting is how people listen. Punishing it would make the system
  // hostile to exactly the quiet members it is meant to notice.
  allowSelfMute: true,
  // Deafening is the opposite: it says "I am not here".
  allowSelfDeaf: false,
  allowServerMute: false,
  allowServerDeaf: false,
};

export type VoiceEligibility = {
  eligible: boolean;
  /** Why not, when not. Safe to show a member. */
  reason: string | null;
};

/**
 * Whether one member earns for a voice interval they were present for.
 *
 * This answers the per-member question only. Whether the *channel* counts at
 * all — the AFK channel, an excluded channel — is decided before this by
 * `voiceChannelCounts`.
 */
export function voiceMemberEligible(
  presence: VoicePresence,
  everyone: readonly VoicePresence[],
  rules: VoiceEligibilityRules = defaultVoiceEligibility
): VoiceEligibility {
  if (presence.bot)
    return { eligible: false, reason: "Bots do not earn experience." };
  if (presence.deaf && !rules.allowServerDeaf)
    return { eligible: false, reason: "Server-deafened members do not earn." };
  if (presence.selfDeaf && !rules.allowSelfDeaf)
    return { eligible: false, reason: "Self-deafened members do not earn." };
  if (presence.mute && !rules.allowServerMute)
    return { eligible: false, reason: "Server-muted members do not earn." };
  if (presence.selfMute && !rules.allowSelfMute)
    return { eligible: false, reason: "Self-muted members do not earn." };
  const humans = everyone.filter((p) => !p.bot).length;
  if (humans < rules.minParticipants)
    return {
      eligible: false,
      reason: `At least ${rules.minParticipants} people must be in the channel.`,
    };
  return { eligible: true, reason: null };
}

/**
 * Whether a channel earns at all.
 *
 * The AFK channel is excluded because Discord moves people into it
 * automatically when they go idle — awarding XP there rewards not being there.
 */
export function voiceChannelCounts(
  channelId: string,
  afkChannelId: string | null
): boolean {
  return !!channelId && channelId !== afkChannelId;
}

/**
 * Whole-interval accounting.
 *
 * A member earns for an interval only if they were eligible for the whole of
 * it. Joining, leaving, moving channel or changing mute/deafen part-way means
 * no award for that interval and no partial credit. This is how Atlas and the
 * other maintained implementations do it, and it is the only version that is
 * fair: any partial rule invites gaming the boundary.
 */
export type VoiceIntervalObservation = {
  /** Present for the entire interval. */
  presentWholeInterval: boolean;
  /** Channel did not change during the interval. */
  stableChannel: boolean;
  /** Eligible (mute/deafen/participants) at every sample. */
  eligibleThroughout: boolean;
};

export function voiceIntervalAwards(
  observation: VoiceIntervalObservation
): boolean {
  return (
    observation.presentWholeInterval &&
    observation.stableChannel &&
    observation.eligibleThroughout
  );
}

/**
 * Cap a session's earning length.
 *
 * `capMinutes` of 0 means no cap. A cap exists because voice XP is otherwise
 * the cheapest thing in the system to farm by leaving a client connected
 * overnight.
 */
export function cappedIntervals(
  intervalsThisSession: number,
  capMinutes: number,
  intervalSeconds: number
): { awarded: boolean; exhausted: boolean } {
  if (capMinutes <= 0) return { awarded: true, exhausted: false };
  const maxIntervals = Math.floor((capMinutes * 60) / intervalSeconds);
  if (intervalsThisSession < maxIntervals)
    return { awarded: true, exhausted: false };
  return { awarded: false, exhausted: true };
}

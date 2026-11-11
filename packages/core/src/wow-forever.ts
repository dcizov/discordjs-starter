/**
 * WoW: Forever ruleset availability.
 *
 * **What this can and cannot see, stated first, because the whole feature
 * rests on it.**
 *
 * WoW: Forever has no realms. Players pick a *ruleset* — Normal, PvP,
 * Roleplay, Roleplay-PvP — and the character-creation screen sometimes answers
 * "This ruleset is temporarily unavailable". That error is emitted by the
 * game's own login/creation services, not by the web API.
 *
 * What the Battle.net API *does* expose is a ruleset resource with a status:
 *
 *   GET /data/wow/ruleset/index        -> { rulesets: [{ id, key }] }
 *   GET /data/wow/ruleset/{id}         -> { id, name, auctions, status }
 *
 * where `status` is `{ type, name }` and `type` is `UP` when the ruleset is
 * serving. So this module answers "is the ruleset reporting UP?", which is the
 * most common cause of that error — rulesets being closed for maintenance or
 * not yet open — and it is *not* the error itself.
 *
 * It explicitly cannot see:
 *
 * - **The faction lock.** "This faction is currently unavailable due to
 *   population imbalance" is a deliberate balance policy on PvP rulesets.
 *   Blizzard states Support cannot bypass it. It is not an outage and no
 *   status field reports it.
 * - **Throttling.** "Creation of that type of character is currently
 *   throttled" is load control, likewise invisible here.
 * - **Per-player blocks.** A client-language or account-region mismatch
 *   produces the same message for one person and nobody else.
 *
 * The status is served by the web API and the error by the game servers, and
 * the two are separate systems that have disagreed — during the 9 November
 * emergency maintenance the game was down with no evidence the web API status
 * moved. So every message this produces says *a ruleset is not reporting UP*,
 * never "players are seeing the error". A monitor that overstates what it knows
 * gets ignored the first time it is wrong.
 *
 * Everything here is pure: no network, no credentials, no Discord. That is
 * deliberate — the interesting behaviour (what counts as a change, what must
 * never be announced) is exactly the part that cannot be checked against the
 * live API from CI, so it has to be checkable without one.
 */

/** Regions that serve WoW: Forever. `cn` has its own gateway and no Forever. */
export const WOW_FOREVER_REGIONS = ["us", "eu", "kr", "tw"] as const;
export type WowForeverRegion = (typeof WOW_FOREVER_REGIONS)[number];

/**
 * The only `status.type` value known to mean "this ruleset is serving".
 *
 * Known by observation, not from documentation: Forever's API is undocumented
 * by Blizzard, and `UP` is what the live rulesets report when healthy.
 */
export const RULESET_STATUS_UP = "UP";

/**
 * What we can say about a ruleset.
 *
 * `unknown` is not a euphemism for `down`, and collapsing the two is the one
 * mistake that would make this feature worse than useless. A poll that failed —
 * network error, 429, 5xx, credentials missing — tells you nothing at all about
 * the ruleset. Announcing an outage because our own request was rate-limited is
 * how a monitor loses the room.
 */
export type RulesetState = "up" | "down" | "unknown";

/** One ruleset, as of one poll. */
export type RulesetSnapshot = {
  id: number;
  name: string;
  /**
   * The raw `status.type`, kept verbatim.
   *
   * Anything other than `UP` is treated as not-up, but the value is never
   * discarded: if Blizzard starts reporting `MAINTENANCE` or `FULL`, the
   * message a reader sees names it, instead of a confident "down" we invented.
   */
  raw: string;
  state: RulesetState;
};

/** Classify one raw status value. Absent or empty is unknown, not down. */
export function classifyRulesetStatus(
  raw: string | undefined | null
): RulesetState {
  if (!raw) return "unknown";
  return raw.trim().toUpperCase() === RULESET_STATUS_UP ? "up" : "down";
}

/** A ruleset whose availability changed between two polls. */
export type RulesetFlip = {
  id: number;
  name: string;
  from: RulesetState;
  to: RulesetState;
  raw: string;
};

/**
 * The changes worth telling anyone about.
 *
 * Only a genuine up <-> down transition is returned. Anything touching
 * `unknown` is dropped: it means one of the two polls failed, and a failed poll
 * is not a change in the world — it is a gap in what we know. Reporting
 * `up -> unknown` as "the ruleset went down" would fire on every rate-limit,
 * and `unknown -> up` would fire every time we recovered from one.
 *
 * Rulesets present in only one of the two polls are ignored for the same
 * reason: a ruleset appearing or disappearing from the index is Blizzard
 * changing the index, not necessarily the ruleset changing state, and there is
 * no prior reading to compare it against.
 */
export function diffRulesets(
  previous: readonly RulesetSnapshot[],
  current: readonly RulesetSnapshot[]
): RulesetFlip[] {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  const flips: RulesetFlip[] = [];
  for (const now of current) {
    const was = before.get(now.id);
    if (!was) continue;
    if (was.state === "unknown" || now.state === "unknown") continue;
    if (was.state === now.state) continue;
    flips.push({
      id: now.id,
      name: now.name,
      from: was.state,
      to: now.state,
      raw: now.raw,
    });
  }
  return flips;
}

/** One line describing what a poll found, for the status command. */
export type RulesetSummary = {
  total: number;
  up: number;
  down: number;
  unknown: number;
  /** The rulesets not reporting `UP`, with the raw status each gave. */
  notUp: RulesetSnapshot[];
};

export function summarizeRulesets(
  snapshots: readonly RulesetSnapshot[]
): RulesetSummary {
  const notUp = snapshots.filter((entry) => entry.state !== "up");
  return {
    total: snapshots.length,
    up: snapshots.filter((entry) => entry.state === "up").length,
    down: snapshots.filter((entry) => entry.state === "down").length,
    unknown: snapshots.filter((entry) => entry.state === "unknown").length,
    notUp,
  };
}

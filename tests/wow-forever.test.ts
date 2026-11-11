/*
 * Ruleset availability: the part that can be checked without credentials.
 *
 * Everything in this file runs against plain values, because the behaviour that
 * decides whether this feature is worth having is behaviour no live API call
 * can exercise from CI: what counts as a change, and what must never be
 * announced. Live responses are covered by `tests/wow-forever-live.test.ts`,
 * which skips without credentials.
 */
import { describe, expect, it } from "vitest";
import {
  classifyRulesetStatus,
  diffRulesets,
  summarizeRulesets,
  type RulesetSnapshot,
} from "../packages/core/src/wow-forever";

const snap = (
  id: number,
  state: RulesetSnapshot["state"],
  raw: string = state === "unknown" ? "" : state.toUpperCase()
): RulesetSnapshot => ({ id, name: `Ruleset ${id}`, raw, state });

describe("classifyRulesetStatus", () => {
  it("treats UP as up, however it is cased or padded", () => {
    for (const value of ["UP", "up", " Up ", "\tUP\n"])
      expect(classifyRulesetStatus(value)).toBe("up");
  });

  it("treats any other reported value as not up, without inventing a meaning", () => {
    // Forever's API is undocumented; a future MAINTENANCE or FULL must read as
    // not-up, because it is not UP, and the raw value is carried through
    // separately rather than being guessed at here.
    for (const value of ["DOWN", "MAINTENANCE", "FULL", "OFFLINE"])
      expect(classifyRulesetStatus(value)).toBe("down");
  });

  it("treats a missing status as unknown rather than down", () => {
    // A ruleset the API described without a status is not evidence of an
    // outage; it is evidence that we did not learn its status.
    for (const value of [undefined, null, ""])
      expect(classifyRulesetStatus(value)).toBe("unknown");
  });
});

describe("diffRulesets", () => {
  it("reports a ruleset that stopped being up", () => {
    expect(
      diffRulesets(
        [snap(1, "up"), snap(2, "up")],
        [snap(1, "up"), snap(2, "down")]
      )
    ).toEqual([
      { id: 2, name: "Ruleset 2", from: "up", to: "down", raw: "DOWN" },
    ]);
  });

  it("reports a ruleset that came back", () => {
    expect(diffRulesets([snap(1, "down")], [snap(1, "up")])).toEqual([
      { id: 1, name: "Ruleset 1", from: "down", to: "up", raw: "UP" },
    ]);
  });

  it("reports nothing when nothing changed", () => {
    const before = [snap(1, "up"), snap(2, "down")];
    expect(diffRulesets(before, [snap(1, "up"), snap(2, "down")])).toEqual([]);
  });

  /*
   * The property this whole module exists to protect.
   *
   * A poll that failed tells us nothing about the ruleset. If `unknown` were
   * allowed to participate in a flip, every rate-limited request, every 5xx and
   * every expired credential would announce an outage that did not happen — and
   * every recovery would announce a fix. One false alarm like that and nobody
   * reads these messages again.
   */
  it("never reports a change when either poll failed", () => {
    const cases: [RulesetSnapshot[], RulesetSnapshot[]][] = [
      // We lost the connection: the ruleset may well still be fine.
      [[snap(1, "up")], [snap(1, "unknown")]],
      // We came back after losing it: nothing about the ruleset changed.
      [[snap(1, "unknown")], [snap(1, "up")]],
      // Still failing: certainly not news.
      [[snap(1, "unknown")], [snap(1, "unknown")]],
      // Failed, then the ruleset genuinely went down. The honest answer is
      // still "we do not know what it was before", so this waits for the next
      // clean pair rather than guessing.
      [[snap(1, "unknown")], [snap(1, "down")]],
    ];
    for (const [before, after] of cases)
      expect(
        diffRulesets(before, after),
        `${before[0].state} -> ${after[0].state}`
      ).toEqual([]);
  });

  it("ignores rulesets that only one of the two polls saw", () => {
    // Blizzard editing the ruleset index is not a ruleset changing state, and
    // there is no prior reading to compare a new ruleset against.
    expect(
      diffRulesets([snap(1, "up")], [snap(1, "up"), snap(9, "down")])
    ).toEqual([]);
    expect(
      diffRulesets([snap(1, "up"), snap(9, "down")], [snap(1, "up")])
    ).toEqual([]);
  });

  it("reports every ruleset that changed, not just the first", () => {
    const flips = diffRulesets(
      [snap(1, "up"), snap(2, "up"), snap(3, "down")],
      [snap(1, "down"), snap(2, "up"), snap(3, "up")]
    );
    expect(flips.map((flip) => `${flip.id}:${flip.from}->${flip.to}`)).toEqual([
      "1:up->down",
      "3:down->up",
    ]);
  });
});

describe("summarizeRulesets", () => {
  it("counts each state and lists everything that is not up", () => {
    const summary = summarizeRulesets([
      snap(1, "up"),
      snap(2, "up"),
      snap(3, "down", "MAINTENANCE"),
      snap(4, "unknown"),
    ]);
    expect(summary).toMatchObject({ total: 4, up: 2, down: 1, unknown: 1 });
    // The raw value survives into the summary, so an unfamiliar status is
    // shown rather than flattened into a word we chose.
    expect(summary.notUp.map((entry) => entry.raw)).toEqual([
      "MAINTENANCE",
      "",
    ]);
  });

  it("describes an empty index without pretending that means an outage", () => {
    // No rulesets at all is what an unreachable or unconfigured API looks like.
    // It must not read as "everything is fine" or "everything is down".
    expect(summarizeRulesets([])).toMatchObject({
      total: 0,
      up: 0,
      down: 0,
      unknown: 0,
      notUp: [],
    });
  });
});

/*
 * Whether a source has primed, and what its next check will do.
 *
 * The point of `sourcePriming` is that priming is otherwise invisible: a source
 * that has recorded its back catalogue and one that has not both simply render
 * as "Healthy". These tests pin the difference, including the two ways a source
 * quietly becomes un-primed again — a changed URL, and a pause.
 */
import { describe, expect, it } from "vitest";
import {
  firstFetchDescription,
  primingNote,
  sourcePriming,
} from "@orbit/core/feed-priming";
import { feedIdentity } from "@orbit/core/feed-identity";

/**
 * A source row, with only the fields priming depends on. `data` overrides go
 * into `data`; `enabled` is top-level on a resource, so it is passed apart.
 */
function source(data: Record<string, unknown> = {}, enabled = true) {
  return {
    kind: "source" as const,
    id: "11111111-1111-1111-1111-111111111111",
    enabled,
    data: {
      adapter: "rss",
      url: "https://example.com/feed",
      firstFetchPostCount: 0,
      ...data,
    } as Record<string, unknown>,
  };
}

const identity = (s: ReturnType<typeof source>) => feedIdentity(s);

describe("sourcePriming", () => {
  it("is pending when nothing has been recorded", () => {
    const result = sourcePriming(source());
    expect(result.state).toBe("pending");
    expect(result.primed).toBe(false);
    expect(result.label).toBe("Priming on next check");
  });

  it("says the first check posts none of it when the setting is 0", () => {
    expect(sourcePriming(source()).detail).toMatch(
      /records what is already there and posts none of it/
    );
  });

  it("says how many the first check will post when the setting is raised", () => {
    const result = sourcePriming(source({ firstFetchPostCount: 3 }));
    expect(result.postFirst).toBe(3);
    expect(result.detail).toMatch(/posts the newest 3 and records the rest/);
  });

  it("clamps an out-of-range setting from jsonb rather than echoing it", () => {
    // `data` is jsonb, so a value that slipped past the schema is possible.
    // Echoing 99 into the UI would promise something the worker will not do.
    expect(sourcePriming(source({ firstFetchPostCount: 99 })).postFirst).toBe(
      5
    );
    expect(sourcePriming(source({ firstFetchPostCount: -4 })).postFirst).toBe(
      0
    );
  });

  it("is primed once the recorded identity matches the current feed", () => {
    const s = source();
    const result = sourcePriming(source({ primedFeed: identity(s) }));
    expect(result.state).toBe("primed");
    expect(result.primed).toBe(true);
    expect(result.label).toBe("Primed");
  });

  /*
   * The self-maintaining part. If this regressed, an operator who repointed a
   * source would see "Primed" while the worker silently re-primed, and the UI
   * would be asserting the opposite of what happened.
   */
  it("goes back to pending when the URL changes", () => {
    const s = source();
    const primed = source({ primedFeed: identity(s) });
    expect(sourcePriming(primed).state).toBe("primed");
    const moved = source({
      primedFeed: identity(s),
      url: "https://example.com/other",
    });
    expect(sourcePriming(moved).state).toBe("pending");
  });

  it("goes back to pending when the adapter changes", () => {
    const s = source();
    const switched = source({
      primedFeed: identity(s),
      adapter: "steam",
      appId: "570",
    });
    expect(sourcePriming(switched).state).toBe("pending");
  });

  it("treats a missing record as pending, never as primed", () => {
    // `undefined === "rss:..."` is false, which is the safe direction: an
    // unprimed source reports that it will prime.
    expect(sourcePriming(source({ primedFeed: undefined })).primed).toBe(false);
  });

  it("says a paused source will prime when it resumes", () => {
    // Pausing clears the record, so resuming must not post the backlog that
    // accrued while it was off. The detail has to say when, not just that.
    const result = sourcePriming(source({}, false));
    expect(result.state).toBe("pending");
    expect(result.detail).toMatch(/Paused/);
    expect(result.detail).toMatch(/enabled again/);
  });

  it("does not apply to webhook sources, which are pushed to", () => {
    const result = sourcePriming(
      source({ adapter: "webhook", primedFeed: "whatever" })
    );
    expect(result.state).toBe("not-applicable");
    expect(result.postFirst).toBe(0);
  });
});

describe("firstFetchDescription", () => {
  /*
   * The sentence is future tense because a test flight does not prime. It
   * fetches, shows and updates health. Saying "recorded" in the past tense
   * would be false, and an operator who believed it would expect nothing more
   * and then be surprised by the real check.
   */
  it("describes what the next check would do, in the future tense", () => {
    expect(firstFetchDescription(10, 0)).toBe(
      "10 items recorded as already seen; new items will post from now on. Post on first check is 0."
    );
  });

  it("splits the count when some will post", () => {
    expect(firstFetchDescription(10, 2)).toBe(
      "8 items recorded as already seen; the newest 2 will post, and anything newer from then on. Post on first check is 2."
    );
  });

  it("uses the singular for one item", () => {
    expect(firstFetchDescription(1, 0)).toMatch(/^1 item recorded/);
  });

  it("does not claim it recorded anything when the feed is empty", () => {
    expect(firstFetchDescription(0, 0)).toMatch(/^Nothing to record/);
  });

  it("never says more will post than the feed has", () => {
    // Two items found, five asked for: five did not post.
    expect(firstFetchDescription(2, 5)).toBe(
      "Nothing to record as seen; the newest 2 will post, and anything newer from then on. Post on first check is 5."
    );
  });

  it("clamps the setting it quotes, so the UI cannot outpromise the worker", () => {
    expect(firstFetchDescription(100, 99)).toMatch(
      /Post on first check is 5\./
    );
  });
});

/*
 * The note is the sentence an operator actually reads, so the risk is it
 * describing a first fetch that is not going to happen.
 */
describe("primingNote", () => {
  it("describes the next check, for a source that has not primed", () => {
    expect(primingNote(source(), 10)).toBe(
      "10 items recorded as already seen; new items will post from now on. Post on first check is 0."
    );
  });

  it("does not claim a primed source is about to record anything", () => {
    // Showing the first-fetch sentence here would be plainly false: this
    // source primed already, so its next check posts new items normally.
    const s = source();
    const note = primingNote(source({ primedFeed: identity(s) }), 10);
    expect(note).not.toMatch(/recorded as already seen/);
    expect(note).toMatch(/recorded as seen/i);
  });

  it("says a paused source primes when it resumes, not on the next tick", () => {
    expect(primingNote(source({}, false), 4)).toMatch(/Paused/);
  });

  it("has nothing to claim about a webhook source's back catalogue", () => {
    expect(primingNote(source({ adapter: "webhook" }), 0)).toMatch(
      /pushed to this source/
    );
  });
});

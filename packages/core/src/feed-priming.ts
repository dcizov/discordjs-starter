/**
 * What a source's first fetch is allowed to post.
 *
 * A feed's existing contents are not news. Adding a source should not publish
 * its whole front page into a channel, and re-enabling one should not publish
 * everything that accrued while it was off. So the first fetch after a source
 * is created — or after its priming stops applying — records what is already
 * there and posts none of it, unless the operator asked for the newest few as
 * proof that the feed works.
 *
 * "Priming" is the record that a feed's current contents have been seen. It is
 * stored on the source as `data.primedFeed`, holding the feed identity it was
 * primed for. Comparing it with the source's *current* identity is what makes
 * the rule self-maintaining: point the source at a different URL, or switch it
 * between RSS and Steam, and the identity changes, so the next fetch primes
 * again instead of treating a different feed's back catalogue as already seen.
 * Pausing a source clears it, so re-enabling starts clean.
 *
 * The split is kept pure and in `core` so it can be tested without a worker, a
 * Redis queue or a database. The caller decides what "post" and "record" mean.
 */

import { feedIdentity } from "./feed-identity";
import type { Resource } from "./types";

/** Largest number of items a first fetch may be configured to post. */
export const FIRST_FETCH_POST_LIMIT = 5;

export type FirstFetchPlan<T> = {
  /** The newest items, at most `postNewest` of them. These may be posted. */
  post: T[];
  /**
   * Everything else, still newest-first. These must be *recorded* as seen, not
   * dropped: dropping them is how the next poll finds the same back catalogue
   * and posts it after all, one poll late.
   */
  skip: T[];
};

/**
 * Split one poll's items into "may post" and "record as seen".
 *
 * Sorted newest-first by `publishedAt`, so "the newest N" is the newest N
 * whatever order the feed happened to list them in. An item with no usable
 * date sorts last, so an undated entry can never displace a dated one from the
 * front of the list.
 */
export function planFirstFetch<T extends { publishedAt?: string }>(
  items: T[],
  postNewest: number
): FirstFetchPlan<T> {
  const newestFirst = [...items].sort(
    (a, b) => publishedTime(b) - publishedTime(a)
  );
  const keep = Math.max(
    0,
    Math.min(FIRST_FETCH_POST_LIMIT, Math.trunc(postNewest) || 0)
  );
  return {
    post: newestFirst.slice(0, keep),
    skip: newestFirst.slice(keep),
  };
}

function publishedTime(item: { publishedAt?: string }): number {
  const time = Date.parse(item.publishedAt ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** `firstFetchPostCount` is operator input from jsonb, so it is clamped again here. */
function postFirstCount(value: unknown): number {
  return Math.max(
    0,
    Math.min(FIRST_FETCH_POST_LIMIT, Math.trunc(Number(value)) || 0)
  );
}

export type PrimingState =
  /** The feed's current contents are recorded as seen; new items post. */
  | "primed"
  /** The next check will record what is there and post at most `postFirst`. */
  | "pending"
  /** Nothing is polled, so there is no back catalogue to prime against. */
  | "not-applicable";

export type SourcePriming = {
  state: PrimingState;
  /** Whether the source's current contents have already been recorded. */
  primed: boolean;
  /** How many items the first fetch may post. */
  postFirst: number;
  /** Short label for a badge. */
  label: string;
  /** One sentence carrying the facts, for the operator. */
  detail: string;
};

/**
 * Whether a source's first fetch has happened yet, and what the next one will
 * do.
 *
 * This exists because priming is otherwise invisible. The worker logs how many
 * items it recorded, and the editor exposes a "Post on first check" field, but
 * nothing tells an operator which side of that line a source is currently on.
 * The two look identical from the dashboard: a source that has primed and a
 * source that has not are both simply "Healthy". That is the gap — an operator
 * who adds a source and sees no posts cannot tell "working, nothing new yet"
 * from "still holding its back catalogue", and the second one is a
 * configuration they chose and may want to change.
 *
 * Compared against the *current* feed identity rather than merely being
 * present, so changing a source's URL makes it pending again — which is what
 * the worker will actually do.
 */
export function sourcePriming(
  source: Pick<Resource, "kind" | "id" | "data" | "enabled">
): SourcePriming {
  const postFirst = postFirstCount(source.data.firstFetchPostCount);
  // Webhook sources are pushed to, never polled, so there is no catalogue to
  // record. The editor disables the field for the same reason.
  if (source.data.adapter === "webhook")
    return {
      state: "not-applicable",
      primed: true,
      postFirst: 0,
      label: "Posts on arrival",
      detail:
        "Events are pushed to this source, so there is no back catalogue to record first.",
    };

  const primed =
    !!source.data.primedFeed && source.data.primedFeed === feedIdentity(source);
  if (primed)
    return {
      state: "primed",
      primed: true,
      postFirst,
      label: "Primed",
      detail:
        "This feed's current contents are recorded as seen. New items post as they appear.",
    };

  const posts = postFirst
    ? `posts the newest ${postFirst} and records the rest`
    : "records what is already there and posts none of it";
  return {
    state: "pending",
    primed: false,
    postFirst,
    label: "Priming on next check",
    // Pausing clears the priming record, so a resumed source primes again
    // rather than posting everything that accrued while it was off.
    detail: source.enabled
      ? `The next check ${posts}. After that, new items post as they appear.`
      : `Paused. When it is enabled again, its first check ${posts}.`,
  };
}

/**
 * What the next check will do with the items a test flight just found, in one
 * sentence.
 *
 * Written in the future tense on purpose. A test flight does **not** prime: it
 * fetches, shows, and updates health. Claiming "10 items were recorded" would
 * be false, and an operator who believed it would expect nothing further and
 * be surprised when the check posts. So: what *would* happen.
 */
export function firstFetchDescription(
  itemCount: number,
  postFirst: number
): string {
  const post = postFirstCount(postFirst);
  const count = Math.max(0, Math.trunc(Number(itemCount)) || 0);
  // How many will actually post is bounded by what the feed has. Quoting the
  // setting here instead would promise five posts from a two-item feed.
  const posting = Math.min(count, post);
  const recorded = Math.max(0, count - posting);
  const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  const opening = recorded
    ? `${items(recorded)} recorded as already seen; `
    : "Nothing to record as seen; ";
  const middle =
    posting > 0
      ? `the newest ${posting} will post, and anything newer from then on.`
      : "new items will post from now on.";
  // The setting is quoted as set, not as clamped by the feed: the operator
  // asked for 5, and the feed only had 2, which are different facts.
  return `${opening}${middle} Post on first check is ${post}.`;
}

/**
 * The one sentence to show about priming, for a source being previewed.
 *
 * It has to be derived from the state rather than always describing a first
 * fetch, because saying "10 items recorded as already seen" about a source that
 * primed last week is simply false — that is the one claim guaranteed to make
 * an operator distrust the rest of the panel. So: a pending source gets what
 * its next check will do with `itemCount`, and anything else gets the plain
 * description of its state.
 */
export function primingNote(
  source: Pick<Resource, "kind" | "id" | "data" | "enabled">,
  itemCount: number
): string {
  const priming = sourcePriming(source);
  // Only an enabled, unprimed source is about to run the fetch this sentence
  // describes. A paused one has no next check at all, and "the next check will
  // record 10 items" would be a promise about a tick that never comes.
  return priming.state === "pending" && source.enabled !== false
    ? firstFetchDescription(itemCount, priming.postFirst)
    : priming.detail;
}

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

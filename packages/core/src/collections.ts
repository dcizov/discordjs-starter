/*
 * Map helpers. There is only one here, because there was only one idiom
 * repeated in six places.
 */

/**
 * Drop the oldest entry — the first key a `Map` yields, since Map preserves
 * insertion order. This is the eviction half of an LRU.
 *
 * Returns whether anything was removed. That is the part that matters: the
 * callers all sit in a `while (map.size > limit)` loop, and
 * `map.keys().next().value!` asserts the map is non-empty rather than
 * checking. It happens to hold, because the loop condition implies at least
 * one entry, so the bug this prevents is a future one — a caller that moves
 * the delete out of the loop, or changes the condition, and gets `undefined`
 * passed to `delete` instead of a stop.
 */
export function evictOldest<K, V>(map: Map<K, V>): boolean {
  const oldest = map.keys().next();
  if (oldest.done) return false;
  return map.delete(oldest.value);
}

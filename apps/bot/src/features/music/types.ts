/**
 * Shared music data shapes.
 *
 * This is a leaf module on purpose. `ResolvedTrack` used to live in
 * `service.ts`, and `search-session.ts` imported it back from there while
 * `service.ts` imports `MusicSearchSessions` from `search-session.ts` — a
 * cycle in the module graph. The import was type-only and therefore erased at
 * runtime, but cycles that depend on erasure are cycles waiting to happen: any
 * change to module syntax settings, or one value import added alongside the
 * type, turns it into a real one.
 *
 * Moving the shape here means `search-session.ts` depends on a leaf instead of
 * on the module that depends on it. `service.ts` re-exports the type so
 * existing importers are unaffected.
 */

/** One playable track, normalized from whatever the provider returned. */
export type ResolvedTrack = {
  encoded: string;
  title: string;
  author: string;
  duration: number;
  uri: string;
  source: string;
  /** Validated public artwork URL from the provider, when it supplied one. */
  artwork?: string | null;
};

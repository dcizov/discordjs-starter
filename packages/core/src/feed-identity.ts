/**
 * What a delivery is deduplicated *against*.
 *
 * Deliveries used to be keyed on `(guild, source_id, external_id, channel)`.
 * `source_id` is the row id of the resource, not anything about the feed, so
 * deleting a source and recreating it pointing at the same URL gave every item
 * a brand-new key and the worker re-posted the whole feed. A feed's identity
 * has to come from the feed.
 *
 * Two rules decide it:
 *
 * - **A fetched feed is identified by what is fetched.** An RSS/Atom feed by
 *   its normalized URL; a Steam source by `steam:<appId>`. Two source rows
 *   pointing at the same URL are the same feed, which is the point.
 * - **A pushed feed is identified by its endpoint.** A webhook source has no
 *   upstream to name: the source row *is* the feed — it owns the URL and the
 *   signing secret — so recreating one genuinely creates a new feed and must
 *   not inherit the old one's history.
 */

/**
 * Collapse the variations that are the same feed.
 *
 * `HTTPS://WWW.Example.com/Feed/` and `http://example.com/feed` are one feed.
 *
 * The steps are deliberately few and deliberately cheap, because migration
 * `0013_feed_identity` backfills `feed_identity` for every existing delivery
 * **in SQL** and the two implementations must produce byte-identical strings:
 * if they drift, an old row and the new row for the same feed disagree and the
 * feed is re-posted, which is the exact bug this exists to fix.
 *
 * So: lowercase, drop the scheme, drop `www.`, drop the fragment, drop
 * trailing slashes. No URL parsing, no query re-ordering, no port arithmetic —
 * none of it can be mirrored faithfully in a `regexp_replace` chain. Feed URLs
 * are already required to be HTTPS (`assertFeedUrl` in `safety.ts`), so the
 * scheme carries no information either way.
 *
 * `tests/feed-identity.test.ts` applies the real migration to a real
 * PostgreSQL (PGlite) and asserts the two agree. Change either and that test
 * fails; do not change one without the other.
 */
export function normalizeFeedUrl(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

/**
 * The stable identity of the feed a resource reads.
 *
 * Empty only for a source with neither a URL nor an app id, which is a source
 * that has never been configured and so cannot have delivered anything.
 */
export function feedIdentity(resource: {
  kind?: string;
  id?: string;
  /**
   * Resource `data` is jsonb and every kind stores different keys, so this
   * cannot be narrowed usefully. The fields read below are the only ones that
   * decide an identity.
   */
  data?: Record<string, any> | null;
}): string {
  const data = resource.data ?? {};
  if (resource.kind === "deal") return `deal:${data.gameId || ""}`;
  switch (data.adapter) {
    case "steam":
      return `steam:${data.appId ?? ""}`;
    case "webhook":
      // The endpoint and its secret belong to the row, not to an upstream.
      return `webhook:${resource.id ?? ""}`;
    default:
      return `rss:${normalizeFeedUrl(data.url ?? "")}`;
  }
}

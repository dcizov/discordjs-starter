-- Key deliveries on the feed, not on the source row.
--
-- `deliveries` was deduplicated by `(guild_id, source_id, external_id,
-- channel_id)`. `source_id` is the row id of the `resources` row, which says
-- nothing about the feed being read: deleting a news source and adding it
-- again with the same URL gave every item a brand-new key, and the next poll
-- re-posted the entire feed into the channel. That is the "re-post storm".
--
-- The key is now `(guild_id, channel_id, feed_identity, external_id)`, where
-- `feed_identity` names the feed itself -- the normalized URL for RSS/Atom,
-- `steam:<appId>` for Steam. Two source rows pointing at the same feed are the
-- same feed, which is the whole point. `channel_id` stays in the key: moving a
-- feed to a new channel should post there once, not stay silent.
--
-- `source_id` is kept. It is no longer part of any key; it is display and
-- history only, so the dashboard can still say which source a post came from.
-- It is deliberately still not a foreign key: deliveries outlive their source
-- row by design, and cascading them away would erase history.
ALTER TABLE "deliveries" ADD COLUMN "feed_identity" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill every delivery from the source that produced it.
--
-- The normalization is duplicated from `normalizeFeedUrl` in
-- `packages/core/src/feed-identity.ts`, and the two must produce byte-identical
-- strings: if they drift, an old row and a new row for the same feed disagree
-- and the feed is re-posted, which is the exact bug this migration fixes. So it
-- is deliberately small -- lowercase, drop the scheme, drop `www.`, drop the
-- fragment, drop trailing slashes -- with no URL parsing and no query
-- re-ordering, none of which can be mirrored faithfully in SQL.
-- `tests/feed-identity.test.ts` applies this file to a real PostgreSQL and
-- asserts the two agree, so changing either without the other fails the suite.
--
-- Feed URLs are already required to be HTTPS (`assertFeedUrl`), so the scheme
-- carries no information; it is dropped rather than normalized.
--
-- `resources.id` is a uuid and `deliveries.source_id` is text, so the join
-- needs an explicit cast: the column is not a foreign key.
UPDATE "deliveries" AS d
SET "feed_identity" = CASE
  WHEN r."kind" = 'deal'
    THEN 'deal:' || COALESCE(r."data"->>'gameId', '')
  WHEN r."data"->>'adapter' = 'steam'
    THEN 'steam:' || COALESCE(r."data"->>'appId', '')
  -- A pushed feed has no upstream to name: the row owns the endpoint URL and
  -- the signing secret, so recreating one genuinely creates a new feed and
  -- must not inherit the old one's history.
  WHEN r."data"->>'adapter' = 'webhook'
    THEN 'webhook:' || r."id"::text
  ELSE 'rss:' || regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(btrim(COALESCE(r."data"->>'url', ''))),
          '^https?://', ''
        ),
        '^www\.', ''
      ),
      '#.*$', ''
    ),
    '/+$', ''
  )
END
FROM "resources" AS r
WHERE r."id"::text = d."source_id";--> statement-breakpoint
-- Deliveries whose source has already been deleted cannot be backfilled: the
-- feed URL went with it, and nothing in the row recovers it. They are the
-- victims of the very bug being fixed, so they are kept rather than dropped --
-- grouped under the deleted source's own id, a namespace no live feed can
-- collide with, so they are also isolated from each other.
--
-- This makes the fix forward-looking. From this migration on, recreating a
-- source for a feed posts nothing, because the surviving rows carry the real
-- identity. A source deleted *before* the migration ran left rows whose feed
-- is unrecoverable, and a source recreated for that feed will post again --
-- documented rather than papered over, because inventing an identity for them
-- would be worse than admitting we do not know it.
UPDATE "deliveries"
SET "feed_identity" = 'deleted-source:' || "source_id"
WHERE "feed_identity" = '';--> statement-breakpoint
-- The new key is stricter than the old one: rows that `source_id` used to keep
-- apart can now collide. That happens when two source rows point at the same
-- feed and the same channel, which is a duplicate -- the item was already
-- posted there twice.
--
-- They are not deleted. Each of those rows records something that really
-- happened -- the item was posted to that channel, twice -- and a delivery
-- table that quietly forgets a post it made is not a history at all. Deleting
-- them would also make the fix look cleaner than it is: the double-post
-- already happened, and the record of it is the only place it survives.
--
-- So they are disambiguated instead. The earliest row of each group keeps the
-- clean identity, which is the one a future poll will match against; every
-- later row is suffixed with the source id that produced it, a namespace no
-- feed identity can collide with. Both rows stay, both stay unique, and the
-- suffix makes the duplicate visible rather than hidden.
UPDATE "deliveries" AS d
SET "feed_identity" = d."feed_identity" || '#' || d."source_id"
WHERE EXISTS (
  SELECT 1
  FROM "deliveries" AS earlier
  WHERE earlier."guild_id" = d."guild_id"
    AND earlier."channel_id" = d."channel_id"
    AND earlier."feed_identity" = d."feed_identity"
    AND earlier."external_id" = d."external_id"
    AND (earlier."created_at", earlier."id") < (d."created_at", d."id")
);--> statement-breakpoint
DROP INDEX "delivery_deduplication";--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_feed_deduplication" ON "deliveries" USING btree ("guild_id","channel_id","feed_identity","external_id");

-- Remove the three news adapters that were never implemented.
--
-- `blizzard`, `wowhead` and `mojang` were selectable in the source editor and
-- seeded as demo starters, but no fetch path ever existed for them: feeds.ts
-- handles `webhook` (no client-side poll) and `steam`, and every other adapter
-- falls through to the RSS/Atom reader. A source choosing one of the three was
-- therefore already being read as an RSS/Atom feed, and the adapter value only
-- decided which label the UI showed.
--
-- That makes the conversion lossless: the URL, keywords, tags, destination,
-- schedule and every other field are untouched, and the row keeps fetching
-- exactly what it fetched before. Nothing is deleted and no history is erased.
--
-- This is a data migration on purpose. Narrowing the enum alone would leave
-- existing rows failing validation with no way for an administrator to fix
-- them from the dashboard, because the editor would no longer offer the value
-- the row still carries.
-- Scoped to source rows: `adapter` is a source field, so a route or any other
-- kind carrying the same jsonb key is unrelated data and is left alone.
UPDATE "resources"
SET "data" = jsonb_set("data", '{adapter}', '"rss"', false)
WHERE "kind" = 'source'
  AND "data" ->> 'adapter' IN ('blizzard', 'wowhead', 'mojang');

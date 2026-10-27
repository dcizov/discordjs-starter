/**
 * Regenerate `tests/fixtures/steam/preview-payload.json`, the recorded test-flight
 * response that the browser regression replays. Run after changing the Steam
 * adapter or the presentation policy:
 *
 *   npx tsx scripts/build-steam-preview.ts
 *
 * `tests/steam-news.test.ts` fails when the committed file and the code disagree,
 * so this cannot silently go stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapSteamNews } from "../packages/core/src/feeds";
import { newsCard } from "../packages/core/src/news-presentation";
import type { FeedItem } from "../packages/core/src/types";

const capture = JSON.parse(
  readFileSync(resolve("tests/fixtures/steam/730-2026-10-25.json"), "utf8")
);
const polled = mapSteamNews(capture.appnews.newsitems, { tags: [] });
const payload = {
  ok: true,
  count: polled.items.length,
  shown: Math.min(polled.items.length, 3),
  items: polled.items
    .slice(0, 3)
    .map((item: FeedItem) => newsCard(item, { sourceName: "CS2 updates" })),
  notices: polled.notices,
  officialOnly: false,
  demo: false,
};
writeFileSync(
  resolve("tests/fixtures/steam/preview-payload.json"),
  `${JSON.stringify(payload, null, 2)}\n`
);
console.log(`Wrote ${payload.items.length} preview cards.`);

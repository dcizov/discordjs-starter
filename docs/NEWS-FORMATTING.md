# News formatting: provider → preview → delivery

Date: 2026-10-25. Branch: `arena/99c6cf65-discordjs-starter` (continuation of
`arena/e2b42b08-discordjs-starter`). Everything below describes the code in this
branch; the incident it fixes is the flattened "test flight" preview (joined
words, leftover markup, no images or article links).

## What was wrong

| Symptom                                                               | Cause                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Added Instance.PreCacheReturns a CPrecache objectAdded CPrecache...` | One `safeText()` call stripped **all** tags with `sanitize-html`, so `<p>`, `<li>` and `<br>` boundaries disappeared.            |
| `\Demo/Replay viewer improvements.Added a progress bar…`              | Steam `contents` is BBCode-ish (`[p]`, `[list]`, `[*]`, `[b]`, `[img]`), which no HTML sanitizer understands.                    |
| `&amp;`, `&quot;` in delivered text                                   | `sanitize-html` re-encodes ampersands in its text output and nothing decoded them afterwards.                                    |
| No images, no "read more"                                             | The item contract had `title/url/summary/tags` only; Steam's API has no header image and RSS `enclosure`/`media:*` were ignored. |
| Everything labelled the same                                          | Steam's `is_external_url`/`feedname` metadata was unused, so syndicated posts looked like first-party announcements.             |
| Preview and delivery could drift                                      | The dashboard rendered raw item fields; the worker built the embed inline with different limits.                                 |

## Contract

`FeedItem` (packages/core/src/types.ts) keeps its existing fields and adds only
what presentation needs:

- `image?: string | null` – provider-supplied lead image.
- `attribution?: "official" | "external" | "unknown"` – provider metadata only.
- `sourceLabel?: string` – publisher label (Steam `feedlabel`, feed title).

`newsCard()` (packages/core/src/news-presentation.ts) is the single projection
used by the dashboard and by `feedEmbed()`, which builds the raw Discord embed
object the worker posts. Both apply the same excerpt, the same link validation
and the same Discord limits (`NEWS_LIMITS`). A preview therefore cannot promise
formatting that delivery will not produce.

Card fields: id, title, canonical URL, excerpt, image, publication time,
source label, attribution + label, tags, and `notices` (what the provider did not
supply). Nothing is invented: a missing date, image or link is reported, not
guessed.

## Normalization (packages/core/src/feed-content.ts)

- `normalizeFeedText(raw, "bbcode" | "html" | "plain")`:
  - Steam: `{STEAM_CLAN_IMAGE}` tokens, `[img]`/`[video]`/`[previewyoutube]`
    removed into their own line, `[list]`/`[*]` become `•` lines, `[url]`
    becomes its label, block tags become newlines, then the HTML pass runs on the
    result (Steam mixes both).
  - HTML: scripts/styles/iframes are dropped **with** their contents, `<br>` and
    `<li>` become line breaks and bullets, block open/close tags become newlines
    _before_ tags are stripped, then entities are decoded.
  - Entities: a small explicit decoder (named + numeric) runs _after_
    sanitizing, so `&lt;em&gt;` is stripped as markup, never rendered as angle
    brackets and never leaks `&amp;` into Discord.
  - `tidyText()` collapses runs of spaces and blank lines but keeps paragraph
    and bullet boundaries.
- `excerpt(text, max)` cuts on a paragraph or sentence boundary when one exists
  in the last 45% of the window, otherwise on a word boundary, and marks a
  mid-sentence cut with `…`. It never returns half a word.
- `plainText()` strips entity-encoded markup and neutralizes `@everyone`,
  `@here` and `<@id>` mentions without truncating words.
- `safeImageUrl()` accepts only absolute `https` images with no credentials, a
  normal port, a hostname that is not an IP/private-looking name, and an image
  file extension. It is a syntactic gate used by both the browser (plain `<img>`,
  no proxy) and Discord's own image fetch.
- `imageFromMarkup()` takes the first provider-supplied image from BBCode,
  `<img src>`, or an image URL in the markup.
- `steamAttribution()`: `external` when Steam marks the item external or the URL
  leaves Steam's hosts; `official` only for first-party feed names
  (`steam_community_announcements`, `steam_release_notes`, `steam_news`);
  otherwise `unknown`, labelled "Publisher not confirmed by the feed".

## Filtering and source trust

- `mapSteamNews(items, { tags, officialOnly })` is pure and unit-tested.
- The Steam source form gains **Official announcements only**. When it is on,
  items Steam does not attribute to the app are hidden and the preview says how
  many were hidden, plus a warning that Steam metadata can still label community
  crossposts as app announcements. Steam's news API is not a verified-official
  filter, and the UI says so instead of claiming otherwise.
- RSS/Atom items stay `unknown`: publishers do not expose a machine-readable
  "official" flag in the feed itself. The footer simply credits the source.

## Images

Only provider-supplied images are used:

- Steam: `[img]`/legacy clan-image tokens inside the announcement markup.
- RSS/Atom: `enclosure`, `media:content`, `media:thumbnail`, `itunes:image`,
  then an inline `<img>` from `content:encoded`.

Open Graph fetching is deliberately **not** implemented: it needs SSRF-safe
resolution, redirect and DNS-rebinding checks, timeouts, body limits, content
type validation, caching and rate limits (the feed reader in
`packages/core/src/feeds.ts` has those protections, but they are scoped to feed
documents, not arbitrary article pages). Consequence, surfaced as a preview
notice: Steam's API supplies no header image, so many Steam items have none.

## Preview parity

`POST /api/guilds/:id/resources/source/:sourceId/test` now returns:

```json
{
  "ok": true,
  "count": 10,
  "shown": 3,
  "items": [
    {
      "id": "…",
      "title": "…",
      "url": "…",
      "excerpt": "…",
      "image": null,
      "publishedAt": "2026-10-24T10:00:00.000Z",
      "sourceLabel": "Counter-Strike 2",
      "attribution": "official",
      "attributionLabel": "Official announcement",
      "tags": ["Steam"],
      "notices": ["No provider-supplied image."]
    }
  ],
  "notices": ["Steam's news API supplies no lead image for these items."],
  "officialOnly": false,
  "demo": false
}
```

The dialog states that nothing was sent, shows representative cards (image,
title as a link, paragraph/bullet-preserving excerpt, attribution, source, date,
"Read more"), says how many items are shown of how many were found, and lists
partial-failure notices. Demo mode returns one clearly simulated item with no
metadata notices, because no provider was contacted.

Delivery reuses `feedEmbed()` in `apps/worker/src/index.ts`; outbox payloads now
carry `image`, `attribution` and `publishedAt`. Unchanged guarantees:
deduplication (`reserveDelivery` + `fingerprint` nonce), schedules, routing,
webhook signature checks, retries and source health.

## Limits and verification

`NEWS_LIMITS`: title 256, excerpt 480, description 4096, footer 2048, image URL
2000 characters. `safeText()` still enforces the hard cap at the edge.

Fresh evidence (this branch):

- `tests/news-content.test.ts`: 17 tests over Steam BBCode, HTML, entities,
  lists, malformed/unclosed markup, missing fields, unsafe images, mention
  neutralization, attribution, official-only filtering, Discord limits and
  preview/delivery parity.
- `tests/fixtures/news.ts`: representative Steam JSON and RSS/Atom documents.
- Demo API response verified by HTTP against a production build (see the
  continuation report for the exact command).

Not verified here: a real Steam or RSS fetch (no live credentials/network in the
sandbox), Discord's rendering of the image/embed, and a visual browser check of
the dialog; the browser specs run in CI, not in the authoring sandbox.

## Remaining work

- Fetch an RSS feed's own Open Graph image only after a dedicated SSRF-reviewed
  implementation.
- Consider `og:image` support through the existing pinned-DNS fetcher, with
  content-type and size limits, if publishing partners need thumbnails.
- Steam header images would need a second provider (Steam store API) and a
  cache; not attempted.

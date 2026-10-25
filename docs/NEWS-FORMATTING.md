# News formatting: provider → preview → delivery

Date: 2026-10-25. Branch: `arena/99c6cf65-discordjs-starter`. Everything below
describes the code in this branch. It supersedes the first news pass: that pass
fixed joined words and missing images but was never checked against a **real**
Steam response, and the reported screenshot showed why that mattered.

## The real defect (reproduced, not guessed)

The reported article is
`https://steamcommunity.com/games/CSGO/announcements/detail/687519694976975305`
("Counter-Strike 2 Update", 14 Oct 2026 19:02 EDT). Its API record is
`gid 1846651706675829` (the community permalink and the news `gid` are different
namespaces; `date: 1792018968` matches the page). Captured 2026-10-25:

```
[p]\[ UI ][/p][p]Demo/Replay viewer improvements:[/p][list]
[*][p]Added a progress bar for demo/replay downloads[/p][/*]
[*][p]Camera controls now use click-and-drag scheme[/p][/*][/list]
[p][/p][p]\[ MISC ][/p][list][*][p]Round backup files now require the game
server startup flag \"-allow_round_backup_files\"[/p][/*]…[/list]
```

| Symptom in the screenshot                    | Actual cause                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Literal `[/*]` lines                          | The old replacement chain consumed `[*]` but never `[/*]`; Steam closes an item with `[/*]` and immediately opens the next one with `[*]`.        |
| `\[ UI ]`, `\"…\"`                            | Steam backslash-escapes literal brackets and quotes. Nothing unescaped them, and the escaping is *per character* (`\[` escaped, `]` not).          |
| Excess spacing between bullets                | Each leaked `[/*]` became its own text line, so `whitespace-pre-line` rendered a blank line between every bullet.                                  |
| Very long card                                | 480 characters of changelog is a wall of bullets; the shape was never bounded, only the length.                                                   |
| "External link, not a first-party post" on Valve's own patch notes | `is_external_url` is `true` on **every** item in the capture — Valve's own included — because `url` is always a Steam redirector (`steamstore-a.akamaihd.net/news/externalpost/<feed>/<gid>`). The old classifier treated that flag as "not first party". |
| "CS2" as the article's source                | `newsCard()` let the administrator's subscription name override the provider's own label (`Community Announcements` / `Rock, Paper, Shotgun`).   |
| "No provider-supplied image." in every card   | A per-item diagnostic rendered in the article body.                                                                                              |

All of these are now covered by `tests/steam-news.test.ts` (24 tests) and
`tests/steam-route.test.ts` (5 tests) running against the recorded payloads in
`tests/fixtures/steam/`.

## Steam API: what is actually documented and what is observed

Official starting point: <https://steamcommunity.com/dev> → Valve Developer
Community `Steam_Web_API` (`GetNewsForApp (v0002)`).

| Aspect                | Verified                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Endpoint              | `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/`                                                          |
| Credential            | Docs state all Web API use needs a key; **this endpoint answered without one** on 2026-10-25. Orbit neither sends nor requires a key. |
| Documented parameters | `appid`, `count`, `maxlength`, `format`. Orbit sends `appid`, `count=10`, `maxlength=0`, `format=json`.               |
| `maxlength`           | Upstream truncation. With `maxlength=700` Steam cut bodies mid-sentence and appended `…`. Orbit therefore requests full content (`maxlength=0`) and truncates for presentation itself; a trailing `…` from a stored payload is reported as an upstream truncation notice. |
| Undocumented, observed | `feeds` (filters to one feed), `feed_type` (`1` = app announcement hub, `0` = syndicated publisher feed), `feedname`, `feedlabel`, `is_external_url`. |
| Stable identity       | `gid` — used as the dedupe key.                                                                                     |
| Article URL           | Always `steamstore-a.akamaihd.net/news/externalpost/<feed>/<gid>`, a Steam-hosted redirect to the publisher. Orbit links to it and does not follow it server-side. |

Because `feed_type` is not documented, attribution is stated as what the
metadata supports and no more.

## Attribution and source labels

`steamIdentity()` (packages/core/src/feed-content.ts):

- `feed_type === 1` → `official`, label **"App announcement"** ("posted on this
  app's Steam announcement hub").
- `feed_type === 0` with a feed label → `syndicated`, label
  **"Republished from Rock, Paper, Shotgun"**, `publisher` set.
- No usable feed metadata → `unknown`, "Publisher not confirmed".
- `is_external_url` is accepted and **ignored**; tests pin that both ways.

The card separates identities: `sourceLabel` is the producing feed
(`Community Announcements`), `subscriptionLabel` is the administrator's name
(`CS2 updates`), and the link text follows the destination — "Read the
announcement" for an app post, "Read the article at Rock, Paper, Shotgun" for a
syndicated one, "Read article" when the publisher is unknown. "Read more from
CS2" is gone: it implied the subscription authored the article.

## Official-only filtering

Steam has no "first party" field. The strongest supported signal is its
app-announcement feed, so the switch now changes the **request**:
`?feeds=steam_community_announcements` (verified: 10/10 items from that feed)
instead of filtering ten mixed items locally, which could hide older matching
posts. `mapSteamNews()` still filters locally as a safety net and reports how
many items it dropped. Coverage is exactly "this app's Steam announcement feed",
not "everything Valve published".

## Normalization (packages/core/src/feed-content.ts)

`steamMarkupToText()` is a scanner, not a replacement chain:

1. HTML structure is converted first (`htmlToText`: scripts/styles dropped with
   contents, `<br>`/`<li>`/block tags to breaks, entities decoded once — after
   stripping, so `&lt;em&gt;` can never become live markup).
2. One left-to-right pass over the Steam markup keeps a list stack and an escape
   state:
   - `\[`, `\]`, `\\`, `\"` unescape to the literal character (and only those);
   - `[list]`, `[olist]`, `[*]`, `[/*]`, `[/list]` maintain nesting; items become
     `•` / `◦` / `▪` by depth, ordered lists `1. 2. 3.`;
   - `[p]`, `[h*]`, `[quote]`, `[br]`, `[table]` and friends are boundaries;
   - `[img]`, `[video]`, `[previewyoutube]` bodies are dropped (images are
     extracted separately), `[noparse]` bodies are kept literally;
   - `[b]`, `[i]`, `[u]`, `[url=…]` disappear and keep their text;
   - **anything unrecognised stays as written**, so `[ UI ]` is a section
     heading, not markup.
3. Paragraphs are separated by a blank line; list items by a single newline, so
   a bullet can never be double-spaced.

## Excerpt shape

`NEWS_LIMITS` = title 256, excerpt 480 characters, **3 paragraphs**, **5
bullets**, description 4096, footer 2048, image URL 2000.

`excerpt()` bounds the *shape* first and the character count last: it walks
paragraphs, stops when the bullet budget is spent, drops a section that would
only contribute a heading plus one bullet ("[ MISC ]" with a single line is
worse than omitting it), and never ends on a bare heading. `feedEmbed()` uses
the same function, so the card and the Discord description are identical.

Rendered result for the reported article:

```
[ UI ]

Demo/Replay viewer improvements:
• Added a progress bar for demo/replay downloads
• Camera controls now use click-and-drag scheme
• Free and chase camera are usable during a paused demo
• Fixed some minor issues when seeking to a different position in the file
```

Six lines instead of a dozen marker-strewn ones; the full text stays one click
away.

## Diagnostics instead of card noise

Missing metadata appears in a collapsed **Preview details** disclosure inside the
card (which also names the configured subscription and the provider feed), and
provider-level notices stay in the test-flight dialog. A missing image is shown
by simply not rendering an image. Genuine failures stay visible: the route now
returns **502** with `Retry-After` for a provider outage (`UpstreamError`), so
"Steam is having a bad day" is never presented as "your configuration is wrong".

## Images

Only provider-supplied images: Steam `[img]`/`{STEAM_CLAN_IMAGE}` markup, RSS
`enclosure`/`media:*`/`itunes:image`/inline `<img>`. `safeImageUrl()` accepts
only absolute, credential-free `https` URLs on a public host with an image
extension. Open Graph fetching remains unimplemented: it needs SSRF-safe
resolution, redirect and DNS-rebinding checks, timeouts, body limits,
content-type validation and rate limits. Steam's API supplies no header image,
so many Steam items legitimately have none.

## Verification (fresh, this branch)

- `tests/steam-news.test.ts` — 24 tests over the recorded captures: closing
  markers, nested lists, escaped headings and quotes, compact bullets, excerpt
  bounds, attribution both ways, official-only request and local filter,
  upstream truncation detection, non-Latin text, preview/delivery parity,
  malformed/truncated input, and a guard that the recorded browser payload
  matches the current code.
- `tests/steam-route.test.ts` — 5 tests through the real route handler with the
  recorded response stubbed at `fetch`: endpoint/params/no key, normalized card
  JSON, syndicated publisher in the preview, official-only request, 502 +
  `Retry-After` on provider failure.
- `tests/news-content.test.ts` — 17 generic tests (HTML, entities, malformed,
  mentions, unsafe images, Discord limits).
- `tests/e2e/news-preview.spec.ts` — browser regression replaying the recorded
  payload: literal heading, no markers/escapes, one line per bullet, badge and
  link text, collapsed diagnostics, retryable failure. **Executed in CI only**
  (no Chromium in the authoring sandbox).

Regenerate the recorded browser payload after changing the adapter or the
presentation policy:

```bash
npx tsx scripts/build-steam-preview.ts   # tests/steam-news.test.ts fails if it drifts
```

## Remaining work

- Open Graph / Steam store header images need a dedicated SSRF-reviewed fetcher.
- `feeds`/`feed_type` are undocumented; if Valve removes them, attribution
  degrades to `unknown` (labelled as such) rather than guessing.
- Live Discord rendering of these embeds is unverified here (no token in the
  sandbox); payloads are asserted as data.

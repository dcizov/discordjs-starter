# Recorded Steam responses (test fixtures)

These are **real provider responses**, not hand-written examples. They exist
because the reported defect only reproduces with Steam's actual markup:
`[p]\[ UI ][/p]…[list][*][p]…[/p][/*]…[/list]`.

## Captures

| File                    | Request                                                                                  | Fidelity                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `730-2026-10-25.json`   | `GET https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=10&maxlength=0&feeds=steam_community_announcements` | Full content (`maxlength=0`), captured 2026-10-25                                              |
| `570-2026-10-25.json`   | `GET …/v2/?appid=570&count=6&maxlength=700`                                               | Upstream-truncated by Steam (`maxlength`), captured 2026-10-25                                 |
| `preview-payload.json`  | generated from `730-2026-10-25.json` by `scripts/build-steam-preview.ts`                   | The dashboard test-flight response replayed by `tests/e2e/news-preview.spec.ts`                |

- **Credential:** none was sent. Valve's documentation says the Web API requires
  a key, but this endpoint answered without one; Orbit therefore neither
  requires nor invents a key for it.
- **Redactions:** none needed. Both payloads contain only public announcement
  metadata (title, URL, body, feed label, timestamp, author display name).
- **Identities:** `gid` is Steam's news item id. The community permalink of the
  reported article (`…/announcements/detail/687519694976975305`) is a different
  namespace; that page displays the same post (14 Oct 2026, 19:02 EDT →
  `date: 1792018968` → gid `1846651706675829`).
- **No live call is made by the test suite.** `tests/steam-news.test.ts`,
  `tests/steam-route.test.ts` and `tests/e2e/news-preview.spec.ts` read these
  files.

## What each capture proves

| Item (gid)              | Field data                                              | Defect it pins down                                                              |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `1846651706675829`      | `feed_type: 1`, `is_external_url: true`, redirect URL   | The reported article: `[/*]` markers, escaped `\[ UI ]`, `\"` quoting, 9 bullets   |
| `1847286114034398`      | `feed_type: 1`, nested `[list]` inside `[*]` items       | Deep nesting and a trailing item that never closes with `[/*]`                    |
| `1846018067931597`      | `feed_type: 1`                                           | Ordinary patch notes: 7 bullets, no nesting                                       |
| `1846651706695791`      | `feed_type: 0`, `feedlabel: "Rock, Paper, Shotgun"`      | Syndication: same `is_external_url` flag, different publisher, plain-text body    |
| `570` item `…925681`    | `feed_type: 0`, Cyrillic, trailing space                 | Non-Latin text and publisher-supplied feeds                                       |
| `570` item `…924633`    | `feed_type: 1`, no markup, ends with `…`                 | Upstream truncation by `maxlength`; plain-text app announcements                  |

## Not recorded here

- Live Discord delivery (no bot token in the authoring sandbox).
- The raw HTML of the publisher pages that the Steam redirector leads to.
  `steamstore-a.akamaihd.net/news/externalpost/<feed>/<gid>` was observed
  redirecting to the publisher's own article (verified once manually for
  `Rock, Paper, Shotgun` on 2026-10-25); Orbit deliberately does **not** follow
  that redirect server-side, so the link points at the Steam-hosted redirect.

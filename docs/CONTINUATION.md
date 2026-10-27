# Continuation report

Date: 2026-10-25 · Branch `arena/99c6cf65-discordjs-starter`.

- **Starting point of the dashboard work:**
  `eeb0e68a533d653daa14015465b6e6760e41c49d` (tip of
  `origin/arena/e2b42b08-discordjs-starter`).
- **Starting point of this Steam pass:** `2c4b3c0` (verified to be seven commits
  ahead of `eeb0e68`, with no commits unique to the older branch).
- **Ending HEAD:** see `git log -1` on the branch; the Steam work is
  `8ce2dc9` plus the two follow-up test-locator commits.

Fetched (`git fetch --depth=50 origin 'refs/heads/*:refs/remotes/origin/*'`)
without merging, rebasing or resetting. `origin/main` is an ancestor of this
branch, so nothing from the interrupted session was lost or needed to be
recovered from a new workspace.

## Recovered status matrix

| Area                                     | State before this session                                                                                   | Evidence                                                                                     | Now                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo structure / Turborepo           | npm workspaces (`apps/*`, `packages/*`), tsup for services, one Next app                                    | `package.json`, `tsup.config.ts`, `.github/workflows/ci.yml`, `docs/STRUCTURE-REFACTOR.md`   | Researched and **retained unchanged** (see decision record)                                                                                                                                                   |
| News formatting, images, excerpts, links | Broken: one-tag-stripping normalizer, no BBCode handling, no images, no attribution, preview ≠ delivery     | `packages/core/src/feeds.ts`, `safety.ts`, screenshot 1                                      | **Implemented + verified against recorded provider data** (`docs/NEWS-FORMATTING.md`); the first pass was re-opened after a second screenshot showed surviving `[/*]`/`\[` markers — see "Steam rework" below |
| Audit / activity identity images         | Initials only, no avatar data recorded                                                                      | `overview.tsx`, `server-pages.tsx`, screenshot 2                                             | **Implemented** (recorded avatar hashes + migration); unit-verified, browser-unverified                                                                                                                       |
| Music state, channel, progress, volume   | Pause-styled control while empty; snapshot-only position; volume committed per event and snapped back       | `music-page.tsx`, screenshot 3                                                               | **Implemented** (`docs/DASHBOARD-UX.md`); unit-verified, browser-unverified                                                                                                                                   |
| First-visit dashboard tour               | None                                                                                                        | no tour code, no storage policy                                                              | **Implemented + verified** (`tour-model.ts`, dialog, `tests/tour.test.ts`, `tests/e2e/tour.spec.ts` green in CI)                                                                                              |
| Overview banner animation                | Animation on the filtered `<img>` itself                                                                    | `overview.tsx`, `globals.css`                                                                | **Implemented** compositor-only wrapper + reduced-motion/mobile opt-out; no frame-time measurement possible                                                                                                   |
| Ticket system                            | Not implemented (documented as high privacy burden in `FEATURE-RESEARCH.md`)                                | no tickets table/command/dashboard                                                           | **Deferred** — see below                                                                                                                                                                                      |
| Operational / server health              | Honest separation of container liveness, saved config, backend readiness and delivery health already exists | `apps/bot/src/features/music/diagnostics.ts`, `service_health`, dashboard `ConnectionStatus` | **Unchanged this session**; extension deferred                                                                                                                                                                |

## Prioritisation used this session

The brief's default scope includes a ticket slice. The reported defects came
first, and each was closed as a coherent vertical slice with tests:

| Priority | Slice                                                      | User problem                                                      | Existing support                       | Scope delivered                                                                                                                     | Complexity / privacy                                                                                 | Acceptance                                                      |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P0       | News normalization + presentation                          | Unreadable previews, no images/links, false "official" impression | Source/route/outbox existed            | Provider-aware normalizer, normalized card contract, shared embed builder, Steam attribution + official-only filter, preview parity | Low–medium; no new permissions, no scraping, provider images only                                    | 17 new unit tests; demo API verified against a production build |
| P0       | Audit identity                                             | Initials instead of people                                        | `IdentityImage` + CDN helpers existed  | Recorded avatar column, server-side URL projection, UI primitive reuse                                                              | Low; one nullable column, no extra scope or per-row fetch                                            | 2 extended unit suites                                          |
| P0       | Music honesty                                              | Fake pause control, no real progress, broken volume               | Queued actions, persisted `MusicState` | Pure progress model, playback clock, debounced/sequence-guarded volume control                                                      | Low; no protocol change                                                                              | 5 new unit tests + browser spec                                 |
| P1       | First-visit tour                                           | No orientation                                                    | Radix Dialog                           | Six-step accessible dialog + per-user versioned storage                                                                             | Low; local storage only                                                                              | 5 policy tests + browser spec                                   |
| P1       | Hero animation                                             | Visibly rough loop                                                | CSS keyframes                          | Compositor-only transform on a promoted wrapper, reduced-motion/mobile opt-out                                                      | Low                                                                                                  | Code-level; browser measurement pending                         |
| Deferred | Tickets                                                    | Private support workflow (documented demand)                      | None                                   | —                                                                                                                                   | High: new table, channel-overwrite model, abuse limits, retention policy, failure/recovery semantics | Would need its own reviewed slice                               |
| Deferred | Health extension (heartbeat, shard, queue, feed freshness) | Ops clarity                                                       | Existing honest health view            | —                                                                                                                                   | Medium: must distinguish liveness/readiness/execution without inventing a score                      | Needs measured sources first                                    |

## Monorepo / Turborepo decision record

**Decision: retain the current npm-workspaces layout. No Turborepo, no
package-manager migration, no new app.** Only naming/ownership conventions were
adopted where they already fit.

Compared (structure only, from the public repository pages):

| Reference                                                                        | Layout                                                                                                                       | Relevant lesson for Orbit                                                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [t3-oss/create-t3-turbo](https://github.com/t3-oss/create-t3-turbo) (MIT)        | pnpm workspaces, `apps/*` + `packages/*`, `tooling/` for shared eslint/ts config, `turbo.json` pipelines, Expo + Next + tRPC | `apps/*`/`packages/*` naming and a shared tooling package are worthwhile _when_ several apps share configuration; Expo/tRPC/auth are unrelated needs here |
| [vercel/turborepo](https://github.com/vercel/turborepo) (MIT)                    | Monorepo build system with task graph, local/remote caching, env declarations                                                | Caching pays off across many packages building independently; Orbit has one Next build plus one tsup bundle of six small entries                          |
| [dcizov/nextjs-starter](https://github.com/dcizov/nextjs-starter/tree/dev)       | Single Next app, `src/` layout, shadcn/ui, husky/lint-staged                                                                 | Confirms a single app needs no monorepo tooling; Orbit keeps `apps/web/app` because the app dir is already the Next-16 convention here                    |
| [dcizov/reudiger-ruediger](https://github.com/dcizov/reudiger-ruediger/tree/dev) | Single package, `src/` with bot/API/db, Drizzle migrations, Docker                                                           | Single-package bot layout is viable but would lose Orbit's explicit core/db boundary shared by bot, worker and web                                        |

Reasons not to introduce Turborepo now:

- The repository already has correct task orchestration for its shape: `npm run
build` = one Next build + one tsup invocation; CI (`npm ci`, lint, typecheck,
  tests, audit, build, browser tests, Docker builds) caches via
  `actions/setup-node`.
- Several tasks must never be cached: `db:migrate`, `db:seed`, feed polling,
  live deliveries, bot/worker dev processes, command registration. Declaring
  `cache: false` and env inputs for each is real configuration risk with little
  payoff at this size.
- Environment ownership is already explicit (`packages/core/src/environment.ts`):
  web needs OAuth + bot token, worker needs no OAuth secret, tools need only what
  they use. A task runner would not simplify that; it would add a second place
  to declare it.
- Docker builds are single-container (`Dockerfile` copies the workspace) and
  would need re-verification against a new task graph.

If Orbit later gains a second deployable UI (for example a separate admin or
marketing app) or remote caching becomes worthwhile, revisit with: explicit
`dependsOn`/`outputs`, `cache: false` for migrations/deliveries/registration,
`env`/`globalEnv` declarations, unchanged `npm` scripts for contributors, and a
Docker/CI re-verification pass.

No files were moved, so there is no before/after tree for this decision. The
internal ownership introduced by the previous refactor (entrypoints → adapters →
feature services → core/db) is unchanged and is what this session extended.

## What was implemented

News (`docs/NEWS-FORMATTING.md`):

- `packages/core/src/feed-content.ts` — provider-aware normalization, entity
  decoding, excerpting, mention neutralization, image validation/extraction,
  Steam attribution.
- `packages/core/src/news-presentation.ts` — one card contract plus the Discord
  embed builder used by the worker, with `NEWS_LIMITS`.
- `packages/core/src/feeds.ts` — Steam items use `maxlength=0` and are
  normalized from BBCode; RSS/Atom pick up `enclosure`/`media:*`/inline images;
  `pollSourceDetailed()` reports filtering and metadata notices; `mapSteamNews()`
  is pure and testable. Steam's news API supplies no lead image.
- `packages/core/src/safety.ts` — `safeLink` moved here (shared by preview and
  delivery) and `safeText` now decodes entities (`Patch &amp; notes` →
  `Patch & notes`).
- `packages/db/src/outbox.ts`, `apps/worker/src/index.ts` — payload carries
  image/attribution/publishedAt; the embed is built by `feedEmbed()` and its
  timestamp is the publication time, not the delivery time.
- `apps/web/app/api/[...path]/route.ts` — test flight returns normalized cards,
  notices and the official-only state; demo returns a simulated card without
  metadata complaints.
- `apps/web/components/news-article-card.tsx`, `resources-page.tsx`,
  `resource-editor.tsx` — cards with image/title link/excerpt/attribution/date/
  destination-aware link text; technical notices in a collapsed disclosure;
  Steam "Official announcements only" switch (requests the app announcement
  feed).
- `apps/bot/src/commands/news.ts` — `/news test` renders the same cards as one
  embed with source links and notices.

Identity (`docs/DASHBOARD-UX.md`):

- `actor_avatar` column + `drizzle/0003_audit_actor_avatar.sql`.
- `Actor.avatar` plumbed from the session, failed slash commands, cached job
  actors and music failures.
- `loadDashboard()` projects `actorAvatarUrl`; overview and audit log use
  `IdentityImage`; audit page states that recorded metadata is not current.
- Demo personas use four original local illustrations (new assets in
  `apps/web/public/demo/`).

Music, tour, animation: see `docs/DASHBOARD-UX.md`.

## Steam rework (this pass, commits `8ce2dc9` → HEAD)

**Reproduction.** The reported article is
`steamcommunity.com/games/CSGO/announcements/detail/687519694976975305`. Its API
record is `gid 1846651706675829` at
`date 1792018968` (2026-10-14T23:02:48Z, i.e. 19:02 EDT as the page shows).
The raw body was captured from the live API on 2026-10-25:

```
[p]\[ UI ][/p][p]Demo/Replay viewer improvements:[/p][list]
[*][p]Added a progress bar for demo/replay downloads[/p][/*]…[/list]
```

**Confirmed causes.**

| Symptom                                 | Cause                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Literal `[/*]` lines                    | The replacement chain consumed `[*]` but not `[/*]`; Steam closes with `[/*]` and reopens with `[*]`.                     |
| `\[ UI ]`, `\"flag\"`                   | Steam backslash-escapes literal brackets/quotes, per character; nothing unescaped them.                                   |
| Blank line per bullet                   | Each leaked `[/*]` became its own text line and `whitespace-pre-line` rendered the gap.                                   |
| "External link, not a first-party post" | `is_external_url` is `true` on **every** captured item, Valve's own included, because the URL is a Steam redirector.      |
| "CS2" credited as the source            | `newsCard()` preferred the administrator's subscription name over the provider's `feedlabel`.                             |
| Card looked far longer than 480 chars   | It was within 480 characters, but the shape was unbounded and the leaked markers added lines. Bounds are now shape-first. |
| "No provider-supplied image." in body   | A per-item diagnostic rendered inside the article card.                                                                   |

**API facts verified** (see `docs/NEWS-FORMATTING.md`):
`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/` answered **without an
API key** on 2026-10-25 even though Valve's docs say a key is required; Orbit
sends none and requires none. Documented params are `appid`, `count`,
`maxlength`, `format`. `maxlength` truncates upstream and appends `…` (observed
with `maxlength=700`), so Orbit asks for `maxlength=0`. `feeds`, `feed_type`,
`feedname`, `feedlabel` and `is_external_url` are observed but undocumented.
Item identity is `gid`.

**Fixture provenance.** `tests/fixtures/steam/` holds two recorded responses,
the generated preview payload the browser test replays, and a README with the
exact URLs, date, credential status, redactions (none needed) and fidelity
(`maxlength=0` full vs `maxlength=700` upstream-truncated).

**Before → after for the reported article.**

```
before (reported screenshot)                 after
[/*]                                         [ UI ]
[/*]                                         (blank line)
•                                            Demo/Replay viewer improvements:
Added CSHostage…                             • Added a progress bar for demo/replay downloads
[/*]                                         • Camera controls now use click-and-drag scheme
\[ UI ]                                      • Free and chase camera are usable during a paused demo
…                                            • Fixed some minor issues when seeking to a different position…
badge: "External link, not a first-party post"   badge: "App announcement"
link:  "Read more from CS2"                      link:  "Read the announcement"
```

**Representative delivered payload** (`feedEmbed` for the same item):

```json
{
  "title": "Counter-Strike 2 Update",
  "url": "https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1846651706675829",
  "description": "[ UI ]\n\nDemo/Replay viewer improvements:\n• Added a progress bar for demo/replay downloads\n• Camera controls now use click-and-drag scheme\n• Free and chase camera are usable during a paused demo\n• Fixed some minor issues when seeking to a different position in the demo file",
  "color": 10189530,
  "footer": {
    "text": "Community Announcements · App announcement · via Orbit"
  },
  "timestamp": "2026-10-14T23:02:48.000Z"
}
```

**Behaviour changes to be aware of:**

- `newsCard().sourceLabel` is now the provider's feed; the administrator's name
  moves to `subscriptionLabel` (shown in the card's details). Outbox payloads
  gained `providerLabel`/`publisher`; older pending payloads fall back to
  `sourceName`, so no migration is needed.
- `NewsAttribution` is `official | syndicated | unknown` (`external` renamed).
- A provider outage now returns **502** with `Retry-After` instead of 400.

## Checks actually run (this branch, this session)

| Check                         | Command                                          | Result                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh baseline before changes | `npm ci` + `npm test`                            | 627 tests / 52 files passed (31.45 s)                                                                                                                            |
| Unit/integration, first pass  | `npm test`                                       | 655 tests / 55 files passed                                                                                                                                      |
| Unit/integration, Steam pass  | `npm test`                                       | **684 tests / 57 files passed** — adds 24 capture-driven Steam tests and 5 route tests                                                                           |
| Steam captures                | `tests/steam-news.test.ts`                       | 24/24 against the recorded 2026-10-25 payloads                                                                                                                   |
| Steam route                   | `tests/steam-route.test.ts`                      | 5/5 through the real handler with `fetch` stubbed; asserts endpoint, no key, cards, 502 + Retry-After                                                            |
| Types                         | `npm run typecheck` (`next typegen` + two `tsc`) | passed                                                                                                                                                           |
| Lint                          | `npm run lint`                                   | passed (0 warnings)                                                                                                                                              |
| Formatting                    | `npm run format` / `prettier --check`            | applied; clean                                                                                                                                                   |
| Production build              | `npm run build`                                  | passed (Next + 6 tsup bundles)                                                                                                                                   |
| Demo API smoke                | `curl` against `npm start` with `DEMO_MODE=true` | `/api/guilds/:id` returns `actorAvatarUrl`; test-flight returns normalized cards/notices                                                                         |
| SSR smoke                     | `curl` `/dashboard/:id/overview`                 | 200, hero wrapper present, tour dialog absent from SSR (client-only, as intended)                                                                                |
| Schema generation             | `npx drizzle-kit generate`                       | `0003_audit_actor_avatar.sql` = a single `ADD COLUMN` (a first attempt with a corrupted schema file produced `DROP TABLE`s and was reverted before anything ran) |

| Browser suites (CI) | `npm run test:e2e` on the pushed branch | **53 passed** (1.3 min), verify + containers jobs green |

Not executed in the authoring sandbox, and why:

- **Browser/Playwright suites run in CI, not locally.** No Chromium binary is
  available in the authoring sandbox (`npx playwright install chromium` cannot
  download there), so the specs were executed by CI on push instead: the
  `verify` job ran `npx playwright install --with-deps chromium` and
  `npm run test:e2e` with **53 passing tests**, covering the first-visit tour,
  the honest transport state, snapshot progress, volume commit, and the Steam
  preview (real recorded payload, no markers, one line per bullet, collapsed
  diagnostics, retryable failure). That run
  caught one genuine defect the code review missed: the volume slider sent two
  identical jobs per keyboard interaction (the debounce ref was not cleared
  when its timer fired, so the blur caused by disabling the slider mid-save
  flushed an already-committed value). Fixed in `5665a71` by clearing the timer
  self-referentially and keeping the slider enabled while a commit is in
  flight; the suite has asserted exactly one POST per interaction since.
- **Live Discord, Steam/RSS providers, Lavalink audio**: no credentials, no
  outbound access to those hosts. All provider behaviour here is fixture- and
  mock-based.
- **Docker/Compose and packaged Lavalink checks**: Docker is unavailable.
- **Frame-time measurement for the hero animation**: requires a browser.
- **Migrations against a real database**: `TEST_DATABASE_URL` is not configured
  here; the migration file is schema-generated and additive.

## Required setup for the changes

- Run `npm run db:migrate` on a live deployment for
  `drizzle/0003_audit_actor_avatar.sql` (adds one nullable column; no backfill,
  no data loss; old rows simply keep initials).
- No new environment variables, scopes, intents or permissions.
- Optional: enable **Official announcements only** per Steam source.

## Feature completion matrix (accurate, not aspirational)

| Item from the original brief                   | Status                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| News formatting / images / links / attribution | **Done and verified against recorded provider data**                                         |
| Audit identity images                          | Done (unit + browser suites)                                                                 |
| Music state / progress / volume                | Done (unit + browser suites)                                                                 |
| First-visit tour                               | Done (unit + browser suites)                                                                 |
| Overview banner animation                      | Done; improvement argued from paint/filter cost, **not measured** (no device profiling here) |
| Monorepo / Turborepo assessment                | Done: retain npm workspaces (decision record earlier in this file)                           |
| Ticket system                                  | **Not implemented — deferred** (criteria in "next steps")                                    |
| Operational-health extension                   | **Not implemented — deferred** (criteria in "next steps")                                    |

## Known gaps / next concrete steps

1. Visual check of the hero animation on a low-powered device; remove
   `will-change` if a measurement shows no benefit.
2. Ticket vertical slice (deferred): needs a `tickets` table, panel resource,
   overwrite model validated before any content is exposed, per-member open
   limits, claim/close interactions, restart/deleted-channel reconciliation,
   dashboard configuration and list, audit events, and an explicit
   no-transcripts-by-default retention policy. Design review required before
   implementation; do not promise privacy from administrators.
3. Health extension (deferred): add measured bot heartbeat/gateway state, queue
   depth and feed freshness to the existing health view, keeping liveness,
   readiness, saved configuration and confirmed execution separate. Do not
   invent a score.
4. Community audit rows still store the actor's snowflake as the display name
   (`packages/db/src/community.ts`); fixing it means passing an actor name/avatar
   through `change()`, which is a separate, reviewable change.
5. Consider Open Graph images for RSS only after an SSRF-reviewed fetcher with
   timeouts, size/content-type limits, cache and failure isolation.

---

# Pass 2: rate limits, music capability, integrations and documentation

Date: 2026-10-25 · Branch `arena/99c6cf65-discordjs-starter` (same branch,
continuing after PR #3). Starting HEAD for this pass: `60b43b3` (clean tree,
identical to `origin`). Ending HEAD: `git log -1` (two commits for this pass:
the rate-limit/music/playback fix, then integrations + documentation).

## Recovered state before editing

`git status` clean, `git fetch` showed only `origin/main` and the working
branch (the predecessor `arena/e2b42b08` is not on the remote). No second
session was racing the branch. Everything below was verified against the code
in this checkout, not against earlier summaries.

## What this pass changed

### 1. Confirmed cause of "Discord is rate limiting permission checks"

The toast text comes from `packages/core/src/discord-permissions.ts`. The
trigger was not a Discord-wide problem and not a mislabelled app limit: **every
mutating dashboard request** passed `fresh = true` through
`apps/web/lib/auth.ts` → `DiscordPermissionClient.guilds(..., fresh)`, which
skipped the 30-second success snapshot. A burst of music controls (pause, skip,
volume, repeat) therefore issued one `GET /users/@me/guilds?limit=200` per
click against the same per-token bucket until Discord answered `429`. The
"1 seconds" wording came from `Math.ceil(delay / 1000)` with a 1000 ms floor,
and it was never pluralized.

Fix (not "remove authorization", not a sleep, not a global lock):

- explicit snapshot windows: **30 s for reads, 10 s for mutations**, with
  in-flight coalescing unchanged, so a burst of controls shares one lookup;
- the snapshot is still only what the dashboard _offers_ — the bot re-fetches
  the member and re-checks module, DJ role, voice, channel and hierarchy at
  execution time, so a 10-second window is never execution authority;
- `429` still fails closed, keeps `Retry-After`, and blocks the key (or globally
  for a global limit) instead of retrying in a loop;
- correct singular/plural cooldown wording;
- client: a duplicate submit is impossible while one action is in flight, and
  the newest dashboard snapshot wins over a slower older response.

### 2. Music capability audit and the two gaps it justified

`docs/MUSIC.md` now carries a capability matrix (backend capability,
implemented, slash commands, dashboard, mocked tests, verified live, disabled /
limits). "Installed" and "working" are separate columns; **no row claims a live
verification**, because none was possible here.

Two capabilities were genuinely missing and were implemented rather than
documented away:

- **`/search`** — explicit search-and-select. Quick play (`/play`, first match)
  is unchanged. `/search` lists up to five results with title, artist, source
  and duration in a select menu whose session is bound to the member and guild,
  expires after two minutes, and is single-use; the selected tracks are
  re-validated and re-authorized, and a track already queued or playing is not
  added again.
- **`/seek`** — seconds in, Lavalink milliseconds out, finite durations only,
  clamped to one second before the end, refused for live/unknown-length
  sources, exposed as a dashboard slider that commits once per interaction.

**Lyrics were deliberately not added.** No maintained, license-clear provider is
configured, and a button that sometimes returns nothing would claim a
capability Orbit cannot keep; the limitation is documented instead, including
what a future integration would have to provide (server-side key, cache,
attribution, honest "not found", timestamps + alignment before the word
"synced"). No plugin was added to populate the matrix.

### 3. Playback timing

`playbackProgress` now measures the age of the snapshot in **server time**
(the payload's `referenceAt` removes browser clock skew), stops interpolating
after 90 seconds of silence, and reports `status: "stale"` instead of an
indefinite "Now playing". The dashboard badge reads **State unconfirmed**, the
position is labelled "last known", and an explanation points at the bot logs
and the audit log. The local clock uses one monotonic anchor and reconciles on
every new payload plus on `visibilitychange`, so a throttled background tab does
not animate an old state. Nothing polls Discord or Lavalink per second.

### 4. Integrations

- `packages/core/src/integration-http.ts` is now the single trusted-provider
  transport: explicit timeout, bounded streaming body read (1 MiB), no
  redirects, no cache, validated JSON, and a small error vocabulary
  (`auth`, `rate-limited`, `timeout`, `unavailable`, `invalid-response`,
  `not-found`, `rejected`) with a derived `retryable` flag. **No automatic
  retries** — the route, the job queue and a caller may already retry.
- A provider timeout used to surface as a raw abort, which the route reported as
  **400**; it is now a `504`-shaped `UpstreamError` and the route's existing
  mapping produces **502** with `Retry-After` when the provider sent one.
- Administrator-supplied URLs (RSS/Atom, webhooks) stay on the separate SSRF
  pipeline in `feeds.ts` with DNS pinning and redirect validation. No shared
  "fetch anything" client was introduced.
- New `docs/INTEGRATION-ARCHITECTURE.md`: ownership table, shared vs
  provider-specific responsibilities, cache/rate-limit table, error vocabulary,
  how to add a provider, and what Orbit refuses to do.

### 5. Consistency fix (bounded)

A configured **DJ role that no longer exists** silently dead-ended members with
"the DJ role is required" and could not be distinguished from a permission
problem. Now: non-managers get an explicit "the configured DJ role no longer
exists" message, Manage Server members can still control playback and repair the
setting, access is never silently widened to everyone, and the music setup
banner reports **Needs setup** for that state.

### 6. Documentation

- **`/docs` in the product**, generated at build time from the repository's own
  Markdown (`docs/*.md`, `README.md`), with grouped navigation, per-page table of
  contents, stable `/docs/<slug>` links, previous/next links, a skip link, and a
  no-JavaScript mobile disclosure. Repository-relative links are rewritten to
  in-app URLs; output is sanitized with the `sanitize-html` dependency already in
  use.
- Contextual links: each module's setup banner links to its guide, the help
  dialog links to setup/permissions/dashboard/music/news/deals, and the command
  reference links to channel guidance.
- New pages: `DOCUMENTATION.md` (framework/hosting research with sources, the
  visibility decision, contribution rules), `CHANNELS-AND-PLACEMENT.md`
  (requirements vs recommendations per command and module),
  `INTEGRATION-ARCHITECTURE.md`.
- Command reference stays generated from the registration builders; `/search`
  and `/seek` appear there automatically, with their arguments, limits and
  runtime notes (46 invocations across 31 roots).

**Docs visibility decision: public.** Developer documentation describes code that
is already public in this repository and contains no credentials. Role gating
would add a trusted-guild/role-ID model, revocation and cache-key rules, and
would force dynamic rendering of otherwise static pages, all to hide non-secret
text. If a page ever must be non-public, it stays out of `docs/` and out of the
build rather than being "protected" by a role check.

## Checks actually run (this pass)

| Check                          | Command                                 | Result                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration               | `npx vitest run`                        | **724 tests / 61 files passed** (baseline before this pass: 692 / 58)                                                                                                                                               |
| Music + permissions slice      | targeted vitest suites                  | `music-service` 14, `music-search` 7, `music-progress` 6, `permissions` 12, `music-api` 7                                                                                                                           |
| Transport hardening            | `tests/integration-http.test.ts`        | 6 tests (classification, timeout, redirect/cache policy, bounded body, no retry, Retry-After)                                                                                                                       |
| Documentation pipeline         | `tests/docs-content.test.ts`            | 5 tests (file existence, unique slugs, anchors/TOC, sanitized raw HTML, link rewriting, path escape)                                                                                                                |
| Types                          | `tsc --noEmit` (root + `apps/web`)      | passed                                                                                                                                                                                                              |
| Lint / formatting              | `npm run lint`, `npm run format:check`  | passed (Prettier clean)                                                                                                                                                                                             |
| Production build               | `npm run build`                         | passed (Next + 6 tsup bundles); `/docs` static, `/docs/[slug]` with 20 prerendered pages                                                                                                                            |
| Demo smoke (production build)  | `curl` on `npm start`, `DEMO_MODE=true` | `/docs` 200; `/docs/music` 200 with rewritten in-app links; dashboard music page contains the seek control; `POST {action:"seek",position:12}` → `{"ok":true,"demo":true}` and the snapshot position became `12000` |
| Browser suites (CI, this pass) | `npm run test:e2e` on the pushed branch | **56 passed** (1.1 min) including the new `tests/e2e/docs.spec.ts` (index, in-page anchors, 390 px layout); `verify` and `containers` jobs green on run `40243107496`. Locally not runnable (no Chromium binary)    |

Not executed here, and why: live Discord authorization and audible playback (no
credentials/Lavalink), live Steam/ITAD traffic (no outbound access), Docker
Compose, a real database for migrations (no `TEST_DATABASE_URL`), and Playwright
locally (no browser binary). CI did run the browser suites on the pushed
commits: 56 passed, with `verify` (lint, typecheck, unit, build, e2e) and
`containers` green.

CI caught two real regressions that local runs could not: the command-reference
literals (31 roots / 46 invocations, 11 music invocations) had drifted when
`/search` and `/seek` were added, and the documentation heading renderer escaped
inline-code tags into the visible text and the anchor id. Both are fixed in
follow-up commits on this branch.

## Decisions recorded

| Decision                                   | Rationale                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Reusable permission snapshot (30 s/10 s)   | Fixes the confirmed cause without weakening authorization; bot-side execution checks remain authoritative |
| Explicit `/search` next to quick `/play`   | The first search result is a guess; selection is a real capability, not a replacement for quick play      |
| No lyrics provider                         | No maintained, license-clear option here; a dead button would imply capability Orbit cannot promise       |
| No new workspace package for integrations  | The providers already live in `packages/core` with no new dependency or runtime boundary                  |
| Markdown rendered in the existing Next app | One content source, no second deployment, no docs framework; `marked` is the only added dependency        |
| Developer docs public                      | They describe public code and contain no secrets; gating adds authorization complexity for no protection  |
| No automatic transport retries             | Retries are a caller decision; multiplying them across HTTP/jobs/callers floods an unhealthy provider     |

## Still deferred (unchanged or newly explicit)

1. **Tickets** — not implemented; criteria unchanged (overwrite model, per-member
   limits, restart/deleted-channel reconciliation, explicit retention policy).
2. **Health extension** — heartbeat/shard/queue-depth/feed-freshness sources are
   still absent; the music backend case distinguishes "configured", "connected"
   and "confirmed playback" but does not add new measured sources.
3. **Lyrics** — documented limitation, no provider.
4. **Dashboard search-and-select** — `/search` is Discord-only; the dashboard
   offers quick play. A two-step dashboard flow (search → pick) would need a new
   endpoint and its own expiry/authorization contract, so it is not claimed.
5. **Live verification** — the capability matrix's "verified live" column is
   empty; no Discord guild, Lavalink backend or audible test was available.
6. **OG/store images** — still needs an SSRF-reviewed fetcher with cache and size
   limits.

## Pass 3 (2026-10-26): stale dependency tree, Steam artwork, tables, docs

Branched from `8c68304` (local HEAD == `origin/arena/99c6cf65-discordjs-starter`,
clean tree). Nothing was reset, rebased or removed; the earlier passes' work is
intact. All commits below are on `arena/99c6cf65-discordjs-starter`.

### What changed

| Commit      | Change                                                                                                   | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `5058360`   | `scripts/check-dependencies.mjs` runs before `dev`, `build`, `build:web`, `start` and `test`             | The reported `Module not found: Can't resolve 'marked'` came from a **stale dependency tree**, not a missing manifest entry: root `package.json` and the lockfile both have `marked`, and a clean `npm ci` builds. The guard names the missing packages and the two real remedies (host `npm ci`; remove only the `<project>_dev_node_modules` volume). Reproduced by moving `node_modules/marked` aside and restoring it.                                                                                                                                     |
| `fd0d678`   | Type declaration for the guard                                                                           | Its TypeScript test imports a `.mjs` file; without the declaration `tsc` failed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `e2c23c1`   | Steam **app artwork** as a labelled fallback (`packages/core/src/steam-artwork.ts`, wired in `feeds.ts`) | `ISteamNews/GetNewsForApp` has **no image field** (verified against the recorded captures in `tests/fixtures/steam/`). Article markup still wins; otherwise the documented `appdetails` `header_image`/`capsule_image` is used, cached once per app id (6 h success, 10 min failure, one in-flight request, bounded LRU), accepted only from Steam's image CDNs. `imageKind`/`imageAttribution` travel to the card (visible label) and the Discord footer (`Store artwork`). `STEAM_APP_ARTWORK=false` disables it; a failed lookup leaves the item text-only. |
| `0219c3a`   | Reference-style news feed; server-side table sorting and column visibility; one history query contract   | See `docs/DASHBOARD-WORKFLOWS.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| this commit | Text reduction, developer docs, README trim                                                              | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Text/dashboard pass: the setup banner caveat, the audit and permission
explanations, the music settings note and several empty states were shortened,
and news diagnostics moved into two disclosures. Consent, privacy, destructive
and unconfirmed states were **not** shortened (delete-configuration dialog,
webhook secret handling, stop-playback warning, delivery "do not resend").

Documentation: the in-app docs system already existed (`apps/web/lib/docs-content.ts`,
`/docs`, `docs/DOCUMENTATION.md`); three pages were added to its manifest —
`DASHBOARD-WORKFLOWS.md`, `DEVELOPER-NAVIGATION.md`, `ORPC-DECISION.md` — for 23
documented pages. The existing music capability matrix in `docs/MUSIC.md` stays
the single matrix; a second one was written and then deleted rather than left as
a duplicate.

### Copy before → after (evidence for the text pass)

No screenshots: this sandbox cannot install Chromium (`npx playwright install
chromium` fails to download), so layout is verified by the Playwright specs in
CI, not by pixels here. The text changes are exact:

| Where                         | Before                                                                                                                                                                                                                                        | After                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module setup banner           | "Configuration + synced metadata only, not an authorization or live delivery/playback test."                                                                                                                                                  | "Configuration only — not a live delivery or playback test."                                                                                            |
| Audit log intro               | "Names and avatars are recorded when an action happens. They are not refreshed afterwards, so an entry shows who acted at that moment — not necessarily someone's current Discord avatar. Missing or deleted pictures fall back to initials." | "Names and avatars are captured when the action happened and never refreshed, so an entry shows who acted then — not necessarily their current avatar." |
| Permissions intro (hierarchy) | "Orbit never needs Administrator. Keep its role above the roles it manages, and give it access only to the channels it needs. Channel and role changes are managed in Discord and synced here."                                               | "Orbit never needs Administrator: keep its role above the roles it manages. Channel and role changes happen in Discord and are synced here."            |
| Permissions checklist         | "Dashboard OAuth uses identify + guilds. Owner/Manage Server (or Administrator) authorizes the dashboard, not bot powers; writes re-check authorization."                                                                                     | "Dashboard sign-in uses identify + guilds. It grants no bot powers, and every write re-checks your permissions."                                        |
| Music settings note           | "Lavalink connection settings and search-source prefixes are configured server-side. They never appear in the browser."                                                                                                                       | "Lavalink settings live on the server and never reach the browser."                                                                                     |
| News test flight              | Always-visible paragraph about normalization/limits, plus a count line and a per-card notice list                                                                                                                                             | One collapsed "Preview details" per card (configured source vs provider feed) and one for the dialog (limits, counts, notices)                          |
| News empty preview            | "The source is reachable but has no recent items. Incoming webhooks wait for your integration to send an event."                                                                                                                              | "No recent items yet. Webhook sources only post when your integration sends an event."                                                                  |

Kept verbatim on purpose: the delete-configuration warning, the webhook-secret
one-time display, "This stops playback, clears the queue, and disconnects Orbit
from voice", the delivery "Do not resend" warning, and every provider/outage
error message.

Provider terms found while checking `steamcommunity.com/dev`: `ISteamNews` is
listed among the Steam Web APIs, whose documented use requires a key and the API
Terms of Use; `appdetails` is a store endpoint outside that surface. Orbit's
recorded captures were made without a key and returned normal JSON, so no key
requirement is invented — this is written down in `docs/NEWS-FORMATTING.md` as a
follow-up rather than silently assumed.

### Checks actually run (fresh, this session)

| Check                                                    | Result                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` (after the install that reproduced the failure) | 628 packages                                                                                                                                                                                                                                                                                                                     |
| `npm run typecheck`                                      | pass                                                                                                                                                                                                                                                                                                                             |
| `npm run lint`                                           | pass                                                                                                                                                                                                                                                                                                                             |
| `npm run format:check`                                   | pass                                                                                                                                                                                                                                                                                                                             |
| `npx vitest run`                                         | **771 tests in 65 files pass**                                                                                                                                                                                                                                                                                                   |
| `npm run build:web`                                      | pass — 31 static pages, 23 `/docs/*` routes prerendered                                                                                                                                                                                                                                                                          |
| `npm run build:services`                                 | pass                                                                                                                                                                                                                                                                                                                             |
| Demo server (`DEMO_MODE=true npm start`)                 | `/docs` and `/docs/music` render; `/api/guilds/<demo>/history?...&sort=actorName&dir=asc` returns sorted rows; an unknown history parameter returns `400 Unknown history parameter "bogus".`; `POST /api/guilds/<demo>/music {"action":"seek","position":42}` → `{"ok":true,"demo":true}` and a missing position → a clear error |

CI (GitHub Actions, `Orbit CI` run `40247481151` for commit `d484da7`) is
**green**: `verify` ran `npm ci`, lint, typecheck, the full vitest suite against
PostgreSQL 17, `npm audit --omit=dev`, `npm run build` and `npm run test:e2e`
(the browser suite reported 56 passing), and `containers` passed. That is where
the browser-level behaviour of the news feed, tables and docs is verified — not
in this sandbox.

Not run, and therefore not claimed: a live Discord bot, Lavalink audio, a real
PostgreSQL/Redis deployment, and browser screenshots. **This sandbox cannot
install a Chromium build** (`npx playwright install chromium` fails to download),
so no desktop/mobile screenshots were produced; the browser specs in
`tests/e2e/` remain the place where layout is verified, and they run in CI. In
their place: rendered-markup and view-model assertions
(`tests/news-feed-model.test.ts`), SQL-level ordering tests against PGlite
(`tests/database.test.ts`), and the demo-server responses above. CI for these
commits has not been observed.

### Still deferred

- Status inventory with counts and a sort control (reference dashboard): state
  and counts exist in `module-setup.ts`, so this is presentation work only.
- Facet counts on history filters; a share/copy action on news cards.
- Row selection and bulk actions: no dataset has a multi-row action that is safe
  (audit, deliveries and cases are append-only evidence).
- oRPC: deferred with explicit revisit triggers in `docs/ORPC-DECISION.md`.

## Pass 4 (2026-10-26): verified provisioning, shared UI primitives, honest visual status

Start `9c1c98c` → end at this commit (all on `arena/99c6cf65-discordjs-starter`,
pushed, no PR operations). Previous reports were treated as historical: the state
was re-read (`git status`, `git log`, `git ls-remote`, `docs/`) before any edit.

Commits: `5035f30` (dependency provisioning), `4c439ae` (shared tab bar, confirm
dialog, checkbox, news caption, copy), `5502068` (domain boundary comments),
`3c8c2ca` (screenshot evidence + table decision), `08cba2b` (e2e tab roles),
`7d33b70` (screenshot output path), `912fd62` (shared card header, heading sizes),
`f72c4a9` (shared error block and table footer), then this documentation commit.

### Completion matrix (five-way, not aspirational)

| Area                                                        | Status                                          | Evidence / what is missing                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency provisioning (detection _and_ refresh)           | **Implemented**                                 | Reproduced the stale-volume case and the documented refresh in a mount namespace; guard rewritten around the verified path (`5035f30`). See the table below.                                                                                                                                  |
| Dependency guard scope                                      | **Implemented**                                 | 10 production imports only, ~50 ms, no installs, no package-manager duplication; hooks reduced to `dev`, `build:web`, `start` (`pretest` dropped, duplicate `prebuild` dropped).                                                                                                              |
| Steam artwork hierarchy + honest labelling                  | **Implemented, visually unverified**            | Article art → verified event art → app-art fallback → text-only unchanged. The prominent per-card badge became a caption over the artwork it describes, matching the Discord footer's "Store artwork". Pixels not inspected.                                                                  |
| Table behaviour and query contract                          | **Implemented**                                 | Server-side sort/filter/pagination, allow-lists, `aria-sort`, column visibility, page reset. Regression-tested through the history API and browser specs.                                                                                                                                     |
| Table library decision                                      | **Deliberately rejected** (TanStack v8)         | Earlier justification ("the server paginates") was wrong and is corrected in `docs/TABLE-DECISION.md`; the decision now rests on measured cost and what stays caller-owned, with revisit triggers.                                                                                            |
| Shared UI primitives on the Radix base                      | **Partially implemented**                       | This pass: one tab bar (was three copies), one destructive confirm (was two), one checkbox (was four ad-hoc sizes/accents). Not yet uniform: card/section headers, a few page toolbars, error/retry blocks, and the permission checklist's own table markup.                                  |
| Dashboard-wide copy reduction                               | **Partially implemented**                       | Eight more blocks shortened this pass (table below). Still verbose by the same measure: `permission-setup.tsx`, `layout/install-prompt.tsx`, `login`, and the community page's notices.                                                                                                       |
| Comment review at public boundaries                         | **Partially implemented**                       | Four highest-risk boundaries documented (`economyTransaction`, `reserveDelivery`, `dispatchItems`, `authorize`). Command/event bootstrap, music lifecycle internals and some dashboard shared infra still lack a responsibility note.                                                         |
| Reference interaction patterns (shadcn Tasks, dashboard-01) | **Deliberately rejected** as wholesale adoption | Radix base retained; `aria` base would add `react-aria-components` (a second primitive library). Individual patterns (tab semantics, confirm dialog, caption-over-status) adapted where they solve a real duplication.                                                                        |
| Facet counts, row selection/bulk actions, share action      | **Deferred**                                    | No dataset has a bulk operation that is safe without new server-side authorization; facet counts must come from `GROUP BY` under the same predicate (documented in the table decision) and no filter currently needs them.                                                                    |
| Status inventory with counts and sorting                    | **Deferred**                                    | Unchanged: state exists in `module-setup.ts`; it is presentation work with no correctness value yet.                                                                                                                                                                                          |
| Visual verification (desktop + mobile screenshots)          | **Not verified by this environment**            | CI now produces and uploads `dashboard-screenshots` (2.26 MB, run `40251261615`). The sandbox cannot download GitHub artifacts (Azure blob host is outside its allowlist) and cannot install Chromium, so **no pixels were reviewed by me**. The user must open the artifact to judge layout. |
| Live Discord / Lavalink / real PostgreSQL-or-Redis deploy   | **Not verified**                                | Unchanged: no tokens, no Lavalink, no Docker daemon here. CI exercises containers and the pinned music backend headlessly.                                                                                                                                                                    |

#### Four things this pass does _not_ claim

1. The dashboard-wide shadcn normalisation is **not finished** (see the "partially
   implemented" rows above); touched pages improved, the inventory below is the
   remaining list.
2. No visual approval. Screenshots exist; nobody has looked at them yet.
3. `npm ci` repairs a stale **dependency** volume in this stack; that is a
   different statement from "any container install repairs any mount".
4. The table decision is a _rejection with triggers_, not proof that TanStack is
   unsuitable in general.

### Dependency provisioning: what was actually tested

Conditions: this sandbox has no `docker`/`podman`, but `unshare -rm` works, so a
named volume could be emulated faithfully — a directory installed from an older
commit, bind-mounted over the checkout's `node_modules`.

| Case                                                        | How                                                                                                                                   | Result                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) fresh checkout                                          | `git archive HEAD` into a clean dir, `npm ci`                                                                                         | 628 packages, `marked@16.4.2`, guard passes                                                                                                              |
| (b) fresh container without a dependency volume             | image `deps` stage runs the same `npm ci`; first use seeds the volume from the image                                                  | Equivalent to (a); nothing depends on the host's `node_modules`                                                                                          |
| (c) existing volume created before `marked` existed         | tree installed from `eeb0e68` (pre-`marked`) mounted over `node_modules`                                                              | `scripts/check-dependencies.mjs` fails naming `marked`; `next build` fails with `Module not found: Can't resolve 'marked'` (previous symptom reproduced) |
| (d) **documented refresh inside the container**, then build | `npm ci` **inside** the mounted tree, then `next build`                                                                               | 628 packages installed **into the volume**, guard passes, build compiles — so the refresh path works                                                     |
| (e) fallback only when npm cannot write to the volume       | earlier text told users to delete `<project>_dev_node_modules` _first_, on the false premise that an in-container install cannot work | Now: `npm ci` first; recreate that one volume only for `EACCES`; database/Redis/demo-data/Next-cache volumes and `down -v` explicitly off-limits         |

What distinguishes the layers, and is now written down once:
**image** = a lockfile snapshot taken at build time; **named volume** = the live
install directory (`/app/node_modules`), seeded from the image only on first use;
**bind mount** = the source checkout, which also supplies the current
`package-lock.json`; **ownership** = `node` (uid 1000) inside the image, so a
volume created by another uid is the one case where the install fails;
**lockfile changes** = the trigger for the whole problem.

### Data table: corrected reasoning

`docs/TABLE-DECISION.md` replaces the wrong client-side/server-side argument with:
measured tree-shaken cost of `@tanstack/react-table@8` (54,133 bytes → **14.4 kB
gzip**, 5 packages), what remains caller-owned even with it (`aria-sort`,
keyboard, faceted counts still needing `GROUP BY`), and the fact that four fixed
datasets already share one validated server query contract. Decision: **retain**,
with explicit revisit triggers (a fifth dataset needing grouping/selection, shared
column definitions, or client-side filtering).

### Shared UI consolidated this pass

| Duplication                                             | Before                                                                                                               | After                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section tab bar (economy, resources, server pages)      | Three copies with different padding/hover/capitalisation, and no tab semantics: plain buttons, no roles, no keyboard | `components/ui/tabs.tsx`: `role=tablist/tab`, roving `tabindex`, Left/Right/Home/End move selection **and** focus. Economy wires `TabPanel`; the two sections with large conditional trees opt out of `aria-controls` rather than pointing at a missing element |
| Destructive confirmation (shop item, configuration)     | Two hand-rolled footers, one dismissible while the request was in flight                                             | `components/ui/confirm-dialog.tsx`: one component, destructive button disabled and dialog non-dismissable in flight, consequence text required                                                                                                                  |
| Checkbox accent/size (resource editor ×3, draft editor) | `size-3`, `size-4 accent-violet-600`, or no class                                                                    | `Checkbox` in `ui/primitives.tsx` (native input kept for real keyboard/AT behaviour)                                                                                                                                                                            |
| News provenance chip                                    | Filled `Badge` competing with source attribution for the first line of every app-artwork card                        | Caption over the artwork's lower edge with a gradient scrim, so provenance stays attached to the image it describes                                                                                                                                             |

Assertion added instead of a claim: `tests/e2e/layout.spec.ts` now pins the tab
contract (selected state, roving tabindex, ArrowRight/End/Home). Four existing
specs had been clicking tabs as `role=button`, which encoded the old, wrong
semantics; they now use `role=tab`.

### Copy before → after (this pass)

| Where                    | Before                                                                                                                                                                                                                                                                                                                    | After                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| News routing preview     | "Use sample text against this server's saved source keywords, source tags and enabled routes. This is the same matcher used by the delivery outbox. It does not fetch a feed, test credentials, ping a role, contact Discord, enqueue a delivery or store the sample. Saved/synced metadata is not proof of live access." | "Runs sample text through the saved keywords, tags and routes with the same matcher delivery uses. No feed is fetched, nothing is sent, and nothing is stored. Saved metadata is not proof of live access."                          |
| Draft dialog description | "Saving never publishes. Plain text only; mentions are suppressed. Do not include secrets or sensitive personal information. Content is visible to server managers. Live content is eligible for deletion after 90 inactive days while the worker runs; demo records persist until deleted."                              | "Saving never publishes. Plain text only; mentions are suppressed. Do not include secrets or personal information — server managers can read this. Live drafts are removed after 90 inactive days; demo records stay until deleted." |
| Commands page helper     | Three paragraphs including "Generated from the bot's registration definitions. This does not verify which commands are currently registered in Discord. Server command overrides and runtime permission checks still apply." plus a separate registration paragraph                                                       | One paragraph: "Generated from the registration definitions — it does not check what Discord currently has. After changing definitions, run `npm run commands:register`; this page never registers or runs anything."                |
| Steam source note        | "Asks Steam for this app's announcement feed, so posts syndicated from other publishers are not requested. Steam does not publish a "first party" field; Orbit treats Steam's app-announcement feed as the app's own channel and never claims more than that."                                                            | "Uses Steam's app announcement feed only, so posts from other publishers are not requested. Steam has no "first party" field — the feed is the signal, nothing more."                                                                |
| Music adapter note       | Five sentences including catalogue availability disclaimers                                                                                                                                                                                                                                                               | Four shorter sentences; the same constraints (approved adapters, authorization, disabled sources, no SFW guarantee)                                                                                                                  |
| Economy helper card      | "Every reward and transfer is recorded. Atomic transactions mean no double claims, no negative balances, and no lost little thank-yous."                                                                                                                                                                                  | "Every reward and transfer is recorded; atomic transactions rule out double claims and negative balances." (the virtual-currency/no-gambling line is untouched)                                                                      |
| Docs index intro         | "These pages are generated from the repository's own Markdown, so a guide here is the same file a developer reviews in a pull request. There is no second copy to drift out of sync."                                                                                                                                     | "Every page here is the repository's own Markdown, rendered at build time — one source, no second copy to drift."                                                                                                                    |

Kept verbatim on purpose: the webhook-secret note, the stop-playback warning, the
delivery "Do not resend" ambiguity warning, the OAuth scope description, the
privileged-intent note, and every setup blocker (a shortened sentence that hid a
requirement would be a regression, not a tidy-up).

### Comments and navigation

Four boundary functions gained the contract a caller has to hold, and nothing else
was annotated (no diary entries, no restating the code):

- `packages/db/src/economy.ts` `economyTransaction` — idempotency key semantics
  (replay returns the original result; same key + different payload throws), one
  transaction for balance and ledger, errors are user-facing text.
- `packages/db/src/store.ts` `reserveDelivery` — `null` means "already claimed, do
  not retry"; a returned row is a reservation, not a delivery.
- `packages/db/src/outbox.ts` `dispatchItems` — silent `0` for
  uninstalled/disabled races, demo throws, belongs to the worker, never a request.
- `apps/web/lib/auth.ts` `authorize` — the single dashboard authorization
  boundary, why `mutating` shortens the permission cache, and that it grants no
  bot ability.

`docs/DEVELOPMENT.md` and `docs/DEVCONTAINER.md` were corrected rather than
expanded: one install path, the real mechanism, and the verification date.

### Visual verification: precise status

- A CI step now runs `tests/e2e/screenshots.spec.ts` with `VISUAL_EVIDENCE=1`
  (fixed light theme, desktop 1440×900, mobile 390×844, demo data, tour dismissed,
  animations disabled) and uploads `visual-evidence/` as **`dashboard-screenshots`**
  (2.26 MB on run `40251261615`). Captures: overview, news, music, audit, settings
  form, economy, channels, the stop-playback confirmation, an audit no-match state,
  mobile overview and mobile navigation.
- These are **evidence for a human reviewer**, not assertions. The spec says so in
  its own header; a green run proves the pages loaded, not that they look right.
- This environment **could not inspect them**: GitHub artifact downloads redirect
  to `*.blob.core.windows.net`, which is not in the sandbox's allowlist (verified by
  direct request: TLS connection refused), and no Chromium/Firefox binary exists or
  can be downloaded (`cdn.playwright.dev` unreachable). So spacing, contrast,
  truncation and mobile usability were **not** reviewed here, and no visual
  approval is claimed. What was checked instead: server-rendered markup (tab
  roles/`aria-selected`/`tabindex` on `/channels`, `/economy`, `/news`), and the
  browser specs that assert behaviour and focus handling.

### Checks actually run (fresh, this session)

| Check                                                                                                 | Result                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                                                                                      | **772 tests in 65 files pass** (was 771; +1 guard/documentation test)                                                                                                                                                                  |
| `npm run typecheck`                                                                                   | pass                                                                                                                                                                                                                                   |
| `npx eslint apps packages tests`                                                                      | pass                                                                                                                                                                                                                                   |
| `npm run format:check`                                                                                | pass                                                                                                                                                                                                                                   |
| `npm run build:web`                                                                                   | pass                                                                                                                                                                                                                                   |
| Demo server (`DEMO_MODE=true`, port 3100)                                                             | `/overview`, `/economy`, `/music`, `/news`, `/roles`, `/moderation`, `/deals`, `/settings`, `/audit`, `/channels`, `/commands` → 200; `/channels`, `/economy`, `/news` render `role="tablist"` with exactly one `aria-selected="true"` |
| Stale-volume reproduction                                                                             | guard fails + `Module not found: marked`; then in-place `npm ci` → 628 packages, guard passes, build compiles                                                                                                                          |
| CI `verify` (runs `40251261615` on `7d33b70`, `40252441907` on `f72c4a9`, `40253588945` on `be80014`) | **success** — lint, typecheck, vitest on PostgreSQL 17, `npm audit --omit=dev`, build, screenshots step (4 tests), browser suite **57 passed / 4 skipped**, artifact uploaded                                                          |
| CI `containers` (same run)                                                                            | success — Compose validation, both image targets, unprivileged dev-image smoke test, pinned Lavalink build and headless backend check                                                                                                  |

Not run, and not claimed: live Discord, real Lavalink audio, a real
Postgres/Redis deployment, and any review of the screenshot pixels.
Documentation-only commits made after a green run are not separately claimed.

### Still deferred

Unchanged from pass 3 (status inventory, facet counts, share action, bulk
actions with defined page-vs-filtered semantics, oRPC), plus the items the matrix
marks partially implemented: page-level toolbar/filter normalisation, `Badge` tone
consistency across cards, the remaining long copy in `permission-setup.tsx`
(deliberately kept: those lines are requirements, not prose) / `install-prompt.tsx`
/ `login`, and comment coverage for bootstrap, music lifecycle and dashboard
shared infra.

## Pass 5 — music regressions first (in progress)

Start commit **b39a630**. Work below is on `arena/99c6cf65-discordjs-starter`; the
music slice landed in **2d8f3a0** and the `/help`, presence, delivery-link and docs
work follows it.

### The reported playback failure: confirmed cause vs. ruled out

Reported audit row: action `failed`, target `music playback`, actor `Orbit` with
`actorAvatar: null`, backend Lavalink 4.2.2 / Lavaplayer 2.2.6 / Soundy 1.1.0 /
youtube-source 1.18.2, message:

```text
All clients failed to load the item.
Client [ANDROID_VR] failed: This video requires login.
Client [WEB] failed: No supported audio streams available.
```

**Confirmed** (vendor source read this week, not inferred):

- Both lines come from two clients of the _same_ source manager, so this is not a
  plugin overlap and not a second YouTube loader.
- youtube-source 1.18.2 is the newest release (published 2026-07-27); an outdated
  JAR is not the cause.
- `DEFAULT_CLIENTS` in `YoutubeAudioSourceManager` is exactly
  `MUSIC, ANDROID_VR, WEB, WEBEMBEDDED` — the list Orbit ships. None of those four
  is OAuth-only (`TV` is the only client whose playback needs sign-in, and it is
  not enabled).
- `allowDirectVideoIds` / `allowDirectPlaylistIds` only gate _bare identifiers_;
  full `watch?v=`, `youtu.be`, `shorts`, `live` and `playlist?list=` URLs route
  regardless. The URL was accepted and resolved, so this is a post-lookup provider
  restriction, not URL validation.
- Consequence: the item requires an authenticated YouTube session. The documented
  escapes are OAuth (burner account, real termination risk) or a `poToken`
  (WEB/WEBEMBEDDED only), both optional, both "not a silver bullet". Orbit keeps
  them off, logs the category as `provider-login`, and says so instead of pretending
  another recording played.

**Not claimed**: that other YouTube items play. No live Lavalink/Discord run was
available here.

### Disconnect behaviour (was the visible regression)

| Situation                                 | Behaviour                                                            |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Queue finished                            | Wait `music.idleDisconnectSeconds` (default 60, `0` = leave at once) |
| Track failed to load                      | Same wait, same timer, reason `track-failed`                         |
| Voice channel has no humans               | 15 s grace, cancelled when a human returns                           |
| New track queued during the wait          | Timer cancelled; same session continues                              |
| `/stop`, `/disconnect`, node/gateway loss | Leave immediately, cancel the timer                                  |

One `unref`'ed timer per guild, replaced rather than stacked, re-checked inside the
per-guild lock before leaving. Covered by `tests/music-idle.test.ts` (fake timers)
and five service-level cases in `tests/music-service.test.ts` (queue end, load
failure, stale-timer re-check, real empty state, shutdown cleanup).

### Other changes in this pass

- Failure categories (`provider-login`, `no-streams`, `drm`, `rate-limit`, `auth`,
  `network`, `format`, `unknown`), a ≤300-character table summary, and the full
  diagnostic in a new `audit_logs.details` column (migration 0004). Bot audit rows
  now carry the bot's real avatar; the worker fetches `/users/@me` once instead of
  writing avatar-less rows.
- `/queue` and the dashboard now show the provider's public page (query strings
  stripped except YouTube's `v`/`list`), validated artwork, requester, voice channel,
  server-reported position and a bounded queue. No stream or signed URL reaches
  Discord or the browser.
- A bare YouTube id is answered with "paste the full link" instead of being sent to
  the search adapter as meaningless text.
- `/help` is generated from `getCommandCatalog()` (same builders the registration
  script uploads): grouped by module, 🔒 for permission-restricted commands,
  paused-module markers, per-command usage/arguments/permissions/setup notes, docs
  links that fall back to the public repository when `APP_URL` is local.
- Optional presence (`BOT_ACTIVITY`, `BOT_ACTIVITY_TYPE`, `BOT_STATUS`), set once
  after readiness, no rotation and no invented counts; empty `BOT_ACTIVITY` disables
  it. Covered by `tests/presence.test.ts`.
- Delivery rows link to the Discord message only when guild, channel and message id
  were all confirmed (`deliveries.message_id`, migration 0005); otherwise the title
  stays plain text.
- The documentation index can be filtered by title/summary/group with an explicit
  note that it is not a full-text search; the list stays in the server-rendered HTML.

### Verification (fresh, this branch)

| Check                                      | Result                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                           | **836 tests in 69 files pass** (was 818 before this pass)                                                                                                                     |
| `npm run typecheck`                        | pass                                                                                                                                                                          |
| `npm run lint`                             | pass                                                                                                                                                                          |
| `npm run format:check`                     | pass                                                                                                                                                                          |
| `npm run build:web`                        | pass (`/docs` prerendered with the filter)                                                                                                                                    |
| `npm run build:services`                   | pass                                                                                                                                                                          |
| CI `verify` (run 40258147290 on `fa98624`) | **success** — lint, typecheck, vitest on PostgreSQL 17, `npm audit --omit=dev`, build, screenshots step (4 tests), browser suite **58 passed / 4 skipped**, artifact uploaded |
| CI `containers` (same run)                 | **success** — Compose validation, both image targets, unprivileged dev-image smoke test, pinned Lavalink build, headless backend check                                        |

**Not verified here**: live Discord login, real Lavalink audio, audible playback,
and the screenshot pixels. The `dashboard-screenshots` artifact is produced by CI,
but this sandbox cannot download it (GitHub artifact downloads redirect to
`*.blob.core.windows.net`, outside the allowlist) and no Chromium can be installed,
so no visual approval is claimed for this pass.

### Deferred in pass 5

- **Connected member list**: no implementation exists today, and building it means a
  bot-side roster sync (schema + migration + job), a server-side paginated read and a
  dashboard view. A cache cannot be presented as the full list, so this stays a
  scoped piece of work rather than a UI-only stub. `GuildMembers` is already
  requested; `Presence` is deliberately still not.
- SponsorBlock guild configuration UI, LavaSearch/lyrics surfaces, and any plugin
  upgrade: the installed set is current, and third-party processing stays off by
  default.
- News provider URL matrix beyond the documented forms, and a plugin capability
  matrix refresh, remain documentation work already described in
  `docs/MUSIC-PLUGINS.md`.

## Pass 6 (2026-10-26): branch review — six findings fixed

Reviewed baseline **fee051a** on `arena/99c6cf65-discordjs-starter`. Each finding
was reproduced against the current code before anything was changed; three of the
six were behavioural (they had passing tests that asserted the wrong outcome), so
the new tests target the behaviour, not the shape of the code.

| Commit    | Finding                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `4a6041b` | 1 + 2 — `/search` returned one candidate; no explicit provider selection    |
| `e6a1975` | 4 — empty-channel disconnect could never happen; queue activity disabled it |
| `8fb6ed2` | 5 — docs/`/help` links were pinned to `blob/main`                           |
| `ef4f072` | 6 — `provider-login` wording asserted a cause the evidence cannot support   |
| `af45894` | docs for all of the above                                                   |

### 1. `/search` returned exactly one candidate

**Root cause**: `resolveMusicQuery()` mapped a `SEARCH` load into
`result.data.slice(0, 1)`, and `MusicService.search()` then sliced that single
result to at most five. The menu could only ever show one option; the
`min_values: 1 / max_values: 5` select was decorative.

**Fix**: the resolver takes a bounded `limit` (`MAX_SEARCH_CANDIDATES = 5`) and
`/search` asks for five while `/play` asks for one — the backend answers with the
number actually wanted instead of a list being thrown away. Quick play also
slices a _search_ result to one at the service boundary, so "first result" does
not depend on the resolver alone. Direct URLs and playlists ignore the search
limit entirely: a pasted playlist keeps all its tracks.

Search stays read-only (no voice join, no queue write) and every candidate still
passes the source-policy checks (`sourceName` must match the selected provider,
foreign/explicit-flagged items are refused). Session ownership, two-minute
expiry, single-use claim, and the re-authorization in `playSelection()` are
unchanged, and a new test proves a menu created before a DJ role was configured
is re-checked (and rejected) at selection time.

### 2. Explicit provider selection (SoundCloud, YouTube, YouTube Music, Bandcamp)

**Root cause**: there was no provider parameter anywhere. `prepareMusicQuery()`
always prefixed the text with `MUSIC_SEARCH_PREFIX` (default `scsearch`), so a
listener could only get SoundCloud text search, and the dashboard could not even
say which catalogue it was searching.

**Fix**: `packages/core/src/music-sources.ts` is the single provider table —
id, approved Lavalink prefix, required source manager, label, and the switch that
enables the adapter in _this_ deployment. `/play` and `/search` gained an optional
`source` option built from that table; the dashboard play form gained the same
select with an explicit "Server default" entry (the server's configured source,
not a dashboard guess). Omission means the configured default, never a change of
the global default.

- Only approved ids are accepted; raw Lavalink prefixes/source names are refused
  with the list of real choices (API 400, bot error, doctor `--source`).
- Capability is checked against the node's `/v4/info` `sourceManagers`. A missing
  adapter produces an actionable message naming the switch that enables it, and
  **no other provider is substituted** — there is no multi-provider aggregation.
- YouTube and YouTube Music are distinct choices (`ytsearch` / `ytmsearch`) even
  though both use `plugins.youtube`, and the `/search` header names the provider
  that answered.
- A `source` + URL combination is defined, not silently ignored: the URL still
  routes by validated hostname, and a `source` for a different provider is refused
  with the reason. The matching provider (or omitting it) keeps the URL a URL.

### 3. Music doctor provider validation

**Root cause**: `runMusicDoctor()` carried its own `scsearch → soundcloud`,
`bcsearch → bandcamp` ternary and warned "MUSIC_SEARCH_PREFIX must be scsearch or
bcsearch", so a perfectly valid `ytsearch`/`ytmsearch` configuration was reported
as broken and YouTube was invisible to the doctor.

**Fix**: the doctor reads the shared table. The report lists every provider with
its prefix, required manager, availability on this node and whether it is the
configured default; an unknown `MUSIC_SEARCH_PREFIX` is reported with the four
valid values and is not switched; a reachable backend with no source manager at
all says exactly that. `--source` selects the provider for the optional lookup.
Lookup success stays explicitly separate from playback ("does not prove
playback"), as before.

### 4. Empty-channel disconnect

**Root cause**: `leaveWhenIdle()` returned early whenever `state.current ||
state.tracks.length`, so an `alone` timer could never leave during playback — and
`enqueue()`, `next()` and every control action called `idle.cancel()` regardless
of reason, so queue activity in an abandoned channel disabled cleanup.

**Fix**: the reason decides the re-check, inside the per-guild lock.

| Situation                              | Behaviour                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Queue finished / track failed          | Leave only if nothing is playing and nothing is queued (unchanged)             |
| No human left, audio still playing     | Leave after the 15 s grace — playback does not block the empty-channel policy  |
| A human returns                        | Pending `alone` leave cancelled                                                |
| Only bots left in the channel          | Counted as empty                                                               |
| Track queued or started while `alone`  | Timer **kept**; the queue does not keep the bot in an empty channel            |
| New playback before a queue-idle fires | Queue-idle timer cancelled (unchanged)                                         |
| Newest reason replaces an older one    | One timer per guild, replacement only; stale handles still ignored             |
| `/stop`, shutdown, guild removal       | Leave/cancel immediately; guild removal also forgets that guild's search menus |

Queue-retention consequence, documented in `docs/MUSIC.md`: leaving voice resets
the persisted session, so an `alone` departure drops the queued tracks with it.
That is the existing single-session policy — no new retention rule was invented.

### 5. Documentation source links

**Root cause**: `apps/web/app/docs/[slug]/page.tsx` and `apps/bot/src/commands/help.ts`
each hard-coded `https://github.com/dcizov/discordjs-starter/blob/main/<file>`, so
a deployment linked to `main` rather than to what was running.

**Fix**: `packages/core/src/source-links.ts` builds both links. Ref priority:
`ORBIT_SOURCE_REF` (commit id preferred, branch/tag accepted, slashes preserved,
`refs/heads/` stripped) → `main`. Unset builds still work and the docs footer says
the link points at `main` because the build did not set the variable. Ref and file
path are validated; nothing is read from a request. Plumbed as a Docker build arg,
a Compose build arg, `.env.example` documentation and CI
(`--build-arg ORBIT_SOURCE_REF=$GITHUB_SHA`).

Verification: `tests/source-links.test.ts` covers fallback/commit/slash-branch/
`refs/heads/`/unsafe refs/path rejection; a full `build:web` with
`ORBIT_SOURCE_REF=$(git rev-parse HEAD)` emitted
`.../blob/fee051a…/docs/MUSIC.md` into the prerendered pages; and that URL was
fetched from GitHub, which renders `docs/MUSIC.md` at that commit (GitHub shows
its "file does not exist on default branch" banner because the commit is on a
work branch — the file content itself renders, and no request input is involved).

### 6. Provider-auth wording

**Root cause**: the `provider-login` next-step text asserted "The provider only
serves this item to a signed-in session", a universal cause the exception cannot
establish.

**Fix**: the text now reports the observed evidence (a signed-in/verified session
was requested, or this backend's client was rejected), says explicitly that this is
neither a Discord voice-permission problem nor a Lavalink connectivity problem,
and states that playback of the item stays unavailable here. The category id stays
machine-readable and unchanged; ordinary users get the ≤300-character summary
while the full exception remains in the operator-only audit detail; nothing
reuses cookies/tokens/accounts or auto-enables OAuth/`poToken`.

### Verification (this pass)

| Check                    | Result                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`         | **882 tests in 70 files pass** (baseline was 836 in 69)                                                                                                                                                 |
| `npm run typecheck`      | pass                                                                                                                                                                                                    |
| `npm run lint`           | pass                                                                                                                                                                                                    |
| `npm run format:check`   | pass                                                                                                                                                                                                    |
| `npm run build:web`      | pass, also with `ORBIT_SOURCE_REF` set (verified in the emitted pages)                                                                                                                                  |
| `npm run build:services` | pass                                                                                                                                                                                                    |
| Intermediate commits     | `4a6041b` re-checked in a clean worktree: typecheck + music suites pass                                                                                                                                 |
| CI on `af45894`          | runs **40307973994** / **40307965434**: `verify` and `containers` both **success**; browser suite **59 passed / 4 skipped** (baseline 58/4 plus the new provider-select case); screenshot step 4 passed |

**Not verified here**: live Discord login, a real Lavalink node, audible playback,
provider behaviour against SoundCloud/YouTube/Bandcamp, and any dashboard pixels
or screenshots — no browser can be installed in this sandbox
(`playwright install chromium` fails on the network) and CI artifacts are not
downloadable here. The Playwright case added for the provider select was run by CI,
not locally; a green screenshot step is still not visual review.

**Still deferred, unchanged**: the connected **member list** (no implementation
exists; needs a bot-side roster sync plus a paginated server-side read — a cache
must not be presented as the full list), SponsorBlock guild UI, LavaSearch/lyrics
surfaces, unrelated `<Switch>` labels, and any plugin upgrade.

## Pass 7 (2026-10-26): hydration diagnosis and documentation site

Two threads, kept separate: (1) reported React hydration warnings on `/login` and
the dashboard, (2) turning `/docs` into a documentation site rather than a
rendered Markdown dump.

### Hydration: diagnosed, not guessed

The reported diffs contained `--darkreader-inline-*` / `data-darkreader-inline-*`
on Lucide icons, identity images and the activity chart's `<stop>`/`fill`. Those
names do not exist in this repository: a grep over `apps/`, `packages/` and
`tests/` returns no `darkreader` string, and no application code writes one. They
are written by the **Dark Reader** extension into the live DOM, after the server
HTML has been produced, so they cannot be part of a server/client mismatch.

Evidence gathered before touching any rendering path:

- The only `suppressHydrationWarning` in the codebase is the `<html>` element,
  where `next-themes` sets the theme class before hydration. It stays that narrow.
- Client components render time from serialized server values:
  `presentation.referenceAt` feeds every `relativeTime(...)` call, the activity
  chart publishes `data-activity-reference`/`-labels`/`-values` computed on the
  server, and no component calls `Date.now()` during render. The one countdown
  (`AuthProblem`) starts from a serialized `retryAfterSeconds` prop, so its first
  client render equals the server render — but its two server callers also passed
  `retryAt={Date.now() + …}`, i.e. a clock read during the RSC render. That was
  corrected in pass 8 (below); it never caused a mismatch, because the value
  never reached the markup.
- `style="color:transparent"` on images is React's own hydration-inserted style
  for `next/image` and plain `<img>`; it appears in a clean browser too.
- Lucide, `next/image` and the chart markup are deterministic; the new e2e case
  compares the server HTML of the login mark with the hydrated DOM byte for byte.

**No app-owned hydration bug was found, so no rendering behaviour was changed to
hide one.** There is still no blanket or widened `suppressHydrationWarning`, no
console interception, no DOM script or `MutationObserver` stripping extension
attributes, no SSR opt-out and no Lucide/`next/image` rewrite.

### What did change

- `color-scheme: light` / `dark` is declared next to the existing `:root`/`.dark`
  tokens, so native widgets (scrollbars, form controls, overscroll canvas) follow
  the active theme.
- `<meta name="darkreader-lock">` is rendered once in `app/layout.tsx` and hoisted
  into `<head>` by React 19 (verified in the built HTML: exactly one occurrence,
  inside `<head>`). This is Dark Reader's own documented opt-out for a site that
  already has a theme.
- The limits are documented rather than glossed over: the meta is a request, not a
  guarantee. A user who disables "respect site settings", or an extension build
  that restyles after the page settles, still gets Dark Reader, and nothing in the
  app changes anyone's extension preference. The dashboard's own light/dark/system
  toggle remains the supported way to change appearance.
- Troubleshooting text for console noise was added to
  [dashboard UX](DASHBOARD-UX.md#hydration-warnings-in-the-browser-console).

### Verification for hydration

- New `tests/e2e/hydration.spec.ts` runs in a fresh browser context with no
  extensions: `/login` (server HTML vs hydrated icon markup), the dashboard
  overview (icons, both identity images, activity chart), light/dark/system
  (`color-scheme` computed value plus theme class), and the documentation pages.
  Every console message and page error is collected unfiltered; only hydration
  errors fail the test.
- A real Dark Reader run is **not** available: CI launches plain Chromium without
  an unpacked extension and this sandbox cannot install a browser at all. The
  extension case is documented and reproduced by evidence, not by a synthetic
  DOM mutation dressed up as an extension test.

### Documentation site (`/docs`)

- **Navigation**: grouped, collapsible (`<details>`) sidebar with
  `aria-current="page"` and a visible active rail; on phones the same navigation
  opens in the existing Radix dialog, anchored as a sheet, which closes on
  selection and returns focus to its trigger. No second menu implementation.
- **Page shell**: breadcrumb, title, one-sentence intro, audience/file metadata,
  "On this page" (single `<nav>`, right rail on wide screens, compact list above
  the body on phones), "More in {group}" chips, previous/next cards and the
  source link pinned to `ORBIT_SOURCE_REF`.
- **Index**: grouped cards with a clearly labelled **filter** — title, summary,
  group and audience of the pages on the page, never the guide bodies. It states
  its scope, shows `Showing N of M pages`, has a real empty state and a
  live-region count. No hosted search service, no client-side index of page text.
- **Code**: server-rendered `<figure>` frames with a language label, horizontal
  scroll, and a copy button that is hidden until its handler is attached, so a
  reader without JavaScript never sees a dead control. No highlighting library,
  no line numbers, no animation.
- **Anchors**: every heading keeps a stable id, carries a visible-on-hover/focus
  `#` link, and clicking it copies the absolute deep link. Middle-click, "copy
  link address" and JavaScript-off all still work, because the anchor is a real
  link.
- **Tables**: wrapped in a focusable, scrollable frame (`role="region"`,
  `tabindex="0"`) instead of pushing the whole page sideways; prose is capped at a
  comfortable measure while code and tables keep the full width.
- **Workflows**: new [development workflows](WORKFLOWS.md) router compares the
  host-Node workflow, full-stack Docker and the Dev Container with the same
  labels the README uses, then links to the guide that owns each set of steps.
  Commands are in the page and each workflow has a stable anchor; tabs were
  rejected because hiding a command behind a tab breaks deep links and printing.
- **Cross-links**: README, `DEVELOPMENT.md`, `DEVCONTAINER.md` and `DEPLOYMENT.md`
  now point at the router page; module guides keep their existing links, which the
  renderer rewrites to `/docs/<slug>#anchor`.

### Sanitization and trust model (unchanged in principle)

The content source is still repository-owned Markdown, rendered at build time by
`marked` and sanitized by `sanitize-html`. The renderer now emits two structural
elements of its own — the code frame and the table frame — plus one interactive
element: the code-block copy `<button>`. The sanitizer allows that button **only**
when it carries `data-docs-copy`; a `<button>` written in a Markdown file is
dropped (`exclusiveFilter`), and scripts, iframes, images, event handlers and
non-`https`/`mailto` URLs remain blocked. The migration cost is zero for content
authors: no MDX, no directives, no executable Markdown.

### Dependencies

**None added.** The mobile sheet reuses `ui/dialog.tsx`, the trigger and links
reuse `ui/button.tsx` variants, the filter is a labelled native input, the
collapsible groups are native `<details>`, and copy reuses `lib/clipboard.ts` plus
the existing Sonner toaster. Evaluated and rejected: `@radix-ui/react-collapsible`
(the platform already collapses), `cmdk` (a second surface for the same filter),
FlexSearch/Pagefind/Algolia (a second index or a hosted service), Shiki/Prism
(weight, a second theme system, no benefit for shell snippets), and tabs
(deeplink and printing costs). The decision is recorded in
[the documentation platform page](DOCUMENTATION.md#interface-decisions-documentation-site).

### Verification (this pass)

| Check                                                 | Result                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                                      | **887 tests in 70 files pass** (baseline 882 in 70; +5 documentation tests)                                                                                                                    |
| `npm run typecheck`                                   | pass (`next typegen` + both `tsc --noEmit` runs)                                                                                                                                               |
| `npm run lint`                                        | pass                                                                                                                                                                                           |
| `npm run format:check`                                | pass                                                                                                                                                                                           |
| `npm run build:web`                                   | pass; 25 documentation pages prerendered, `darkreader-lock` verified inside `<head>` of the emitted HTML, `color-scheme: light`/`dark` present in the emitted CSS                              |
| `npm run build:services`                              | pass                                                                                                                                                                                           |
| Served HTML (`next start`, demo)                      | `/docs` 200 with 24 grouped cards, `/docs/workflows` 200 with 1 table, 4 code frames, warning/prerequisite/note callouts and `aria-current="page"`, `/docs/not-a-page` 404                     |
| CI on `5ab9cf0` (first attempt)                       | `containers` success, `verify` **failed**: two docs overflow assertions reported 19 px                                                                                                         |
| CI on `895cc9e` (fix: header label hidden below `sm`) | runs **40319779402** / **40319785550**: `verify` and `containers` **success**; browser suite **68 passed / 5 skipped / 1 flaky**; screenshot step passed 5 cases (4 dashboard + documentation) |

| CI on `a53b39c` (this report) | runs **40322787107** (push) / **40322794843** (PR): `verify` and `containers` **success**; browser suite **69 passed / 5 skipped** on the push run and **68 passed / 5 skipped / 1 flaky** on the PR run (same music timing race); screenshot step 5 passed |

**Not verified here**: no browser exists in this sandbox (`playwright install
chromium` fails on the network, no system Chromium and no apt path), so the new
Playwright cases were executed by CI, not locally. The uploaded
`dashboard-screenshots` artifact **could not be downloaded here** (the Actions
artifact host is outside the sandbox's network allowlist), so the documentation
pages have **not** been visually reviewed as pixels — only as served HTML and
assertions. What still needs a human eye: sidebar spacing, the mobile sheet, code
frame contrast and the dark theme.

**Observed flake, unrelated to this pass**: `tests/e2e/music-actions.spec.ts:150`
(the pass-6 provider-selection case) timed out waiting for its second request in
both runs and passed on retry. It is a timing race in that test, not a music
regression; it was left unchanged rather than weakened.

**Still deferred, unchanged**: the connected **member list**, SponsorBlock guild
UI, LavaSearch/lyrics surfaces, unrelated `<Switch>` labels (8 of 13 still lack
an `aria-label`), and any plugin upgrade. Dark Reader itself cannot be exercised
here, so the extension case stays documented rather than "tested".

## Pass 8 (2026-10-26): shadcn/ui rework in slices

The instruction for this pass changed one previous decision outright: **"retain
the old table" is not the acceptance criterion.** The table experience was
replaced rather than restyled, and the rest of the work is sliced so each commit
leaves a working app.

### What landed, by slice

| Commit    | Slice                | What it does                                                                                                                                                                                                           |
| --------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `242bb5f` | Primitives + selects | `select`, `popover`, `command`, `combobox`, `checkbox`, `label`, `alert-dialog`, `tooltip`, `table`, `field-context`; `FormSelect`/`NativeSelect`; **28 native `<select>` sites** migrated (combobox where searchable) |
| `a55813f` | Tables               | `DataTable` on TanStack v9 manual mode: server paging/sort/filter kept, typed columns, `aria-sort`, debounced search with reset, column visibility, pagination + page size, row actions; 4 consumers converted         |
| `bdefbc5` | Browser tests        | Context-driven `chooseOption` for a Radix listbox, 13 `selectOption` sites rewritten, new `accessibility.spec.ts` (unnamed controls, type-ahead, `aria-sort`, axe at WCAG 2.2 AA over 9 routes in light and dark)      |
| `1aaf01b` | Header + mobile nav  | ⌘K command menu (pages only, honest empty state), theme radio group, mobile sidebar as a real dialog sheet with focus trap/Escape/restore                                                                              |
| `0f9575d` | Docs trust boundary  | The copy control is now built **after** sanitization (`enhanceCodeBlocks`); the sanitizer keeps no interactive tag at all, so `data-docs-copy` is no longer a provenance claim                                         |
| `131beb4` | Lavalink diagnostics | Refused/DNS/timeout/auth/TLS/closed classification from the error's own `code`/`status`/`cause`/aggregate members; empty-message aggregate explained; hint only when evidenced; repeat counter                         |
| `f3d8000` | Docs structure       | Eight navigation groups, group descriptions, a `Troubleshooting` router page, GitHub-identical heading ids, and links that resolve (see below)                                                                         |

### Defects found and fixed at the source

- **Empty Lavalink error.** Shoukaku forwards the WebSocket client error, and a
  refused dual-stack connect is an `AggregateError` with an empty message. The
  old handler logged `errorDiagnostic(error)` (nothing useful) and stored the
  fixed string "Lavalink connection error" as health detail. Now the name,
  message, `code`, HTTP status, causes and aggregate members are read, redacted
  with the existing `diagnosticText`, and classified; only an evidenced category
  gets advice.
- **Docs links that only worked by accident.** `docs/WORKFLOWS.md` linked
  `README.md` from inside `docs/` (a 404 on GitHub) and reached the in-app page
  only because the rewriter matched bare basenames. Heading ids also differed
  from GitHub (`can't` → `can-t`, `redirect_uri` → `redirect-uri`), so a link
  written for GitHub broke in the dashboard. Ids now follow GitHub's algorithm
  and relative paths are resolved against the current file.
- **Uncurated Markdown in links.** A link to a repository note that is
  deliberately not a docs page used to stay a relative `.md` href and 404 in the
  app. It now points at the file's source at the configured ref.
- **The music-actions flake.** `volume moves locally…` pressed three arrow keys
  and expected exactly one POST; on a slow runner the first press committed
  before the third arrived, which is the debounce working, not a bug. The test
  now presses once and leaves the control (blur flushes the pending change),
  asserts the single request and its value, and asserts the live region settles
  — no sleeps, no retries, no weaker assertions.
- **The "8 unlabelled switches" backlog entry is stale.** All 13 `<Switch>`
  sites carry an `aria-label`; the remaining gap is that most rely on that
  attribute instead of a `<label for>` association with the visible text.

### Verification (this pass)

| Check                            | Result                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                 | **897 tests in 71 files pass** (baseline 887 / 70; +7 connection diagnostics, +2 docs, +1 rewritten)                                                                                              |
| `npm run typecheck`              | pass (`next typegen` + both `tsc --noEmit` runs)                                                                                                                                                  |
| `npm run lint`                   | pass, no warnings                                                                                                                                                                                 |
| `npm run format:check`           | pass                                                                                                                                                                                              |
| `npm run build:web`              | pass (5.4 s); 25 documentation pages prerendered                                                                                                                                                  |
| `npm run build:services`         | pass                                                                                                                                                                                              |
| Served HTML (demo, `next start`) | `/docs` 200 with **8 groups** and their descriptions; `/docs/troubleshooting` 200 with in-app anchors; `/docs/music` 200 with 12 copy controls and no relative `.md` href; `/docs/not-a-page` 404 |

**Not verified here**: no browser exists in this sandbox, so the Playwright
suites (including the rewritten volume test and `accessibility.spec.ts`) run in
CI only. The screenshots artifact still cannot be downloaded here, so **no
pixels were reviewed** in this pass either. Dark Reader itself still cannot be
exercised — the hydration section remains a documented diagnosis, not a test.

### Still deferred (unchanged)

The real server-member list, SponsorBlock guild UI, LavaSearch/lyrics, `<label
for>` associations on the switches, and the mobile-overflow slug list. No PR was
opened; work stays on `arena/99c6cf65-discordjs-starter`.

## Pass 8 (2026-10-26): fixing what the new checks found

### App-owned clock read removed (`AuthProblem`)

Pass 7 said "no component reads `Date.now()` while rendering". That was true of
every client component but not of the two server pages that render
`AuthProblem`: both passed `retryAt={Date.now() + (retryAfterSeconds ?? 0) *
1000}`. It never produced a hydration mismatch — `retryAt` is a prop and never
reaches the markup, and the first client render used the serialized
`retryAfterSeconds` — but it was still the wrong place for the value:

- the deadline belonged to the instant the **response was produced**, so any
  reused HTML (back/forward restore, a prefetched or cached response) started
  its countdown already short, and
- it put a clock read inside the RSC render, which is exactly what the rest of
  the dashboard avoids by serializing `presentation.referenceAt`.

`AuthProblem` now takes only `retryAfterSeconds`. The first paint still renders
the server's number, so hydration is byte-identical; the deadline is resolved
once in a client effect (`useRef` guard) and the interval counts down from
there. There is no `suppressHydrationWarning`, no mounted-only rendering and no
change to what a user sees: the button still says "Try again in Ns" and then
"Try again".

The hydration claim is therefore now literally true for both surfaces, and the
two guides that stated it (this file and
[dashboard UX](DASHBOARD-UX.md#hydration-warnings-in-the-browser-console)) say
what is actually serialized versus resolved on the client.

### What the first axe run found (and what was wrong with the tests)

The new accessibility suite found real defects rather than test noise:

- seven focusable chart points carried `aria-label` on an SVG `<circle>` with no
  role (`aria-prohibited-attr`); they now carry `role="img"` and their value is
  announced;
- the paused-module cards dimmed to 70 % opacity, which put their own status
  text at 3.55:1 in dark mode and encoded state with transparency alone; they
  keep full contrast and use a dashed border instead;
- 19 hand-picked hex accents (used for 9–11 px text) were below 4.5:1 in one or
  both themes and were replaced by the status tone tokens (violet / amber /
  emerald / rose at `-700` light and `-300` dark);
- two opacity modifiers on `muted-foreground` (`/85` on the module cards, `/75`
  in the dashboard footer) rendered 9–10 px text at 3.85:1 and 4.05:1. The
  undimmed token measures 5.27:1 on white and 6.31:1 on the dark canvas, so the
  dimming was the whole defect; `/40` and `/50` survive only on `aria-hidden`
  decoration and disabled text.

Four test-side assumptions were wrong for the same reason — they described
native selects, or looked for a portalled popup inside a dialog, or assumed
Radix tracks `aria-activedescendant`, or assumed the trigger keeps focus during
type-ahead. The helpers and specs were corrected; no assertion was relaxed, no
retry added and no primitive changed to satisfy a test.

### The `music-actions` flake had a cause, not just a probability

`the play form sends the chosen provider and the server default otherwise`
failed intermittently at CI in two different places (`:150` before, `:199`
now), with the same signature: the first `POST /music` arrived, the second never
did. No sleep or retry was added; the race was traced instead.

`MusicPage.action()` clears the request field **after** awaiting the snapshot
refresh (`setQuery("")` sat after `await refresh()`). The test's
`expect.poll(() => bodies.length).toBe(1)` succeeds as soon as the POST is
recorded, i.e. several hundred milliseconds before that refresh finishes. If the
test then filled "A second request", the pending `setQuery("")` wiped it, the
`required` request input was empty when the button was clicked, and the browser
blocked submission with its own constraint validation — so no second request
existed at all, and `expect.poll(…).toBe(2)` timed out. Which of the two steps
lost the race depended only on how long the refresh took, which is why the same
commit both passed (74 passed) and failed (1 failed) in two CI runs.

Two changes, no test accommodation:

- **App**: the field is cleared as soon as the bot has accepted the request,
  before the refresh. This is the correct order regardless of tests — clearing
  after the refresh empties a field someone may have already typed into again,
  silently discarding that request. A failed request still keeps the text, so it
  can be retried, which the existing "stays pending until the consumer actually
  completes it" case still asserts.
- **Test**: it waits for the app's own signal (`toHaveValue("")`) before typing
  the next request. That is an assertion about the product, not a delay.

### What the next two runs found

- **A rate limit left the trigger early.** Covered above (`AuthProblem`).
- **Scrollable code blocks had no focus stop** (`scrollable-region-focusable`,
  `/docs/workflows`). A fenced block scrolls sideways, so a keyboard user could
  not reach the end of a long command. Every `<pre>` the renderer frames now
  carries `tabindex="0"` and a focus-visible ring; the table frame already
  worked this way. `docs-content.test.ts` asserts it.
- **Inline code inside a link was 4.4:1.** `--primary` at 60 % lightness is
  4.4:1 on the `--muted` surface — under AA for 11 px text by a tenth. It is
  58 % now: 4.85:1 on muted, 5.37:1 on white, and white-on-primary buttons
  improve to 5.37:1. The hue is unchanged, so the brand still reads the same.
- **The news-source test described a surface that does not exist.** News sources
  render as cards with a per-card "Actions for …" menu; only the moderation
  rules tab is a table. The spec asserted `row`, so no locator could ever
  match. It now asserts the card heading and uses the same per-card menu the
  rest of that spec already used.

### Verification (pass 8)

| Check                          | Result                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npx vitest run`               | **897 tests in 71 files pass** (unchanged count; three assertions added, none removed)                 |
| `npm run typecheck`            | pass (`next typegen` + both `tsc --noEmit` runs)                                                       |
| `npm run lint`                 | pass, no warnings                                                                                      |
| `npm run format:check`         | pass                                                                                                   |
| `npm run build:web`            | pass (14.7 s), 25 documentation pages prerendered                                                      |
| `npm run build:services`       | pass                                                                                                   |
| CI on `c338d10` (`verify`)     | **success — 75 passed, 5 skipped, 0 failed, 0 flaky, 1.9 min**                                         |
| CI on `c338d10` (`containers`) | success                                                                                                |
| Earlier runs                   | `34332e8` 7 failed, `56e9d73` 3 failed, `82acef2` 3 failed, `6569cd0` 1 failed — each one step forward |

The axe suite now passes in **both** themes across `/login`, overview, channels,
audit, settings, music, `/docs` and `/docs/workflows`, including the keyboard
behaviour of the migrated select and combobox.

**Not verified here:** no browser exists in this sandbox (no Playwright browser
download is reachable, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is unset), so
the browser suites and the axe scans were executed by CI only. The screenshot
artifact is still not downloadable from here, so **no pixels were reviewed** in
this pass: a green screenshot step is not a visual review. Dark Reader itself is
still untestable here, so the extension half of the hydration story remains a
documented diagnosis rather than an experiment.

### Still deferred after pass 8

The real server-member list, the SponsorBlock guild UI, LavaSearch/lyrics,
`<label for>` associations on the remaining switches (they have `aria-label`,
which names them but does not associate the visible text), and the
mobile-overflow slug list. No PR was opened; everything stays on
`arena/99c6cf65-discordjs-starter`.

### Destructive confirmations became alert dialogs

`ui/alert-dialog.tsx` was added with the other primitives but nothing used it, so
both delete flows still went through a plain `Dialog` — which is dismissible by
clicking the backdrop and puts initial focus on whichever control comes first.
That is the wrong semantics for an irreversible action. `ConfirmDialog` (the
single component behind "delete a shop item" and "delete a configuration") now
renders an alert dialog: `role="alertdialog"`, initial focus on **keep**,
backdrop clicks do nothing, and Escape is handled explicitly so it follows the
same rule as every other dismissal route — ignored while the request is in
flight, a normal close otherwise. The busy guard, the spinner, the disabled
destructive button and the caller-owned error handling are unchanged, and no
second dialog implementation was introduced.

## Pass 9 (2026-10-27): identity consistency and the real table experience

The brief was blunt, and it was right: `npm ci` fixed the install, not the
implementation. TanStack Table being in `package.json` proves nothing about what
a reader sees. This pass rebuilt the visible composition of the leaderboard and
the history screens, and traced every identity surface from the Discord payload
to the pixel.

### What actually changed

- **Identity had five different causes, not one.** The audit table was built
  from `/api/guilds/:id/history`, which never selected or projected
  `actorAvatar`, so a recorded hash could not reach the browser at all. The
  economy `accounts` row had no avatar column, so the leaderboard, ledger, music
  queue and member picker had nothing to show. Transfers stored a counterparty
  id with no name or picture. All three are now recorded and projected with one
  server-side helper (`withAccountAvatar` / `withAuditAvatarUrl`,
  `apps/web/lib/dashboard.ts`); no per-row Discord request, no extra scope, and
  historical audit rows are never refreshed with a current profile.
- **One identity layer.** `components/identity/{actor-avatar,identity-cell}.tsx`
  is used by the leaderboard, ledger, audit rows and detail dialog, moderation
  cases, the music queue, the member picker and the account menu. A row with a
  valid URL always renders the picture; initials only appear when that row has
  nothing usable, and the row says so ("no avatar captured" / "no avatar
  recorded"). A system actor gets the Orbit glyph rather than a 404.
- **The table is the shared one, and it is composed.** Search, faceted filters
  with honest counts, reset, column visibility, `aria-sort` headers, page size,
  first/previous/next/last and one range sentence. TanStack owns sorting and
  paging for complete client lists and runs in manual mode for server-owned
  history, so a page of seven rows is never re-sorted in the browser and called
  "sorted by date".
- **Dead machinery removed.** The unused `selection` prop, the `__select` column
  and the `SelectCheckbox` helper were deleted: no dataset has a safe multi-row
  operation, so there is no checkbox to click that does nothing. `getRowId` now
  keys rows by their own id.
- **One region name per list** ("Automod rules", not "automod rule records").

### Verification (pass 9, branch `arena/99c6cf65-discordjs-starter`)

| Check                                   | Result                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                        | **909 tests in 72 files pass**                                                                                                                                                                     |
| `npx tsc --noEmit` (root, `apps/web`)   | pass                                                                                                                                                                                               |
| `npx eslint apps packages tests`        | pass                                                                                                                                                                                               |
| `npm run format:check`                  | pass                                                                                                                                                                                               |
| `npm run build:web`                     | pass, 25 documentation pages prerendered                                                                                                                                                           |
| CI `verify` + `containers` on `e0b8865` | **success on both the push run and the PR run** — `81 passed, 5 skipped`, ~2 min                                                                                                                   |
| Earlier CI in this pass                 | `3b983ea` 7 failed → `a79b2ab` 4 → `2418404` 2 → `dddf4b6` 1 → `9846539` 1 → `c68bcef` 1 (one shard only) → `76c1e9b` green → `1b4907c`/`6e8e079` 1 (the new failure-state test) → `e0b8865` green |

Each failing browser run was read through the Checks API annotations (the log
and artifact downloads are not reachable from this sandbox) and fixed at the
cause: a facet addressed by a role the command list does not expose, cells read
while a server response was replacing them, an audit expectation that depended
on which row happened to be on page 1 of a database other specs write to, a
stubbed history endpoint that ignored the `query` parameter, and an automod test
that collided with the row its own failed attempt left behind on retry. Adding
that last browser test then found a real defect rather than a test defect: a
history request that failed before any row arrived rendered the loading skeleton
forever, with no message and no retry. `history-table` now shows the shared error
state and retry in that case. No
assertion was weakened, no sleep or retry was added to hide a race.

### What was not verified

**No pixels were reviewed.** There is no browser in this sandbox
(`npx playwright install chromium` fails, no display), the CI screenshot artifact
cannot be downloaded here, and the screenshots in the brief could only inform the
target composition. Every "verified" above means an assertion passed. The mobile
check is a 390 px viewport assertion that the page does not scroll sideways and
that the facet and the sortable header still work — not an eyeball review of
spacing or colour in either theme.

Deliberately not built: row selection and bulk actions, drag-and-drop ordering,
task-specific columns from the shadcn tasks example, and the dashboard block's
chart/drawer scaffolding (a different primitive family). The mapping table lives
in `docs/DASHBOARD-WORKFLOWS.md`.

### Still deferred after pass 9

The real member list, the SponsorBlock guild UI, LavaSearch/lyrics, `<label for>`
associations on the remaining switches, and the mobile-overflow slug list. The
music queue rows and the overview selectors now share the identity cell, but the
queue itself is still a list rather than the table foundation — a deliberate
choice (five controls per row, not five columns), not an oversight. No PR was
opened; everything stays on `arena/99c6cf65-discordjs-starter`.

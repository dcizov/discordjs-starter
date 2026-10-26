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

Start `9c1c98c` → end `7d33b70` (all on `arena/99c6cf65-discordjs-starter`,
pushed, no PR operations). Previous reports were treated as historical: the state
was re-read (`git status`, `git log`, `git ls-remote`, `docs/`) before any edit.

Commits: `5035f30` (dependency provisioning), `4c439ae` (shared tab bar, confirm
dialog, checkbox, news caption, copy), `5502068` (domain boundary comments),
`3c8c2ca` (screenshot evidence + table decision), `08cba2b` (e2e tab roles),
`7d33b70` (screenshot output path).

### Completion matrix (five-way, not aspirational)

| Area                                                        | Status                                          | Evidence / what is missing                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency provisioning (detection _and_ refresh)           | **Implemented**                                 | Reproduced the stale-volume case and the documented refresh in a mount namespace; guard rewritten around the verified path (`5035f30`). See the table below.                                                                                                                                  |
| Dependency guard scope                                      | **Implemented**                                 | 10 production imports only, ~50 ms, no installs, no package-manager duplication, `pretest` hook dropped.                                                                                                                                                                                      |
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

| Check                                             | Result                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                                  | **772 tests in 65 files pass** (was 771; +1 guard/documentation test)                                                                                                                                                                  |
| `npm run typecheck`                               | pass                                                                                                                                                                                                                                   |
| `npx eslint apps packages tests`                  | pass                                                                                                                                                                                                                                   |
| `npm run format:check`                            | pass                                                                                                                                                                                                                                   |
| `npm run build:web`                               | pass                                                                                                                                                                                                                                   |
| Demo server (`DEMO_MODE=true`, port 3100)         | `/overview`, `/economy`, `/music`, `/news`, `/roles`, `/moderation`, `/deals`, `/settings`, `/audit`, `/channels`, `/commands` → 200; `/channels`, `/economy`, `/news` render `role="tablist"` with exactly one `aria-selected="true"` |
| Stale-volume reproduction                         | guard fails + `Module not found: marked`; then in-place `npm ci` → 628 packages, guard passes, build compiles                                                                                                                          |
| CI `verify` (run `40251261615`, commit `7d33b70`) | **success** — lint, typecheck, vitest on PostgreSQL 17, `npm audit --omit=dev`, build, screenshots step (4 tests), browser suite **57 passed / 4 skipped**, artifact uploaded                                                          |
| CI `containers` (same run)                        | success — Compose validation, both image targets, unprivileged dev-image smoke test, pinned Lavalink build and headless backend check                                                                                                  |

Not run, and not claimed: live Discord, real Lavalink audio, a real
Postgres/Redis deployment, and any review of the screenshot pixels.

### Still deferred

Unchanged from pass 3 (status inventory, facet counts, share action, bulk
actions with defined page-vs-filtered semantics, oRPC), plus the items the matrix
marks partially implemented: card/section header normalisation, the remaining long
copy in `permission-setup.tsx` / `install-prompt.tsx` / `login`, and comment
coverage for bootstrap, music lifecycle and dashboard shared infra.

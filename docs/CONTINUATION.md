# Continuation report

Date: 2026-10-25 · Branch `arena/99c6cf65-discordjs-starter` · Recovered HEAD
`eeb0e68a533d653daa14015465b6e6760e41c49d` (identical to the tip of
`origin/arena/e2b42b08-discordjs-starter`, 57 commits ahead of `origin/main`;
clean worktree, no stashes, no local-only or remote-only commits).

Fetched (`git fetch --depth=50 origin 'refs/heads/*:refs/remotes/origin/*'`)
without merging, rebasing or resetting. `origin/main` is an ancestor of this
branch, so nothing from the interrupted session was lost or needed to be
recovered from a new workspace.

## Recovered status matrix

| Area                                     | State before this session                                                                                   | Evidence                                                                                     | Now                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Monorepo structure / Turborepo           | npm workspaces (`apps/*`, `packages/*`), tsup for services, one Next app                                    | `package.json`, `tsup.config.ts`, `.github/workflows/ci.yml`, `docs/STRUCTURE-REFACTOR.md`   | Researched and **retained unchanged** (see decision record)                                                      |
| News formatting, images, excerpts, links | Broken: one-tag-stripping normalizer, no BBCode handling, no images, no attribution, preview ≠ delivery     | `packages/core/src/feeds.ts`, `safety.ts`, screenshot 1                                      | **Implemented and freshly verified** (`docs/NEWS-FORMATTING.md`)                                                 |
| Audit / activity identity images         | Initials only, no avatar data recorded                                                                      | `overview.tsx`, `server-pages.tsx`, screenshot 2                                             | **Implemented** (recorded avatar hashes + migration); unit-verified, browser-unverified                          |
| Music state, channel, progress, volume   | Pause-styled control while empty; snapshot-only position; volume committed per event and snapped back       | `music-page.tsx`, screenshot 3                                                               | **Implemented** (`docs/DASHBOARD-UX.md`); unit-verified, browser-unverified                                      |
| First-visit dashboard tour               | None                                                                                                        | no tour code, no storage policy                                                              | **Implemented + verified** (`tour-model.ts`, dialog, `tests/tour.test.ts`, `tests/e2e/tour.spec.ts` green in CI) |
| Overview banner animation                | Animation on the filtered `<img>` itself                                                                    | `overview.tsx`, `globals.css`                                                                | **Implemented** compositor-only wrapper + reduced-motion/mobile opt-out; no frame-time measurement possible      |
| Ticket system                            | Not implemented (documented as high privacy burden in `FEATURE-RESEARCH.md`)                                | no tickets table/command/dashboard                                                           | **Deferred** — see below                                                                                         |
| Operational / server health              | Honest separation of container liveness, saved config, backend readiness and delivery health already exists | `apps/bot/src/features/music/diagnostics.ts`, `service_health`, dashboard `ConnectionStatus` | **Unchanged this session**; extension deferred                                                                   |

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
  "Read more"/notices; Steam "Official announcements only" switch.
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

## Checks actually run (this branch, this session)

| Check                          | Command                                          | Result                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh baseline before changes  | `npm ci` + `npm test`                            | 627 tests / 52 files passed (31.45 s)                                                                                                                            |
| Unit/integration after changes | `npm test`                                       | **655 tests / 55 files passed** (28.7 s) — includes 17 news, 5 music-progress, 5 tour tests and extended identity/image suites                                   |
| Types                          | `npm run typecheck` (`next typegen` + two `tsc`) | passed                                                                                                                                                           |
| Lint                           | `npm run lint`                                   | passed (0 warnings)                                                                                                                                              |
| Formatting                     | `npm run format` / `prettier --check`            | applied; clean                                                                                                                                                   |
| Production build               | `npm run build`                                  | passed (Next + 6 tsup bundles)                                                                                                                                   |
| Demo API smoke                 | `curl` against `npm start` with `DEMO_MODE=true` | `/api/guilds/:id` returns `actorAvatarUrl`; test-flight returns normalized cards/notices                                                                         |
| SSR smoke                      | `curl` `/dashboard/:id/overview`                 | 200, hero wrapper present, tour dialog absent from SSR (client-only, as intended)                                                                                |
| Schema generation              | `npx drizzle-kit generate`                       | `0003_audit_actor_avatar.sql` = a single `ADD COLUMN` (a first attempt with a corrupted schema file produced `DROP TABLE`s and was reverted before anything ran) |

| Browser suites (CI) | `npm run test:e2e` on the pushed branch | **51 passed** (1.2 min), verify job green |

Not executed in the authoring sandbox, and why:

- **Browser/Playwright suites run in CI, not locally.** No Chromium binary is
  available in the authoring sandbox (`npx playwright install chromium` cannot
  download there), so the specs were executed by CI on push instead: the
  `verify` job ran `npx playwright install --with-deps chromium` and
  `npm run test:e2e` with **51 passing tests**, covering the first-visit tour,
  the honest transport state, snapshot progress and volume commit. That run
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

## Known gaps / next concrete steps

1. Run `npm run test:e2e` in CI (or a machine with Chromium) and fix any selector
   drift in `tests/e2e/tour.spec.ts` and `tests/e2e/music-actions.spec.ts`.
2. Visual check of the news test-flight dialog and of the hero animation on a
   low-powered device; remove `will-change` if the measurement shows no benefit.
3. Ticket vertical slice (deferred): needs a `tickets` table, panel resource,
   overwrite model validated before any content is exposed, per-member open
   limits, claim/close interactions, restart/deleted-channel reconciliation,
   dashboard configuration and list, audit events, and an explicit
   no-transcripts-by-default retention policy. Design review required before
   implementation; do not promise privacy from administrators.
4. Health extension (deferred): add measured bot heartbeat/gateway state, queue
   depth and feed freshness to the existing health view, keeping liveness,
   readiness, saved configuration and confirmed execution separate. Do not
   invent a score.
5. Community audit rows still store the actor's snowflake as the display name
   (`packages/db/src/community.ts`); fixing it means passing an actor name/avatar
   through `change()`, which is a separate, reviewable change.
6. Consider Open Graph images for RSS only after an SSRF-reviewed fetcher with
   timeouts, size/content-type limits, cache and failure isolation.

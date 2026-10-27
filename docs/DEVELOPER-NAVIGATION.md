# Developer navigation

Where things live, and which file to open first. Architecture and security
rationale live in `ARCHITECTURE.md` and `SECURITY.md`; this page is a map.

## Runtime processes

| Process   | Entry point                                                                                                                | Owns                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Web       | `apps/web/app/layout.tsx`, `app/page.tsx`, `app/dashboard/[guildId]/[[...section]]/page.tsx`, `app/api/[...path]/route.ts` | Dashboard UI, OAuth session, the single JSON API, in-app docs |
| Bot       | `apps/bot/src/index.ts` → `bootstrap.ts`                                                                                   | Gateway connection, slash commands, buttons/selects, voice    |
| Worker    | `apps/worker/src/index.ts`                                                                                                 | Queue consumers: feed polling, deliveries, Discord actions    |
| CLI tools | `apps/bot/src/tools/*`, `apps/bot/src/commands/register.ts`, `packages/db/src/migrate.ts`                                  | Command registration, exports, music diagnostics, migrations  |

The web process **never** handles Discord gateway events, and the bot/worker never
call the web API — they share `packages/core` and `packages/db` in process.

## Shared domain code (`packages/core/src`)

| File                                                                                         | Responsibility                                                                                              |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `types.ts`                                                                                   | Config, resource, feed, music and economy types shared by all runtimes                                      |
| `config.ts`, `module-setup.ts`                                                               | Guild config shape/validation and the per-module readiness summary                                          |
| `permissions.ts`, `discord-permissions.ts`                                                   | Who may do what: role hierarchy, protected targets, feature permission bits                                 |
| `feeds.ts`, `feed-content.ts`, `feed-routing.ts`, `news-presentation.ts`, `steam-artwork.ts` | Provider polling, HTML/BBCode normalization, routing rules, card/embed presentation, Steam artwork fallback |
| `itad.ts`, `deals.ts`, `deal-policy.ts`, `deal-presentation.ts`                              | IsThereAnyDeal transport, deal selection, eligibility rules, embed copy                                     |
| `community.ts`, `automod.ts`, `activity.ts`                                                  | Polls, announcements, moderation records and activity counters                                              |
| `music-policy.ts`, `music-progress.ts`                                                       | Queue admission rules and the playback-position model                                                       |
| `queue.ts`, `bot-actions.ts`                                                                 | BullMQ queue names/jobs and the web→bot action contract                                                     |
| `integration-http.ts`, `source-health.ts`, `diagnostics.ts`                                  | Provider HTTP primitives, per-source health, redacted diagnostics                                           |
| `history-query.ts`                                                                           | One contract for the dashboard history query string                                                         |
| `environment.ts`                                                                             | Environment validation, demo/live separation, invite URL                                                    |
| `command-catalog*.ts`, `commands.ts`                                                         | Registered command definitions and their module mapping                                                     |

`packages/db/src` owns persistence: `schema.ts` (tables), `history.ts` +
`history-sort.ts` (paginated history), `economy.ts` (atomic transactions),
`community.ts`, `store.ts` (config/resources/audit), `demo*.ts` (in-memory demo
store), `outbox.ts` (publication claims), `migrate.ts` (migrations).

## Bot

- `commands/` — one file per module (`music.ts`, `moderation.ts`, `roles.ts`,
  `economy.ts`, `community.ts`, `news.ts`), plus `dispatch.ts` (a fixed switch;
  no dynamic discovery) and `registration.ts` (what is sent to Discord).
- `interactions/` — `dispatch.ts` routes buttons/selects/modals, `replies.ts`
  standardizes errors, `autocomplete.ts` and `music-search.ts` handle
  `/search` selections.
- `events/gateway.ts` — `InteractionCreate`, `MessageCreate` (automod),
  reaction add/remove (starboard-style panels), `GuildCreate` sync.
- `features/` — `music/` (`backend.ts` Lavalink connection, `service.ts` queue
  and playback, `voice.ts` join/leave checks, `search-session.ts` bounded
  single-use search results), `moderation/`, `roles/`, `community/`, `deals/`.
- `infrastructure/` — `action-consumer.ts` (queue jobs that must go through the
  bot's gateway session), `guild-sync.ts`, `maintenance.ts`.

## Worker jobs

`community-jobs`: `poll` (fetch a source and reserve deliveries) and `deliver`
(send a reserved delivery to Discord). `discord-actions`: bot-side actions
requested by the dashboard. Retry/backoff and rate limiting are configured where
the workers are created (`apps/worker/src/index.ts`).

## Dashboard (`apps/web`)

- `app/api/[...path]/route.ts` — the only API. Path → handler dispatch, zod
  validation, `authorize()` once per request, origin/CSRF and rate limits.
- `lib/auth.ts` (session + authorization), `lib/dashboard.ts` (the payload every
  screen renders), `lib/docs.ts` (build-time documentation), `lib/news-feed.ts`
  (news feed view model).
- `components/dashboard.tsx` — shell and section routing; `components/workspace.tsx`
  — data/actions context; `components/resources-page.tsx`, `server-pages.tsx`,
  `music-page.tsx`, `economy-page.tsx`, `commands-page.tsx` — the screens;
  `components/data-table.tsx` — the shared table foundation;
  `components/features/*` — per-feature pieces (music controls, overview toolkit,
  community editors); `components/ui/*` — Radix-based primitives.
- Sections are the ids in `components/layout/navigation.ts` (`overview`, `roles`,
  `moderation`, `economy`, `music`, `deals`, `news`, `polls`, `announcements`,
  `channels`, `commands`, `audit`, `settings`).

## Documentation

Repository Markdown is the source of truth. `apps/web/lib/docs.ts` lists the
curated pages (order, group, audience) and renders them at build time; adding a
guide is "write the file, add one manifest line". See `DOCUMENTATION.md`.

## Tests

| Area                 | Files                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain logic         | `deals.test.ts`, `music-progress.test.ts`, `permissions.test.ts`, `feed-security.test.ts`, `news-content.test.ts`, `steam-news.test.ts`, `steam-artwork.test.ts`             |
| Persistence          | `database.test.ts` (PGlite runs real PostgreSQL in WASM), `history-query.test.ts`                                                                                            |
| HTTP/API             | `authorization.test.ts`, `music-api.test.ts`, `steam-route.test.ts`, `profile-api.test.ts`, `dashboard-actions.test.ts`, `integration-http.test.ts`                          |
| Bot                  | `bot-lifecycle.test.ts`, `bot-maintenance.test.ts`, `music-service.test.ts`, `music-search.test.ts`, `interactions.test.ts`, `gateway-events.test.ts`, `role-safety.test.ts` |
| Worker               | `community-worker.test.ts`, `deal-outbox.test.ts`, `source-freshness.test.ts`                                                                                                |
| Dashboard components | `news-feed-model.test.ts`, `docs-content.test.ts`, `activity.test.ts`, `theme-contrast.test.ts`                                                                              |
| Browser              | `tests/e2e/*.spec.ts` (Playwright, CI only — this sandbox cannot install a browser)                                                                                          |

Commands: `npm test` (vitest), `npm run test:e2e`, `npm run typecheck`,
`npm run lint`, `npm run format:check`, `npm run build`.

# Community tools — implementation and verification

Date: **25 October 2026**. Branch: **`arena/e2b42b08-discordjs-starter`**. Starting/fetched revision: **`0e77b456862207bb670e76d4aa7913f24e19470b`**, not the older implementation-review baseline. This report travels with the implementation commit; the ending commit SHA and exact remote check result are provided in the final handover and Git history. No other branch is used.

## Delivered, not backlog

| Priority | Slice                                            | Working workflow                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | **Native Discord polls** — new, off by default   | Validated manager drafts; explicit destination/content review and publish; Discord-native voting; aggregate-only refresh; early close; durable stored revisions; private manager commands; permission/readiness guidance; labeled no-I/O simulation. |
| P1       | **One-time announcements** — new, off by default | Previewed drafts; publish now or UTC scheduling with server-zone display; durable reconciliation; cancellation while paused; current-approver validation; missed-window expiry; no catch-up replay; safe ambiguous-send recovery.                    |
| P2       | Own economy history                              | Trusted user/guild SQL filtering; private `/transactions`, including while paused; useful SSR own-ledger table/pagination; explicit reward/cooldown policy. Existing manager-wide history is preserved.                                              |
| P2       | Music requester fairness                         | Optional upcoming-track cap, default unlimited; complete-playlist rejection inside the existing lock before mutation/join; no voice lifecycle/provider replacement.                                                                                  |
| P2       | News routing dry run                             | Actual shared outbox matcher, bounded saved source/routes/sample, destination deduplication and explanations; no fetch/send/queue/persistence; stale results cleared after input edits.                                                              |

[Full prioritized matrix and primary-source research](FEATURE-RESEARCH.md) include value, existing support, selected acceptance criteria, risk, permissions/intents and explicit backlog. Sources inspected include [Dyno modules](https://docs.dyno.gg/en/modules), [Dyno Auto Message](https://docs.dyno.gg/en/modules/automessage), [MEE6 Polls](https://wiki.mee6.xyz/en/plugins/polls), [MEE6 plans](https://help.mee6.xyz/en/articles/710936-mee6-free-vs-premium-plans-comparison), [Carl-bot](https://docs.carl.gg/#/) and [sesh](https://sesh.fyi/manual/). These establish recurring offerings, **not measured popularity or representative demand**. Priorities are an Orbit usefulness assessment; no vendor code/branding was copied.

## Compatibility and additive changes

- Runtime dependencies are unchanged: installed **Discord.js 14.27.0**, **@discordjs/rest 2.6.3**, **Next 16.4.3 / React 19.3.1**, **Drizzle 0.45.4**, **BullMQ 5.81.5**, **Shoukaku 4.3.0**, **Zod 4.6.7**. Verified on Node **22.22.3**, npm **10.9.8**; the project's existing Node >=22.14 requirement remains unchanged.
- [Discord.js 14.27.0 API](https://discord.js.org/docs/packages/discord.js/14.27.0), [legacy guide](https://discordjs.guide/legacy), [Discord poll specification](https://docs.discord.com/developers/resources/poll), installed types/source and [Next documentation](https://nextjs.org/docs) govern implementation. The research records the docs-root Node-engine mismatch and resolves it against the installed version's manifest; no speculative Node-major/runtime upgrade.
- Only new dependency: development-only `@axe-core/playwright` for actual scoped accessibility checks. No new ORM, framework, auth/config store or scheduler.
- Additive **`drizzle/0002_community_posts.sql`**, matching Drizzle journal/snapshot: 18-column table, four community indexes, guild foreign key/cascade and an own-ledger index. Legacy missing feature keys default false; requester cap defaults zero. Fresh `db:generate` reports **no schema changes**. No data reset, credential rotation or volume deletion.
- The existing bot/web/worker/core/db/Lavalink boundaries, idle editor, pinned plugin/source ownership, large artwork/no-ID deals, real ITAD pricing/affiliates and deterministic activity/calendar behavior are preserved. No broader install mask, privileged intent or Move Members permission.

## Safety and operational boundaries

Current guild ownership, member roles, actor/channel access and bot permissions are re-fetched before native execution; a cached former-owner permission is not trusted. Supported ordinary text-channel metadata is shared between create/edit, readiness and editor selection; unknown live types are not green. Every web action uses the existing server/session/guild/origin/rate/no-store boundary. The bot rechecks module/install/revision/state at the short atomic claim, commits before REST and never holds a transaction over Discord.

Manual requests expire after 30 seconds, including after preflight/inside the claim. Creation/action intent keys, stable scheduled revision IDs, one queue attempt, zero REST 5xx retries, explicit rejection of hidden SDK rate-limit requeueing, nonce enforcement, bounded maintenance and non-replayable unconfirmed states protect against duplicates/restarts/races. This is **not** an exactly-once distributed-delivery promise. Pausing or cancelling cannot recall an already in-flight Discord request.

The default invite stays **19456**. Poll publication additionally needs deliberate destination **Send Polls**; poll refresh/close need View Channel + Read Message History; announcement publication needs View/Send/Embed Links. Managers need current Manage Server and channel visibility. No new poll-vote intent or Portal switch. Full scopes, hierarchy/overwrites and remediation are in [PERMISSIONS.md](PERMISSIONS.md) and [COMMUNITY.md](COMMUNITY.md#least-privilege-and-execution-boundaries).

Stored content/aggregate snapshots become eligible for worker deletion after 90 inactive days; worker downtime/backlogs prevent a strict deletion SLA. Existing content-free audit actor/post IDs have no new automatic TTL. Demo has no background delivery or automatic retention. Native Discord polls are not anonymous voting. [Access, retention, deletion and backup boundaries](COMMUNITY.md#privacy-retention-and-deletion) are explicit.

## Actual local verification

These are **fresh executed checks**, not historical README claims. Logs/artifacts are ignored local outputs, not production data.

| Check                                         | Actual result / scope                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh baseline before implementation          | 409 tests / 34 files passed.                                                                                                                                                                     |
| Final `npm test`                              | **505 tests / 39 files passed**; local SQL-capable PGlite plus domain/service/auth/queue mocks. 41.18 seconds in the final source run.                                                           |
| `npm run typecheck`                           | Passed, root and web TypeScript plus Next route type generation.                                                                                                                                 |
| `npm run lint`                                | Passed.                                                                                                                                                                                          |
| `npm run format:check`                        | Passed after correcting initial new-file formatting.                                                                                                                                             |
| `DEMO_MODE=false npm run build`               | Passed production compilation/service bundling; **not** a live-service execution.                                                                                                                |
| `DEMO_MODE=true npm run build`                | Passed; final preview/browser tests use this built demo.                                                                                                                                         |
| `npm run test:e2e`                            | **33 browser tests passed** on the production-built demo, including all previous regressions and seven new scenarios.                                                                            |
| Cancellation repeat batch                     | **5/5 passed** in a separate request-quota window; no timeout increase or runtime limiter bypass.                                                                                                |
| Scoped axe checks                             | No violations in the new publishing page/dialog/dark-page, news-preview and own-history scopes, with WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. **Not a sitewide/manual accessibility certification.** |
| `npm audit --omit=dev --audit-level=moderate` | **0 vulnerabilities** reported.                                                                                                                                                                  |
| `npm run db:generate`                         | No schema drift / nothing additional to migrate.                                                                                                                                                 |
| Python pinned-plugin installer checks         | **7 tests passed** via `python3 -m unittest discover -s docker/lavalink -p 'test_*.py'`.                                                                                                         |
| Documentation payloads                        | All six request examples validate against the actual input/action schemas; no request sent.                                                                                                      |
| `git diff --check`                            | Passed.                                                                                                                                                                                          |

Coverage includes SQL tenant isolation, current versions, concurrent claims/cancellation, quota persistence after deletion, expired/stale jobs, abandoned leases/late settlement, disabled/removed guilds, unknown results, malformed IDs, unsupported destinations, live/demo mode guards, private slash deferral/current manager checks, own-ledger isolation, actual locked music-service admission and shared feed routing.

Browser coverage includes real origin/tenant/body-size guards, explicit opt-in and validation, immutable simulated publication, paused cleanup, stale cancellation, UTC/server-zone display, no-JavaScript poll/ledger reads, cross-zone hydration, mobile keyboard/focus/overflow, preview invalidation and scoped accessibility. Existing activity fake-clock/timezone, command/audit, large-deals setup, permissions, role/moderation/news/economy and queued-music receipt regressions still pass.

### Browser issues found and resolved

1. The route-level streamed loading fallback required JavaScript to reveal the real page; no-JavaScript visitors stayed on the skeleton. Removing that boundary makes the authorized page await real content. SSR was not disabled or hidden until mount.
2. Light green/amber/red/neutral badge colors were tightened for contrast; actual scoped axe checks now pass.
3. Dialog close/focus restoration now follows the refreshed state, and older background snapshots cannot resurrect a newer local cancellation.
4. The restricted custom Chromium's software-GPU path intermittently blocked natively for about six seconds during dialog/screencast updates (CPU profile attributed the stall to native `(program)`, not a retry loop). Its **opt-in executable fallback** is now CPU-only. Normal developer/CI Playwright Chromium is unchanged; no web-security bypass or timeout increase was added.
5. An immediate stress repeat after a full browser run hit the real **120/user/guild/minute** API cap. The 429s were inspected, not hidden. Cleanup now queries only kinds actually created and skips no-op configuration writes; the repeat batch passed in a separate quota window. The runtime cap remains enforced.

Local Chromium **153.0.8010.0** was actually launched from an ignored temporary `@sparticuz/chromium@153.0.0` extraction. Playwright's normal installed browser is 156; the local executable override is documented rather than claimed version-identical. To reproduce this environment after preparing that ignored runtime:

```sh
LD_LIBRARY_PATH="$PWD/.cache/browser/runtime/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$PWD/.cache/browser/runtime/chromium" \
DEMO_MODE=true npm run test:e2e
```

Normal development/CI uses `npx playwright install --with-deps chromium`. Avoid immediately stacking large browser batches against the same demo identity/rate window; use a fresh isolated server or a later normal quota window, not a limiter bypass. Docker-only hosts use direct Compose commands; npm runs inside the images, not a host wrapper.

## What is not verified locally

- **No authorized live Discord/test-guild checks**: native message acceptance, real votes/close, scheduled delivery, live permissions/registration and audio are unverified. Mock/service/SQL tests and demo screenshots are not live success evidence.
- **No local Docker engine**, PostgreSQL server, Redis service or Lavalink backend was available. Local PGlite is not labeled real PostgreSQL. Queue consumer/transport behavior is mock-tested, not a real Redis integration run.
- The normal authorized branch-push workflow runs additional isolated **PostgreSQL 17** tests, Docker/Compose builds, plugin/Soundy tests and offline backend WebSocket/readiness checks. Inspect the exact ending commit's [GitHub checks](https://github.com/dcizov/discordjs-starter/actions?query=branch%3Aarena%2Fe2b42b08-discordjs-starter); the final handover reports their observed status separately. Historical CI from `0e77b45` is not new-feature proof. Even successful offline containers do not prove Discord/provider playback.

## Setup, examples and actual screenshots

Use [COMMUNITY.md](COMMUNITY.md) for the direct Docker update/migration/registration commands and feature walkthrough. Registration has **29 roots / 44 invocations**; a catalog page is not live registration. Re-register only for the intended application/guild scope, with existing server-side credentials. Both new flags remain off until configured; no unsolicited live messages or collection start on upgrade.

[Validated JSON examples](examples/community-posts.json) cover poll/announcement create plus schedule/cancel/publish/refresh. Actual simulated-flow screenshots are generated to ignored local files:

- [Native poll simulation](../.artifacts/native-polls-demo.png): closed native-poll simulation with unknown (not invented) aggregate counts.
- [Announcement simulation](../.artifacts/announcements-demo.png): scheduling/cancellation workflow, labeled simulation; no Discord message sent.

No screenshot is a fabricated live Discord receipt. The running preview uses a separate `.data/e2e.json` file, not a live database or the user's normal demo store.

## Prioritized backlog — intentionally absent

1. Suggestions only with moderation, vote/anti-brigading and erasure policy.
2. Burst-safe onboarding/welcome with explicit collection/messaging consent.
3. Private tickets with correct overwrites, lifecycle/retention and recovery.
4. Community-specific levels/autoresponders/starboards/temporary voice after policy assessment.

Recurring/personal reminders, anonymous custom voting, voter exports, announcement crossposting, generic force-retry and full no-JavaScript mutation forms are deferred. The shipped scope favors two complete new slices plus three concrete improvements, not placeholder modules or an implied roadmap implementation.

# Orbit structure and operational simplicity

Date: 2026-10-25. Branch: `arena/e2b42b08-discordjs-starter`.

## Verified starting point

Fetched both references without switching branches:

- Working/local HEAD: **33dc0eefb2732dd29b956795eb327834782b2dfa**.
- `origin/main`: **dc9726a8aa039c31b5e5be33de738c8c95756710**.
- Clean worktree; fresh `npm ci`; Node 22.22.3 / npm 10.9.8.
- Fresh baseline: **543 tests / 44 files passed, 34.82s**. Fresh browser execution: **45 passed** against the existing baseline production demo (not described as a newly executed build).
- Fresh audit: production **0**; full tree **8 moderate / 2 critical** affected packages. Docker/JDK executables are unavailable locally; packaging/probe execution requires exact-head CI.

Read README, architecture/security/deployment/development/permissions/music/Dev Container docs and the dashboard/implementation/community handovers, and inspected tests/CI. The identity/image, sidebar, private-cache, contrast and deterministic hydration fixes are present. The earlier OAuth/copy refactors are useful but did not separate bot startup or the large UI responsibilities. Main is a small two-command starter, not a replacement architecture for Orbit's services/data/features.

## Audit and selected boundaries

| Location                                           | Accidental complexity / proposed change                                                                                                                                                                                                     | Invariant and verification                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bot `index.ts` (343 lines)                         | Startup owns event callbacks, periodic work, an entire dashboard action executor and shutdown. Separate bootstrap, explicit listener installation and action consumption. Await initialization/cleanup; remove owned listeners and signals. | Defer before slow lookups; do not run late initialization after stopping; drain jobs before closing music/gateway; no new connection solely to close it. Characterize dispatch/actions, test listener ownership, login failure and startup/stop races. |
| Bot `interactions.ts` (596) and flat feature files | One handler imports every feature. Use direct static command routing to feature adapters, separate autocomplete, and group existing feature services by owner. No loader/plugins/decorators.                                                | One shared definition source, immediate private acknowledgement, fresh member/manager checks, module gates, tenant/idempotency/revision/mention guarantees. Existing executor/voice/SQL suites remain mandatory.                                       |
| Core `config.ts`, DB/CLI entrypoints               | Persistent feature schemas also contain environment policy; runtime validation differs from individual reads. Isolate one typed Zod field contract and small runtime schemas, keep mode/build semantics explicit.                           | No live credentials for demo or compilation, no unrelated requirements for registration/export/migration/doctor, no secret-value diagnostics or client export. Add a runtime matrix and startup checks.                                                |
| Dashboard shell (845)                              | Data reconciliation, navigation, profile refresh, header/search/notifications and help/demo dialogs share one owner. Extract coherent layout controls with explicit small contracts and local state.                                        | Preserve workspace/user keys, URL-keyed image fallback, meaningful SSR, optimistic rollback, mobile/keyboard/theme behavior. Fresh browser characterization exists.                                                                                    |
| Community page (894)                               | List reconciliation/action intents mixed with a complete draft editor, record presentation and confirmation UI. Extract coherent feature components; retain page-level revision/error/focus ownership.                                      | Preserve asOf reconciliation, intent key, disabled/busy/version behavior and focus restoration; publishing state machine remains unchanged.                                                                                                            |
| Overview (855)                                     | Toolkit filtering/toggling, preferences and connection dialog share the page's state. Give those controls their own components/state.                                                                                                       | Existing serialized server chart/calendar preparation is already the correct boundary; do not add a client clock/effect or alter measured/demo semantics.                                                                                              |
| Lavalink probe/deployment                          | Same Java invocation is repeated; readiness belongs to the image as well as Compose. Assess existing tools, centralize an image-owned healthcheck, keep small justified probe.                                                              | HTTP liveness ≠ authenticated readiness ≠ WebSocket/plugins ≠ voice/playback. Keep real CI compatibility checks and supervised recovery. Add refused/auth/redirect/recovery probe cases.                                                               |
| Development dependencies                           | Vitest/Tinypool have critical advisories; some compatible tools can be patched. Treat as its own verified stage, not audit-force or runtime-framework migration.                                                                            | No dropped tests, arbitrary worker-pool override, Tailwind major migration or Drizzle downgrade. Report residual advisories separately.                                                                                                                |

## Reference comparison

No upstream implementation is copied. Licenses are inspected; these are organizational patterns, not authorship judgments.

- **This repository main at dc9726a:** explicit `commands/index.ts`, builder+execute objects, separate registration and Zod config. Adopt discoverable static ownership; do not copy the smaller bot's Node 24/PG18/schema, global process exit or bot-only `dev` semantics over Orbit.
- [KevinNovak/Discord-Bot-TypeScript-Template at 7b331a1](https://github.com/KevinNovak/Discord-Bot-TypeScript-Template/tree/7b331a160b0c8573872d911569380286b553ba10), **MIT**, not archived, last push 2026-04-19; Discord.js `^14.22.1`, TypeScript, Vitest. Inspected `models/bot.ts`, `events/command-handler.ts`, explicit command indexes and registration service. Adopt event/command/service ownership and acknowledgement before database work. Reject its class/controller/middleware/barrel layers, independent cron/sharding/API and registration mutation tools for this fixed deployment. PRs #81/#78 establish maintenance/testing history; #78's reviews API is empty, not asserted approved.
- [discordjs/discord-utils-bot at 6511ef7](https://github.com/discordjs/discord-utils-bot/tree/6511ef7185af2d6ea2796451971604356825c4a9), **Apache-2.0**, last push 2026-09-23. Uses matching Discord REST/builders/API types, **HTTP interactions rather than a Discord.js gateway client**. Inspected entrypoint, application-command handler and deploy functions. Adopt explicit type dispatch and separate registration source; reject copying its HTTP server, signatures/cache/index startup or reflective DI into a gateway bot. PR #257 merged; reviews empty, no approval claim.
- [Sapphire framework at 6d225bf](https://github.com/sapphiredev/framework/tree/6d225bf48ebe1f324536b2a5e1c7419b0af0179f), **MIT**, last push 2026-10-23; Discord.js `^14.24.2`, Vitest tests. Inspected client/store/listener bootstrap and packaging. It solves extensible framework needs; Orbit does not need dynamic discovery, stores, plugins or a new client superclass. [PR #871](https://github.com/sapphiredev/framework/pull/871) has changes-requested and approved reviews, including [approval 5000805619](https://github.com/sapphiredev/framework/pull/871#pullrequestreview-5000805619); meaningful review is not inferred from code appearance.
- Official [Discord.js 14.27.0](https://discord.js.org/docs/packages/discord.js/14.27.0), installed types/manifests, [legacy guide](https://discordjs.guide/legacy) and [Next docs](https://nextjs.org/docs): explicit SDK events/builders and server/client boundaries. Installed version contracts prevail over the docs-root Node-version statement and legacy loaders/ORM examples.

## Decision: Better Auth — defer, not implemented

Current inspected package **1.7.12** supports Next 14–16, React 18–19, pg 8 and Drizzle `^0.45.2` / kit >=0.31.4: Orbit's installed versions are peer-compatible. The matching `@better-auth/drizzle-adapter@1.7.12` specifically declares Drizzle `^0.45.2` and core `^1.7.12`; checked package metadata, not an unperformed installed-adapter migration. It offers maintained OAuth/state/origin/session/revocation machinery and Next route/RSC integration, so this is not a claim that custom auth is inherently superior.

Concrete migration costs and required protections:

- Discord defaults/provider mappings must deliberately preserve **identify + guilds**, no bot/email/member scope expansion. Email-free Discord accounts need stable provider-ID mapping; Orbit uses Discord snowflakes for accounts/ledger, not a new internal auth user ID.
- Its account/session/user/verification model is not Orbit's single hashed-cookie/encrypted-token session row. Existing cookies/encryption format are not automatically compatible. A migration needs additive schema/data mapping, explicit re-login/session invalidation and rollback, not destructive resets.
- `account.encryptOAuthTokens` defaults **false** in inspected official init options; enabling authenticated encryption explicitly is required. Documented `getAccessToken`/`refreshToken` client endpoints must not expose Orbit's Discord tokens. Server-only token selection/refresh and public projections still need policy/tests; account cookies are not a substitute.
- Session refresh is sliding by default; Orbit's fixed expiry/revocation semantics and own-profile refresh must remain deliberate. Cookie session caching can delay revocation; keep it off for protected operations.
- Next RSC cannot set cookies; use route handlers/server cookie integration appropriately. Middleware/cookie existence does not replace session validation, current owner/Manage Server/membership or guild-scoped DB/execution checks.
- Keep trusted origin/CSRF protection, explicit base URL and rate controls, demo isolation and no browser secrets. No dual permanent auth implementation.

Without live credentials and with substantial bot/UI/operational work selected, this migration is not a safely verified net simplification in this change. **No Better Auth package/schema/routes are installed.** Fix the confirmed custom OAuth wording issue and retain existing auth security tests.

Sources: official [Discord provider](https://www.better-auth.com/docs/authentication/discord), [OAuth/token/profile APIs](https://www.better-auth.com/docs/concepts/oauth), [Next integration](https://www.better-auth.com/docs/integrations/next), [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle), [sessions/cache/revocation](https://www.better-auth.com/docs/concepts/session-management), [security](https://www.better-auth.com/docs/reference/security), [options/source](https://github.com/better-auth/better-auth/blob/main/packages/core/src/types/init-options.ts). Better Auth is MIT; no library source copied.

## Decision: t3-env — defer; consolidate existing Zod instead

Inspected **@t3-oss/env-core 0.13.11**, MIT; [official core docs](https://env.t3.gg/docs/core), [customization](https://env.t3.gg/docs/customization), [repository](https://github.com/t3-oss/t3-env). Standard Schema/Zod 4 and TS >=5 match this workspace. ESM-only packaging is a build consideration for CJS service bundles, **not an asserted incompatibility**.

T3 provides valuable typed proxies, client-prefix checks and schema composition. Orbit currently exposes **no browser environment values**; integration-presence booleans arrive in authorized public DTOs. The work it cannot remove is the actual per-runtime matrix, conditional optional music, explicit mode and build/runtime distinction. One existing Zod contract can solve those without an extra proxy/adapter layer. Do not add t3-env alongside old validation or use `skipValidation` to make builds pass.

Selected implementation: move environment policy out of persistent feature config, reuse the same field validators for typed individual reads/startup schemas, validate registration/export/migration/diagnostics only for their actual needs, keep secrets off the core browser-facing barrel, and preserve credential-free demo/builds. Web **does** need the bot token for the existing read-only channel permissions REST path, not just OAuth; retain it. Worker needs neither web OAuth secret nor APP_URL, and optional music pairing belongs to consumers of music, not every process.

## Proposed responsibility tree (before implementation)

```text
BEFORE                         PROPOSED (only useful folders)
apps/bot/src/                  apps/bot/src/
  index.ts [startup+jobs+events]   index.ts [dotenv + start + fatal boundary]
  interactions.ts [all adapters] bootstrap.ts [construction/ready/stop ownership]
  commands.ts [re-export]        commands/ [registration + static feature adapters]
  register.ts                   interactions/ [type dispatch + autocomplete/replies]
  music*.ts, roles.ts, ...       events/ [explicit listener installation/disposal]
  export/diagnose tools         features/ [music/deals/roles/moderation/community]
  sync.ts                       infrastructure/ [guild sync + action consumer]
                                tools/ [REST-only export/diagnostic CLIs]
apps/web/components/           apps/web/components/
  dashboard.tsx [all chrome]     dashboard.tsx [workspace data + composition]
  overview.tsx [many owners]     layout/ [sidebar/header/account/chrome dialogs]
  community-page.tsx [editor]    features/community/ [page/editor/record/review]
                                features/overview/ [toolkit/status/preferences]
packages/core/src/config.ts    config.ts [persistent feature schemas]
  [feature + environment]      environment.ts [server runtime policy, no root export]
```

Dependency direction: entrypoints → bootstrap/adapters → feature services → shared core policy and DB. DB depends on core, never bot/web; no feature imports bootstrap. Command JSON remains **packages/core/src/commands.ts** for registration/catalog/docs; no filesystem discovery or duplicated builders. Existing worker transaction/delivery state machines remain unchanged apart from qualified environment imports.

## Prioritized implementation sequence

1. **Development tools**: verified compatible security updates, full existing unit regression; record residual findings. Separate commit.
2. **Runtime configuration + auth wording**: characterization/matrix tests, isolate shared contracts, update CLI/web/service entrypoints and setup docs. No auth migration.
3. **Bot organization/lifecycle**: characterize current actions/acknowledgement; explicit static adapters and typed event installers; lifecycle tests for failures/races/owned cleanup. Preserve source definition/registration/catalog consistency and built CLI names.
4. **Dashboard ownership**: extract meaningful layout and feature controls, keep state near owners and genuine existing reconciliation; browser regressions before/after, no chart/SSR rewrite.
5. **Health/deployment**: image-owned standard healthcheck/one probe invocation; keep the minimal Java helper if tool evidence supports it, add loopback success/refusal/auth/recovery tests and exact-head container CI. No extra runtime packages/ports or Compose-only requirement.
6. Final type/lint/format/unit/database/demo+live compilation/browser/audit/schema/CI checks, docs/examples/paths and screenshots. Stages are separate commits on this branch, not one combined migration.

## Implementation and final evidence

Implemented stages and their fresh checks follow below. The final local evidence table concludes this report; immutable ending commit/CI URLs are supplied in the delivery to avoid treating a historical parent run as proof. No live Discord/CDN/provider/audio success is claimed from demo or mocks.

### Stage 1 — development tools (implemented)

- Vitest **3.2.7 → 5.0.5**, compatible with Node >=22.14 (package requires >=22.12). Existing tests/config run unchanged: **543/44 PASS, 29.84s**; typecheck and lint pass. No isolation/retry/timeout changes. Tinypool and the old Vitest mocker are removed by the supported Vitest update, not an incompatible override.
- Drizzle Kit's declared minimum is aligned to **^0.31.11** (already resolved to 0.31.11 in the baseline lockfile; **no installed Kit version change**; main also uses this patch). Existing schema generation still reports **no changes**. ORM/runtime versions unchanged.
- Full audit now **7 moderate / 0 critical**; production **0**. Remaining graph: Drizzle Kit's legacy esbuild-kit loader/old esbuild (4 nodes) and Tailwind 3/PostCSS selector parser (3 nodes). Official advisory requires selector-parser >=7.1.6 while Tailwind 3 constrains ^6.1.2; automatic suggestions include Tailwind 4 or Drizzle Kit downgrade 0.18.1. No forced downgrade, major CSS migration or unreviewed transitive-major override is applied. These are remaining developer-tool issues, not a clean-tree claim.

### Stage 2 — configuration and OAuth wording (implemented)

Seven current-behavior environment tests passed before source changes. One server runtime module now owns the field validators and startup matrix; the feature config no longer includes environment functions. DB connection setup and server callers use this same contract, with no root barrel export or credential capture at import time. Tool validation follows `--help`/demo refusal, and web retains its real bot-token requirement for channel REST reads. Missing/invalid errors never include values. Unknown modes, invalid connection protocols and malformed optional music settings fail explicitly.

Added the runtime matrix, secret-safe malformed URL errors, unchanged password bytes, client-access refusal and initial-sign-in versus renewal wording tests. **563/45 PASS (29.23s)**; typecheck/lint pass. No auth library/schema/session migration or cookie/scope change. Existing session/profile/tenancy tests still pass.

### Stage 3 — bot structure and lifecycle (implemented)

**29 action/interaction characterization tests passed before extraction.** The 9-line entrypoint only loads dotenv and owns the fatal promise boundary. Bootstrap constructs transports, checks application identity and explicitly owns readiness and shutdown. The action worker starts with `autorun: false`; it starts processing after Redis readiness, while abort can interrupt that wait. Only a consumer that never started is force-closed; running jobs drain before music/gateway shutdown. Initial snapshots cannot allocate a late worker/timer after stop. Owned timers are cleared and in-flight heartbeats drained before final offline health; signal/listener cleanup is idempotent and continues after individual resource failures. Redis shutdown never creates a connection and disconnects a retrying connection rather than queueing QUIT forever.

`events/gateway.ts` has explicit SDK-typed handlers and one local listener-disposal list; no `any[]` argument inspection or client-wide listener removal. Music's raw SDK/voice listeners stay owned by MusicService. Command adapters use one small acknowledged member/config context, direct static routing and feature-specific services. Builders stay in core; registration's actual REST payload is tested against those builders, replacing the tautological one-line re-export comparison. **All 29 registered roots route**; public JSON/29 roots/44 invocations remain unchanged. Source moves update tests, package CLI scripts, tsup and CI imports; no compatibility barrel/loader.

New focused lifecycle/routing/event/maintenance/Redis coverage: **86/8 PASS**. Full regression: **624 tests / 51 files PASS, 36.16s**, including actual installed voice/backend regressions and local SQL. Typecheck and lint pass. Fresh demo production + six service/CLI bundles pass; compiled demo bot/registration exit without connecting, and compiled export/doctor help work without credentials. Real gateway/Redis startup is not claimed by the fixtures.

The worker's existing transaction/outbox/reconciliation body remains deliberately unrewritten; only qualified env imports/non-creating shutdown are changed. This is not a claim to have modularized every remaining service.

A follow-up behavioral regression deliberately made login resolve before `ClientReady`; it failed against a captured initially-resolved promise. Bootstrap now exposes one stable readiness promise completed only by initialization, with safe abort/failure observation. Focused lifecycle/action/event/maintenance coverage **28/4 PASS** and typecheck pass. This does not infer audible playback from startup.

### Stage 4 — dashboard ownership (implemented)

Three new browser characterizations passed **before UI extraction**: header search/notification independence and navigation; overview preference rollback on an actual 503 response; and failed profile refresh retaining the real decoded identity image. The existing 45 browser scenarios were also green at baseline.

- `dashboard.tsx` now owns workspace data, optimistic rollback, polling/identity guards and composition (**202 lines**, not 845). `layout/sidebar.tsx`, `layout/header.tsx` and `identity/account-menu.tsx` own navigation, keyboard search/notifications/theme and profile-busy/error behavior respectively. Guidance/demo/installation controls have explicit small contracts; no replacement context/manager hook.
- Community's **343-line** page keeps snapshot/asOf reconciliation, immutable action intents, API busy/errors and focus refs. The draft editor owns its form state; record presentation delegates actions rather than fetching; the controlled review keeps exact revision/error/focus semantics. These are meaningful feature boundaries, not one file per JSX fragment.
- Overview's **382-line** page composes current/read-only presentation and the existing activity chart. Toolkit filtering/toggling, preferences and connection details each own their local state. Toolkit stays mounted when hidden so its filter is not needlessly reset. `packages/core/src/activity.ts`, DB calendar aggregation and `activity-chart.tsx` are deliberately unchanged: server-serialized calendar/timezone preparation already belongs there.
- The public workspace contract, parent guild+user key, URL-keyed image fallback, scoped navigation, exact markup/style/accessibility labels and no-JS SSR are retained. Genuine same-workspace reconciliation effects remain; no new synchronization effect or browser-clock initialization.

After extraction: **624/51 unit PASS, 44.55s**, typecheck/lint and fresh production/service build pass. **48/48 real Chromium browser PASS (1.3m)**, including old timezone/SSR/no-JS/mobile/image/permission/publishing regressions plus the three new layout cases. Standard CI/browser remains a separate final check, not inferred from this custom Chromium run.

### Stage 5 — image-owned standard readiness (implemented)

The first exact-head [CI 40210184943](https://github.com/dcizov/discordjs-starter/actions/runs/40210184943) on `7f2bda3d8a8c832c3045fcfb822649d34f2dec77` passed both jobs (including 48 standard-browser tests). Its actual-image inventory established **`java=yes curl=yes wget=yes node=no python=no`**. This is stronger evidence than assuming optional tools absent from the upstream Dockerfile. The initial image-owned JVM probe passed, but retaining custom Java compilation was no longer the simplest justified choice. The follow-up **removes Healthcheck.java, the temporary Java harness and all probe compile/copy/heap machinery**, rather than keeping two systems.

Final implementation: the image owns `HEALTHCHECK` → `/opt/Lavalink/healthcheck/run`, inherited by Compose and usable by plain Docker/other supervisors. The small POSIX script uses the **already-present curl**, with a build-time presence assertion so an upstream packaging change fails explicitly. No new runtime package/toolchain or port. It requires exact HTTP 200, bounds connect/overall time, disables curl config/proxies/redirects, rejects CR/LF credentials and feeds the Authorization header through **stdin**, not argv or logs. The Compose override and repeated Java invocation are gone.

`tests/integration/lavalink-health.ts` is one shared real-HTTP fixture, run locally by Vitest when sh/curl are available and **mandatorily with the exact built audio image in CI**. It checks **11 cases**: missing/empty/CR/LF password, valid quoted/backslash header with proxy bypass, unauthorized, HTTP 503/302/204 rejection, no redirect request, refused listener and recovery. Stdout/stderr must remain empty. A missing tool, Docker failure or timeout is a harness failure—not an accepted negative response. Local supplemental checks are explicitly skipped only on hosts without sh/curl; Docker-only app images need not install curl for tests. The actual audio-image check is never skipped. Its fake endpoint binds only runner loopback; later real-backend plugin/WebSocket/probe checks remain network-isolated and unchanged.

After the evidence-driven change: **35/4 focused tests PASS**, including all 11 local HTTP cases; fresh full **626/52 PASS (31.52s)**, typecheck/lint/format pass. The replacement image still needs its own final CI result; the earlier green JVM/image run is not claimed as curl proof.

## Remaining checks: consumers and meaning

| Check / consumer                                                | Detects / does not prove                                                                     | Decision                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Web `/api/healthz`, Compose + editor HTTP smoke                 | Web route liveness/mode; not DB/Redis/bot readiness                                          | Keep lightweight, no unrelated downstream I/O                |
| PostgreSQL authenticated TCP `SELECT 1`, migration gate         | Credentials/database/TCP availability, not application schema                                | Keep; migration completion is a separate gate                |
| Migration service completion, app/editor startup                | Required schema steps completed, not future DB health                                        | Keep; no resets or changed volumes                           |
| Redis `PING`, bot/worker dependencies                           | Redis process responsiveness, not a job consumer or delivery                                 | Keep; AOF/noeviction unchanged                               |
| Image `/v4/info` authenticated HTTP probe, Compose/plain Docker | Reachable authenticated endpoint with HTTP 200; no redirect; not plugins, WebSocket or voice | Image-owned standard curl probe; custom Java removed         |
| Bot maintenance heartbeat / dashboard                           | Gateway `isReady` + current latency, music state; missing/stale isn't healthy                | Keep independent service signals; drain before final offline |
| BullMQ consumer admission + scoped completion receipts          | Actual consumer availability; accepted/pending != completed                                  | Keep bounded admission, stale rejection and existing retries |
| MusicBackend supervised WebSocket/reconnect                     | Connected application transport and recovery after downtime, not source/audio                | Keep; service_healthy only orders initial startup            |
| CI plugin metadata/source/filter checks                         | Exact pinned versions, one owner per approved source and packaged capabilities               | Keep; not duplicated by generic HTTP 200                     |
| Read-only music doctor                                          | Authenticated metadata and optional allowed track resolution                                 | Keep separate; no gateway join/queue/audio                   |
| Owned Discord voice ACK/player lifecycle                        | Correct guild/bot/shard/channel pairing and owned cleanup                                    | Keep; unit transport fixtures != authorized live handshake   |
| Actual audible track / production delivery                      | Requires authorized real provider + guild checks                                             | Not performed; no health indicator substitutes for this      |

## Actual source map and dependency direction

```text
apps/bot/src/
  index.ts                        dotenv + fatal boundary (9 lines)
  bootstrap.ts                    resource construction, ready promise, stop ownership
  commands/
    register.ts / registration.ts  CLI / explicit REST registration
    dispatch.ts / context.ts       fixed routing / acknowledged member+config snapshot
    community.ts economy.ts moderation.ts music.ts news.ts roles.ts
  interactions/
    dispatch.ts                    type dispatch, early private defer, sanitized errors
    autocomplete.ts replies.ts     scoped suggestions / response presentation
  events/gateway.ts                explicit typed registration + owned disposal
  features/
    community.ts                   native publication/claim/settlement transport
    deals/{commands,replies,selection}.ts
    moderation/{actions,messages}.ts
    roles/{panels,shop}.ts
    music/{service,backend,voice,node,source,plugins,diagnostics}.ts
  infrastructure/
    action-consumer.ts              dashboard job execution/consumer
    maintenance.ts guild-sync.ts    owned periodic work / Discord→DB snapshots
  tools/{export-channels,channel-export,music-doctor}.ts
apps/web/components/
  dashboard.tsx                    workspace data/API and composition
  layout/                         sidebar, header, guidance, notice, installation, navigation
  identity/                       image lifecycle and account controls
  features/community/             page, draft editor, record, review
  features/overview/              overview, toolkit, preferences, connection status
  activity-chart.tsx ui/ ...       retained shared chart/primitives and mature feature pages
packages/core/src/
  commands.ts command-catalog.ts   single definitions and derived reference metadata
  config.ts environment.ts        feature schemas / qualified server runtime policy
  activity.ts permissions.ts ...  shared pure invariants and explicit integrations
packages/db/src/                  persistence, tenant predicates and transactions
apps/worker/src/                  retained outbox/reconciliation, no second framework
```

Entrypoints → bootstrap/adapters → feature services → core policy + DB. DB depends on core, never bot/web. No feature imports bootstrap, no implicit command/event discovery, no new barrel chain or plugin/client superclass. **Command source of truth stays core**: registration sends its exact JSON; the dashboard catalog derives from it; behavioral tests cover every registered root's route. No command builder, usage/permission metadata or public name is recreated in the new folders.

## Concrete before/after examples

```ts
// Before: role/channel events inspected untyped positional arguments in startup.
client.on(event, (...args: any[]) => {
  const role = args.at(-1);
  void (syncGuild(role.guild).catch(/* another inline logger */));
});
// After: SDK-typed argument, shared sync operation, owned listener disposal.
listen(Events.GuildRoleUpdate, (_before, role) => sync(role.guild));
```

```ts
// Before: hundreds of lines of event bodies and a queue processor inside main().
// After: only orchestration knows lifecycle; handlers own implementation.
stopMaintenance = await startMaintenance(client, music, abort.signal);
if (abort.signal.aborted) return;
worker = createActionConsumer(client, music, rest); // autorun false until ready
```

```tsx
// Before: Dashboard owned profileBusy + OAuth action, search/notifications,
// theme controls, navigation, every chrome dialog and workspace mutations.
// After: explicit ownership, existing workspace boundary, no manager hook.
<DashboardHeader
  section={section}
  onOpenNavigation={openMenu}
  onModeInfo={openInfo}
/>
// AccountMenu owns profileBusy; header owns search/notifications; Dashboard
// keeps only data/optimistic reconciliation and genuinely shared layout state.
```

```dockerfile
# Before: consumers repeated heap/unset/class invocation; Compose-only health.
# After: image owns the command and policy; consumers call the same executable.
HEALTHCHECK --interval=5s --timeout=5s --start-period=20s --retries=12 \
    CMD ["/opt/Lavalink/healthcheck/run"]
```

These are responsibility/contract reductions, not a claim that total source lines decrease. New lifecycle/security characterizations are intentional. Client boundaries remain interactive where the workspace requires them; server loading/auth and serialized chart data remain server-side.

## Compatibility and update procedure

- No DB schema migration, reset, volume deletion, credential rotation, permission/scope broadening, public command JSON or queue protocol change. Existing hashed sessions/encrypted tokens/profile refresh remain. **No Better Auth or t3-env migration is implemented.**
- Existing npm script names and six `dist/*.js` names stay stable. Direct source imports moved; internal tests/tooling/CI use the new paths. Consumers importing private source paths should follow the source map, not retain compatibility barrels.
- Rebuild/recreate normal app and Lavalink images with the existing **direct Compose** workflow; no host npm or Docker wrapper scripts. Refresh a populated dev dependency volume using the existing documented container-side `npm ci` procedure. Re-register only if your deployment actually changed command definitions—not for this refactor.
- The custom audio image now carries health metadata. Rebuild it; merely removing a Compose override while keeping an old image would not supply the new healthcheck. Non-Compose hosts keep their supervisor and can call `/opt/Lavalink/healthcheck/run` inside that image.
- Production dependencies/framework versions are unchanged. Vitest is the only installed major tool change; its supported Node 22/24 environment is verified separately. Drizzle Kit's declared minimum changed, but its resolved version was already 0.31.11. No runtime dependency was added; obsolete Tinypool/old mocker transitives disappeared with Vitest's supported graph.

## Deferred complexity and evidence limits

- Better Auth/token/session migration, t3-env, worker transaction/outbox decomposition, large resource editor overhaul and broad dependency/framework upgrades remain deferred with reasons above. They are not described as implemented.
- Economy locking/idempotency, publication claims/revisions/ambiguous sends, paused cleanup, voice ownership/stale events, SSRF/mentions, guild authorization and deterministic chart snapshots remain explicit. Similar checks at different trust/transaction boundaries are not merged merely for fewer lines.
- Existing background dashboard refresh error presentation and multi-replica OAuth refresh concurrency are not redesigned. No new live credential, gateway lease/status registry, periodic provider polling or auto-replay is introduced.
- No authorized Discord OAuth/guild/CDN/audio/provider check is claimed. Browser image fixtures demonstrate decoding and failure recovery, not live CDN success. Local SQL uses PGlite unless a dedicated TEST_DATABASE_URL is supplied; real PostgreSQL/Redis/backend/container checks are reported only from observed exact-head CI.

## Final local verification (fresh, 2026-10-25)

| Executed check                     | Result / boundary                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh final `npm ci`               | PASS, frozen lockfile; no installed production package version changes                                                                                                          |
| `npm test`                         | **626 tests / 52 files PASS**, 31.52s (earlier clean-install pre-curl run: 625/51, 34.33s); includes 41 SQL-capable PGlite cases and all prior economy/publication/voice guards |
| Typecheck / ESLint / format        | **PASS**, both TypeScript projects; no warnings or broad suppressions                                                                                                           |
| Production builds                  | **PASS** for both `DEMO_MODE=false` and `DEMO_MODE=true`, Next + all six CJS bundles                                                                                            |
| Compiled CLI smoke                 | Demo bot/registration exit without connections; compiled channel/role export and music doctor `--help` work without credentials                                                 |
| Fresh final Chromium suite         | **48/48 PASS**, 1.3m; custom Chromium 153.0.8010.0 (standard workflow browser separately checked in CI)                                                                         |
| Plugin installer Python / shell    | **7 PASS**; `sh -n` probe launcher PASS                                                                                                                                         |
| Schema drift                       | `db:generate`: **No schema changes, nothing to migrate**                                                                                                                        |
| Production audit                   | **0 findings**                                                                                                                                                                  |
| Full developer-inclusive audit     | **7 moderate / 0 critical** affected packages; residual Drizzle loader/esbuild + Tailwind 3/parser findings documented, not waived                                              |
| Runtime architecture review        | Critical moved feature bodies unchanged beyond imports; no bot runtime import cycles; no environment-runtime marker in built client chunks                                      |
| Git whitespace / YAML formatting   | **PASS**                                                                                                                                                                        |
| Local Docker/real PostgreSQL/Redis | **Not available/run locally**; exact-head CI runs these isolated checks and is reported separately                                                                              |

No live Discord client/bot/application/DB/Redis/Lavalink credentials were present (availability inspected as booleans only). No live login, registration, guild/CDN, provider or audible test was performed. CI's real PostgreSQL, Redis and network-isolated backend checks are not a production environment certification.

Actual browser screenshots refreshed under ignored `.artifacts/`: `dashboard-identity-demo.png`, `dashboard-account-demo.png`, `dashboard-identity-fallbacks.png`, `dashboard-identity-mobile.png`, `native-polls-demo.png`, `announcements-demo.png`. These are real local demo renders, not fabricated live receipts or generated mockups.

Logs live in ignored `.artifacts/structure/`: baseline install/tests/audits/browser; stage `tools-*`, `env-*`, `bot-*`, `ui-*`, `health-*`, and final install/typecheck/lint/format/tests/schema/demo-build/live-build/browser/Python/audit files. The first readiness timing regression is recorded red, then green; initial extraction/test-fixture corrections were not concealed by disabling assertions. Final exact commit and observed CI run/jobs are reported in the delivery, not inferred from old handover counts.

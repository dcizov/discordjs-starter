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

Current inspected package **1.7.12** supports Next 14–16, React 18–19, pg 8 and Drizzle `^0.45.2` / kit >=0.31.4: Orbit's installed versions are compatible. It offers maintained OAuth/state/origin/session/revocation machinery and Next route/RSC integration, so this is not a claim that custom auth is inherently superior.

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

Pending implementation. Starting counts above are fresh baseline evidence only; final counts, actual tree, examples, dependency changes, compatibility and exact ending commit/CI are recorded after execution. No live Discord/CDN/Redis/provider/audio success is claimed from demo or mocks.

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

### Stage 4 — dashboard ownership (implemented)

Three new browser characterizations passed **before UI extraction**: header search/notification independence and navigation; overview preference rollback on an actual 503 response; and failed profile refresh retaining the real decoded identity image. The existing 45 browser scenarios were also green at baseline.

- `dashboard.tsx` now owns workspace data, optimistic rollback, polling/identity guards and composition (**202 lines**, not 845). `layout/sidebar.tsx`, `layout/header.tsx` and `identity/account-menu.tsx` own navigation, keyboard search/notifications/theme and profile-busy/error behavior respectively. Guidance/demo/installation controls have explicit small contracts; no replacement context/manager hook.
- Community's **343-line** page keeps snapshot/asOf reconciliation, immutable action intents, API busy/errors and focus refs. The draft editor owns its form state; record presentation delegates actions rather than fetching; the controlled review keeps exact revision/error/focus semantics. These are meaningful feature boundaries, not one file per JSX fragment.
- Overview's **382-line** page composes current/read-only presentation and the existing activity chart. Toolkit filtering/toggling, preferences and connection details each own their local state. Toolkit stays mounted when hidden so its filter is not needlessly reset. `packages/core/src/activity.ts`, DB calendar aggregation and `activity-chart.tsx` are deliberately unchanged: server-serialized calendar/timezone preparation already belongs there.
- The public workspace contract, parent guild+user key, URL-keyed image fallback, scoped navigation, exact markup/style/accessibility labels and no-JS SSR are retained. Genuine same-workspace reconciliation effects remain; no new synchronization effect or browser-clock initialization.

After extraction: **624/51 unit PASS, 44.55s**, typecheck/lint and fresh production/service build pass. **48/48 real Chromium browser PASS (1.3m)**, including old timezone/SSR/no-JS/mobile/image/permission/publishing regressions plus the three new layout cases. Standard CI/browser remains a separate final check, not inferred from this custom Chromium run.

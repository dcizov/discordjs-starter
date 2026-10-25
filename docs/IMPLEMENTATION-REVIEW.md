# Orbit implementation review — 25 October 2026

> Historical implementation report. For the current source layout, runtime/tooling decisions and newer verification, see [STRUCTURE-REFACTOR.md](STRUCTURE-REFACTOR.md).

## Scope and inspected revision

The current branch was fetched before implementation: **`arena/e2b42b08-discordjs-starter`**, starting at **`4c75751c7f840b0f19cf60eec44a1d34b2766912`**. The previously mentioned `23b405a` was not assumed to be current. This review describes the changes following that inspected revision; the branch history records their resulting commit.

README, architecture/deployment/security/integration/music/deal docs, manifests/lockfile, installed SDK implementations, Compose/Dev Container configuration, handlers, persistence, queues, and tests were inspected. Discord.js, the Next App Router, Tailwind/Radix, PostgreSQL/Drizzle, Redis/BullMQ, and Lavalink remain the existing application architecture. No replacement dashboard, Prisma, new persistent configuration system, destructive migration, volume reset, credential rotation, or dependency change was introduced.

## Public reference, ownership and reuse

| Public source inspected                                                                    | Finding and limitation                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Dashboard preview](https://dashboard.grallemole.com/preview?preview=1)                    | Public Plugin Status page exposes configuration/enabled/setup counts, sorting, and explicit browser-local demo isolation. The rendered page was inspected; authenticated pages and interactive plugin forms were **not** inspected.                                                            |
| [Dashboard landing](https://dashboard.grallemole.com/)                                     | Feature grouping and a status → permissions → selected-feature setup sequence. These are workflow ideas, not a claim that Orbit implements that site's entire plugin catalog.                                                                                                                  |
| [Main site](https://grallemole.com/) and [official links](https://grallemole.com/en/links) | Verify the dashboard and link to the [owner's site](https://rs0-5.com/). No official source-repository link or reusable source license was found on these inspected pages.                                                                                                                     |
| [Repository search result](https://github.com/gusiiic/GRALLEMOLE-bot)                      | GitHub search found this similarly named public repository. API metadata reports size 0, no homepage and no license; contents/license endpoints return 404. Its connection to the official site is **unverified**. An empty unlicensed name match is not a usable or verified official source. |

**Reference license: no applicable source/asset license verified. Reused reference code, assets, branding and private material: none.** Public access is not permission to copy. Orbit's module/setup counts, filters, permission guidance and source-readiness labels were implemented independently against Orbit's own data and handlers. No login bypass, private source inspection, leaked credentials, copied layouts, or proprietary artwork was used. Installed Shoukaku 4.3.0 is MIT-licensed; its installed connector/connection behavior was inspected to implement compatibility fixes, not to import Grallemole material. The existing music-plugin inventory/licenses remain in [MUSIC-PLUGINS.md](MUSIC-PLUGINS.md).

## 1. Voice handshake: confirmed defects versus unknown live cause

The installed contract is **Shoukaku 4.3.0 / discord.js 14.27.0 / @discordjs/ws 1.2.3**. Existing `GuildVoiceStates`, basic channel checks, per-guild music action locking, server-before-state buffering and failed-join cleanup were already present. They are not presented as newly discovered fixes.

### Reproduced and fixed offline

- The inherited connector only awaited a future `clientReady`. A connector constructed after readiness missed initialization of the manager's bot identity. The owned listener now initializes once in a microtask for an already-ready client, so construction completes before SDK readiness work.
- Raw events previously lost their shard context. Requests now validate the actual cached guild/shard, actual raw-listener attachment, initialized matching identity, ready gateway shard and requested code intent. Unknown guilds, wrong shards and an unready gateway fail before sending/queuing a new join.
- Direct overlapping helper joins could replace shared SDK connection state. Attempt ownership is per guild; another helper attempt is rejected without interrupting the first. Wrong-channel own-state, wrong-bot and wrong-shard packets cannot complete a pending attempt.
- Server-first handling was retained and strengthened. Synchronously emitted test packets are deferred until the SDK connection exists, without counting one packet twice or replaying packets into a later attempt.
- Stale leave acknowledgement could arrive **before old SDK destruction finished**. Replacement joins now wait for both. A failing regression reproduced the old cleanup deleting the replacement connection; it passes with the fix. Cleanup checks connection/player ownership again after awaits, and does not send a destructive leave over a replacement.
- Old player's queued close, end and position callbacks cannot erase/update a new player. Disposal detaches only this connector's listeners and cancels pending leave observers. Shutdown also cleans connection-only attempts and detaches listeners even if snapshot persistence fails; persistence failures are sanitized and do not prevent the remaining voice cleanup.

Relevant implementation: `apps/bot/src/music-voice.ts`, `music.ts`; regressions: `tests/music-voice.test.ts` (23), `music-service.test.ts` (10), and existing backend/source/doctor tests.

### Diagnostics and boundaries

Safe structured records distinguish **`gateway-failed`**, **`player-failed`**, and **`player-created`**. They include readiness/identity/listener/intent booleans, phase, guild/channel/shard identifiers, event count, elapsed time and cleanup status. They do **not** log tokens, voice session IDs, voice-server tokens, raw payloads or endpoint/session URLs. Raw SDK debug remains disabled; general error diagnostics also redact voice session/endpoint fields.

`joinSent` means a frame was submitted to the SDK's shard, **not acknowledged by Discord**. `player-created` means handshake/player creation succeeded, **not audible playback**. Lavalink transport, track lookup and Discord voice are separate stages. The read-only [music doctor](MUSIC.md) checks `/v4/info` and optional `/v4/loadtracks` without Discord login, player creation or playback.

**Not established:** the root cause of the user's particular live “both voice events missing” failure. No live bot credentials, authorized test guild, external-process inventory or actual voice payloads were available. Normal bot startup already constructs music before login, so the late-ready edge alone is not proof of that production cause. The repository's idle editor/one bot service contract was checked; another machine, stack, token consumer or Redis namespace cannot be audited from here. No distributed gateway lease or automatic process termination was added. Do not change providers/ports/plugins, grant Administrator/Move Members, or look for a nonexistent privileged voice toggle as a substitute for identifying the failing stage.

## 2. Deal cards, artwork and the Fittest discrepancy

Slash `/deals search`, `/deals now` and `/deals info` now request **large artwork independently of compact text density**. No visible internal catalog UUID remains, including detailed info. The previous generic author/counters are removed. The title remains the game; supplied banner is preferred, with supplied cover as an honest large-image fallback. No replacement artwork URL, invented resolution or screenshot is manufactured.

Internal IDs still serve API lookup, caching, typed title/autocomplete selections and watch actions. Offer/affiliate links, checked times, release/community information, safe mentions and Discord embed limits remain. Explicit artwork overrides are tested in both directions. Shared scheduled-delivery presentation defaults were deliberately preserved; this redesign does not silently alter scheduled campaign behavior.

[Example reply JSON](examples/deal-reply.json) is generated by the **actual slash renderer** from an explicitly fictional offline fixture. A regression compares it to real renderer output. It shows large `image`, no author/UUID/counter, preserved offer URLs and `allowedMentions.parse: []`. Its example assets, shop, €10 price and fixed timestamp are **not a live quote**.

### Evidence, not a fabricated free price

Public sources inspected:

- [Steam app 407530](https://store.steampowered.com/app/407530/ARK_The_Survival_Of_The_Fittest/) has a Free to Play user tag but explicitly says The Survival of the Fittest is bundled with ARK: Survival Evolved and requires purchasing it.
- [ITAD info](https://isthereanydeal.com/game/ark-the-survival-of-the-fittest/info/) corresponds to the screenshot's catalog entry and displays both the tag and a paid offer.
- [ITAD associated products](https://isthereanydeal.com/game/ark-the-survival-of-the-fittest/products/) associates **app/407530** with paid parent **sub/59321**, ARK: Survival Evolved.
- [ITAD public API documentation](https://docs.isthereanydeal.com/) and its [info schema](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/games/schemas/resp.games.info.yaml) were checked; a nullable Steam app mapping does not establish package equivalence or entitlement.

The paid-parent association explains why the tag is **not sufficient evidence of a free current package**. It does not prove local cache corruption or that every regional offer has that explanation. Observed public USD pricing was not relabeled as a German EUR quote. Runtime data still comes from configured public APIs; no new scraping path was added. Presentation now identifies tags as tags and explains a paid offer alongside a Free to Play tag, rather than replacing real supplied prices with zero.

The inspected base already lacked some older screenshot elements. Check the running image/checkout and newly requested reply: a rebuild does not fetch Git, bind mounts can override images, and already-sent Discord messages keep their old embed. See [DEALS.md](DEALS.md).

## 3. Hydration and truthful activity ranges

The server captures one reference instant, resolves the configured guild IANA time zone (default configuration **Europe/Berlin**; missing/invalid legacy values → documented **UTC** fallback), obtains bounded guild-scoped ledger aggregates, and serializes complete chart windows. The first client render consumes those labels/values/reference unchanged. Nearby relative-time labels use that same reference, not independent browser clocks.

- Actual **7/14/30 calendar-day windows**, each paired with actual preceding-period data. Calendar keys, not repeated 86,400,000 ms subtraction, determine day boundaries.
- PostgreSQL aggregates `type = activity` with guild/time bounds and distinct users, independently of the latest-200-row ledger display. Future and other-guild rows are excluded. Tests include more than 250 rows and DST-local SQL grouping.
- Chart metrics are accurately named **Rewarded messages** and **Rewarded members**, not all messages, total members or command executions. Range selection changes the activity chart; adjacent cards are explicitly current snapshots or recent-200 audit summaries.
- No fabricated previous-period production line, trend arrows or miniature production sparklines. Empty measured history remains zero; demo samples are deterministic, overlap consistently across ranges and are explicitly labeled illustrative.
- Meaningful SVG/table SSR remains. No `suppressHydrationWarning`, dashboard SSR removal or hide-until-mount workaround was introduced.

Implementation: `packages/core/src/activity.ts`, `packages/db/src/activity.ts`, `apps/web/lib/dashboard.ts`, `components/activity-chart.tsx`, `overview.tsx`, shared relative-time consumers. Tests cover UTC/Berlin midnight, 23/25-hour Berlin DST days, actual previous values, JSON round trips, range alignment, SQL scoping and fallback zones.

**Actual browser verification:** production Next server in **TZ=UTC**, configured guild **Europe/Berlin**, browser contexts **America/Los_Angeles** (`2026-03-08T09:59:59Z`), **Asia/Tokyo** (`2026-10-25T01:30:00Z`) and **Pacific/Kiritimati** (`2030-01-01T10:01:00Z`). Tests intercept the original SSR HTML, wait for real hydration, and compare serialized reference, labels and values; then exercise metric/range/table controls. No hydration/page errors occurred. The **client clock** was fixed, not the production server clock; exact server-side DST boundaries were additionally checked in unit/database fixtures. This is a demo-data hydration verification, not a claim about a deployed guild's historical data quality.

## 4. Least-privilege setup and useful existing-module improvements

The complete code-derived matrix, failure/conditional notes, authorization layers and Docker-only setup commands are in **[PERMISSIONS.md](PERMISSIONS.md)**. In short:

1. Installation uses **bot + applications.commands**; the new basic posting invite requests **19456 = View Channel + Send Messages + Embed Links**. It does not silently alter existing installations.
2. The actual code intents are Guilds, GuildMembers, GuildMessages, MessageContent, GuildMessageReactions and GuildVoiceStates. **Only Server Members and Message Content have the relevant privileged Portal toggles.** Presence is not requested.
3. Add Manage Roles only for roles/shop rewards; Moderate Members for **warn and timeout in this implementation**; Kick/Ban only if used. Set hierarchy above intended ordinary targets, not indiscriminately above staff. Managed, everyone, equal/higher, elevated and unknown-bit roles cannot become self-assignable. Administrator does not bypass hierarchy/protected-target checks.
4. Check the actual selected text channel's overwrites. Add reaction/history/purge/notification permissions only for their conditional paths. External image embeds need no Attach Files. Inbound HMAC webhooks need no Discord Manage Webhooks.
5. First music test: authorized normal **non-full, non-NSFW voice channel**, View Channel + Connect + Speak; requester in voice; DJ/same-channel restrictions still apply. Stage promotion is unsupported; Move Members is not normally needed.
6. Register commands in the intended scope and verify integration visibility. Dashboard OAuth `identify + guilds` and owner/Manage Server authorization are separate from bot permissions and internal action checks.

**Channels & roles → Permissions** is now a read-only selected-channel check using synchronized effective permission bits, sync timestamps and actual bot-role membership. It distinguishes code-derived requirements, sample data, missing legacy metadata and **synced, not live-audited** grants. It explains role-hierarchy remediation without granting anything. Role/channel/bot-membership events and the existing periodic sync refresh optional metadata in existing JSON columns; there is no database migration. Browser tests verify channel selection, staff protections, no grant/mutation requests and mobile layout.

Overview and existing module pages now derive **Configured / Not verified / Needs setup / Paused** from the existing configuration and synchronized data, with counts, filters, direct remediation links and contextual banners. These are configuration checks, not new persisted status flags or credential/playback certifications. Bot connectivity no longer defaults an absent gateway heartbeat to a green status or zero-ms latency. An uninstalled server’s empty service list now says Status not reported rather than vacuously claiming all systems operational; the server-switcher browser test covers this. Legacy demo metadata never asks for a live bot login.

News has a useful Needs setup filter; missing feed/secret/destination takes precedence over a stale Healthy label, and unchecked configured sources say Awaiting check. Direct source destinations **or** matching enabled routing rules remain valid. Steam/RSS/Atom and signed webhook flows, source terms, retries/dedup/outbox/economy security and demo isolation remain. Blizzard/Wowhead/Mojang remain honest setup-required starters, not guessed feed URLs. Role/moderation/economy/music/deals workflows and their existing create/edit/test/action paths remain in the same application; no pretend features or real-money gambling were added.

## Executed verification

Local environment: **Node 22.22.3, npm 10.9.8, UTC**, installed Next 16.4.3. No local Docker executable, Redis service, live `.env`, bot credentials or authorized guild was available.

| Executed check against the final implementation                  | Result                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                              | Pass — both service and Next TypeScript checks                                                                     |
| `npm run lint`                                                   | Pass                                                                                                               |
| `npm run format:check`                                           | Pass                                                                                                               |
| `npm test`                                                       | **409 passed, 34 files**                                                                                           |
| `DEMO_MODE=true npm run build`                                   | Pass — optimized Next production build and bundled services                                                        |
| `DEMO_MODE=true npm run test:e2e`                                | **26 passed**, real production server, one worker, Chromium 153.0.8010.0; local executable/library overrides below |
| `python3 -m unittest discover -s docker/lavalink -p 'test_*.py'` | **7 passed**, offline artifact/packaging tests                                                                     |
| `npm audit --omit=dev --audit-level=moderate`                    | **0 production vulnerabilities** at the time of the check                                                          |
| `git diff --check`                                               | Clean                                                                                                              |

The local browser run used a temporary, ignored `@sparticuz/chromium@153.0.0` extraction (not a dependency/lockfile change), with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `LD_LIBRARY_PATH` pointing into `.cache/browser/runtime`. Normal developer/CI setup remains `npx playwright install --with-deps chromium`. Reproduction and optional host-Node prerequisites are in [DEVELOPMENT.md](DEVELOPMENT.md); Docker-only users use Compose directly, with npm inside the images, not host-side npm wrapper scripts.

Local database tests use PGlite unless `TEST_DATABASE_URL` selects actual PostgreSQL. The existing [CI workflow](https://github.com/dcizov/discordjs-starter/actions/workflows/ci.yml) runs tests against PostgreSQL 17, production browser checks, application/dev images, pinned plugin build/runtime/readiness, isolated real-queue smoke and the Dev Container contract. **Those container/live-service checks were not run locally in this Docker-less sandbox.** Current branch/run status must be read from GitHub Actions; a successful parent run is not evidence for changed code. CI's network-isolated backend readiness test is still not Discord/provider playback.

## Remaining authorized deployment checks

- Update the intended checkout without discarding local edits; build/recreate the intended Compose services; check bind mounts/image revision and that exactly one intended gateway process uses the bot identity. Do not kill unrelated processes or dump environments/secrets.
- Confirm actual Portal privileged settings, command registration/integration overrides, installed role hierarchy and selected-channel overwrites. Refresh sync before trusting previously unknown permission metadata.
- Run the REST-only music doctor in the bot's network, then an authorized clean voice test. Use the structured failed stage to distinguish gateway acknowledgement, Lavalink player creation, provider resolution and actual audible playback. A healthy dependency is not proof of the next stage.
- Request a new deal reply to verify current artwork/no IDs. Check live ITAD mappings/region/package entitlements rather than rewriting supplied prices. Confirm workers, source signing/feed configuration and explicit authorized delivery tests where needed.
- No production messages/audio, privileged grants, live moderation, volume resets or credential changes were performed by this review. Any full live guild audit or successful playback claim remains outstanding until actually tested.

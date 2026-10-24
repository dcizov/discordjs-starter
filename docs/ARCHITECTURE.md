# Architecture

## Service boundaries

```text
Browser ── session cookie ── Next.js web
                               │
                               ├─ Discord OAuth2: identify + guilds
                               ├─ PostgreSQL: scoped configuration, history, sessions
                               └─ Redis: limits + discord-actions queue
                                                 │
Discord Gateway ── Discord.js bot ────────────────┘
                       │
                       ├─ role / moderation permission and hierarchy checks
                       ├─ PostgreSQL atomic economy transactions
                       └─ Shoukaku ── Lavalink v4 ── enabled audio sources

Background worker ── reconcile schedules every minute
       │
       ├─ community-jobs: poll Steam / verified RSS / IsThereAnyDeal
       ├─ PostgreSQL: unique event + destination reservation (outbox)
       └─ community-jobs: Discord delivery, retry/backoff, persisted result

Signed incoming webhook ── web ── same durable delivery outbox
```

`packages/core` owns validation, types, permission policy, URL/network policy, external-content handling, feed adapters, job construction, and logging. `packages/db` owns storage, SQL transactions, tenant predicates, source dispatch, demo persistence, and query pagination. The browser imports shared types and browser-safe pure policy/helpers, never database clients or credentials.

## Authorization and sessions

OAuth uses the authorization-code flow with a cryptographically random, expiring state cookie. The browser receives a random opaque session identifier, not an OAuth access token. Only its SHA-256 hash is stored. OAuth access/refresh tokens and incoming webhook secrets are authenticated-encrypted using AES-256-GCM with `APP_SECRET`.

Each protected API action resolves the current session and verifies the requested guild against the Discord-managed guild list. Mutating requests bypass the positive read cache and verify permissions against Discord; concurrent checks for the same session/token share an in-flight lookup. Reads cache a successful list for at most 30 seconds. The bounded permission cache and in-flight registry are shared across page/API bundles and Next development reloads within a Node process. Discord rate-limit timing is honored, known-exhausted buckets are not immediately queried again, and failed verification invalidates the prior snapshot instead of authorizing with stale data. Repository reads and writes independently include the guild predicate. Knowing a UUID is not authorization. Bot execution re-fetches members and re-checks Discord permissions, role hierarchy, module state, and voice context.

## Configuration propagation

- Config updates and their audit records commit in one PostgreSQL transaction.
- Role panels, shop items, rules, subscriptions, source and routing definitions use shared Zod schemas.
- Configuration is read before every command, role assignment, music action, and eligible message.
- Worker schedules are reconciled every 60 seconds. Already-queued jobs also check installed/module/source state before execution.
- Bot metadata snapshots sync on role/channel events and every five minutes. Assignment checks use fresh Discord role/member data, not the dashboard snapshot.
- The web refreshes workspace snapshots every 30 seconds. Mutations refresh affected data immediately; safe configuration switches update optimistically and roll back on error.

## Economy invariants

All production economy mutations use the same PostgreSQL transaction-scoped advisory lock for the guild. This is intentionally conservative: transfers are serialized within a guild, eliminating cross-account deadlocks and races. Accounts are additionally read `FOR UPDATE`.

Inside the transaction:

1. Validate amount, module state, and operation type.
2. Check the unique `(guild_id, idempotency_key)` operation receipt; identical retries return the original result. Reusing a key with a different payload is rejected.
3. Validate a rolling 24-hour daily claim, activity cooldown, sufficient funds, maximum safe balance, shop state/stock, and existing role entitlement.
4. Write the account changes, operation receipt, immutable-through-the-API ledger entries, stock, and inventory together.

Transfers have equal/opposite ledger entries. SQL constraints disallow negative balances and balances above the safe configured ceiling. No browser-provided user ID selects the sender: the authenticated identity does. Shop role delivery happens after committing the entitlement. `/shop claim` can restore it without a second debit if Discord is unavailable.

For very large/high-throughput guilds, replace the per-guild lock with ordered per-account locks while preserving idempotency and the full transaction boundary. Do not add direct balance writers outside this service.

## Durable deliveries

An event is reserved in PostgreSQL using a unique `(guild_id, source_id, external_id, channel_id)` index. Both direct source destinations and routing rules feed this same outbox. Multiple routes to the same destination produce one reservation. Item metadata and embed options are persisted with the reservation.

After reserving, a stable BullMQ delivery job is enqueued. If Redis fails between insertion and enqueue, the minute reconciler re-enqueues pending/sending outbox records. The delivery worker holds a transaction-scoped lock for the reservation, uses a stable Discord nonce with `enforce_nonce`, and commits the successful result and audit record. Failed attempts persist their error and retry with exponential backoff. The fifth exhausted attempt is shown as failed; failed records are retained for investigation rather than silently discarded.

This provides application-level deduplication and at-least-once processing. A crash after Discord accepts a message but before PostgreSQL commits can require retrying the external call. Discord nonce protection narrows that window but is time limited. Exactly-once semantics across that boundary are not promised.

Keep Redis AOF persistence and `noeviction`. Keep completed job metadata for the configured retention period. Back up PostgreSQL; do not remove delivery uniqueness rows to “clear the queue.”

## Source polling and routing

- One repeatable BullMQ scheduler per enabled source or deal subscription.
- Minimum intervals: RSS/Steam 5 minutes, deals 15 minutes. Defaults are more conservative.
- First successful poll queues at most three recent items; later polls consider the last seven days and rely on durable event identity.
- Source keywords match any literal case-insensitive substring in title/summary.
- Source tags are labels. Routing tags match any event/source tag; route keywords are an additional condition.
- An explicit route may override embed/notification options for a shared destination. If multiple routes target the same channel, the final matching route’s options win; avoid ambiguous routing configurations.
- The Steam adapter uses the publisher’s `gid`; RSS/Atom uses GUID/ID, then URL, then a deterministic title/date fallback. Providers should publish stable IDs.
- Content is stripped of HTML, limited in length, and prevents automatic mass/user mentions. Allowed Discord mentions contain only the configured notification role.

## Data and scaling

PostgreSQL tables include guilds, typed JSON resources, accounts, economy operations, ledger, inventory, deliveries, service heartbeats, OAuth sessions, webhook secrets, and audit logs. Drizzle SQL migrations and metadata are tracked.

History lists use bound SQL parameters, guild predicates, server-side filtering/search, bounded page sizes, and totals. Dashboards contain recent snapshots for compact widgets; they do not load all historical rows into a browser. Add indexes or full-text search for very large installations after measuring actual queries.

Run one bot process per assigned Discord shard/guild ownership. Multiple background workers may share BullMQ. Live web replicas share PostgreSQL/Redis. The demo is **not** a distributed database and must remain single-process.

## Server-serialized activity and render time

`loadDashboard` captures one `presentation.referenceAt` before assembling a guild-authorized snapshot. `packages/core/src/activity.ts` builds `presentation.activity` on the server: canonical guild IANA timezone, 7/14/30-day windows, calendar keys, English display labels, current counts and real preceding-period counts. Default guild configuration uses Europe/Berlin. Missing/invalid legacy zones and ambiguous numeric offsets fall back to UTC; neither server nor browser host timezone is a fallback.

`packages/db/src/activity.ts` aggregates the full bounded **60-calendar-day** activity-reward ledger window with PostgreSQL `AT TIME ZONE`, `count(*)` and `count(distinct user_id)`. A conservative indexed UTC lower bound plus exact zoned calendar-key filtering includes 23/25-hour DST days. It is independent of the compact dashboard's latest-200 ledger history. Only type `activity`, the authorized guild and timestamps no later than the reference instant qualify; transfer debit/credit legs, purchases and daily rewards are excluded. The economy code records one committed row per activity reward, not one row per arbitrary message.

Calendar arithmetic shifts date fields/keys, **not fixed 86,400,000-ms offsets between local midnights**. Display labels format those same keys in UTC rather than interpreting them in a browser timezone. Each prior-period point is measured from the corresponding earlier calendar date; absent rows are zero, not a fabricated/scaled curve. Rewarded members are distinct recipients **within each day**, not a total-members metric or a deduplicated whole-period sum. Today is explicitly partial.

`ActivityChart` reads the serialized object unchanged in SSR and the first client render, including initial metric/range state. All range data is supplied, so choosing 14/30 days changes the actual number of days/points/table rows, not a cosmetic multiplier over seven points. A daily-values table and keyboard-focusable points accompany the chart. There is no client-clock initialization, browser-generated date label, dashboard SSR disable, hide-until-mount fix, or hydration-warning suppression in this change. Existing refresh behavior fetches a **new complete server snapshot** after hydration. Nearby relative times and daily-ready UI use the same server reference; the backend remains authoritative for the rolling 24-hour daily cooldown.

Demo samples are deterministic per calendar key and explicitly illustrative. Production does not reuse demo chart curves/sparklines or invent previous history; current stats and recent audit counts are labeled separately from the activity date range. Existing message/command/member totals are not inferred from reward rows.

Tests cover UTC/Berlin/New York calendars, midnight, spring/fall DST, leap/year boundaries, real ranges/prior counts, tenant isolation, >200 SQL rows and actual production-built Next SSR/hydration. Playwright explicitly runs the web server in UTC and browsers in Los Angeles, Tokyo and Kiritimati with different fixed browser clocks (including DST transition instants and a different year), comparing the HTML's serialized chart attributes to the hydrated DOM and checking for hydration errors. It does not claim the server's wall clock itself was changed to a historical DST instant; that boundary arithmetic is tested directly in unit/SQL fixtures.

## Synced permission/setup metadata

Guild role/channel JSON already exists. New optional role-membership and channel-effective-bitfield/timestamp fields extend it without a migration or a second configuration store. `syncGuild` uses Discord.js `permissionsFor(me)` after refreshing roles/channels, distinguishes normal voice from unsupported Stage/forum/category destinations, and includes View Channel in voice access. Old records remain readable and show unknown until refreshed. Bot role-membership events, role/channel events and scheduled sync update the snapshot.

`permissions.ts` is browser-safe policy shared by enforcement and the read-only setup UI. Known sensitive/elevated and unknown future permission bits fail closed for self-role/shop claims; benign nonzero bits are not falsely labeled elevated. `module-setup.ts` derives guidance from existing module flags/resources/integration presence/health/synced metadata and persists nothing. “Configured”, “Needs setup”, “Not verified” and “Paused” are not live-delivery or playback certifications. All existing server/actor authorization and Discord execution checks remain in force. See [the exact permission matrix](PERMISSIONS.md).

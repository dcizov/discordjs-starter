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

`packages/core` owns validation, types, permission policy, URL/network policy, external-content handling, feed adapters, job construction, and logging. `packages/db` owns storage, SQL transactions, tenant predicates, source dispatch, demo persistence, and query pagination. The browser imports shared **types**, never database clients or credentials.

## Authorization and sessions

OAuth uses the authorization-code flow with a cryptographically random, expiring state cookie. The browser receives a random opaque session identifier, not an OAuth access token. Only its SHA-256 hash is stored. OAuth access/refresh tokens and incoming webhook secrets are authenticated-encrypted using AES-256-GCM with `APP_SECRET`.

Each protected API action resolves the current session and verifies the requested guild against the Discord-managed guild list. Mutating requests refresh permissions against Discord immediately; reads cache the list for at most 30 seconds. Repository reads and writes independently include the guild predicate. Knowing a UUID is not authorization. Bot execution re-fetches members and re-checks Discord permissions, role hierarchy, module state, and voice context.

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

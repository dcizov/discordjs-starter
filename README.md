# Orbit

**A little less managing. A lot more community.**

A Discord community bot and responsive configuration dashboard, built on **Discord.js, TypeScript, Next.js App Router, Tailwind, shadcn-style Radix UI components, PostgreSQL/Drizzle, Redis/BullMQ, and Lavalink v4/Shoukaku**.

This is an executable monorepo, not a collection of dashboard mockups. Demo mode is deliberately isolated from live Discord and third-party services. Live operation requires your own application, API credentials, infrastructure, and appropriate Discord permissions.

## Try it without credentials

Requires Node **22.14+** and npm 10+.

```sh
npm ci
npm run dev
# http://localhost:3000
```

Development defaults to demo **only if no Discord client ID is configured**. To choose the mode explicitly:

```sh
cp .env.example .env
# Keep DEMO_MODE=true
npm run dev
```

The root `.env` is loaded by all three services. Never use `NEXT_PUBLIC_*` for tokens or keys.

### What the demo does

- Saves panel, rule, shop, source, routing, subscription, and settings changes in `.data/demo.json`.
- Supports daily rewards, double-entry transfers, purchases, stock limits, and idempotency in a serialized, persistent **single-process** demo store.
- Simulates publication, test deliveries, health metrics, and queue controls.
- Includes a populated community, an empty workspace, and a community that requires an invitation.
- Does **not** authenticate a real account, fetch external feeds, connect to Discord, moderate real people, register commands, accept live webhooks, or play audio.

The demo banner and player identify simulation. Activity charts and health are sample data, not production telemetry. To reset only the demo, stop the web process and remove `.data/demo.json`. Set `DEMO_DATA_PATH` to an absolute path to keep separate demo installations. Do not run multiple web replicas against this file; use PostgreSQL in live mode.

For a production-built demo:

```sh
npm run build
DEMO_MODE=true npm start
```

## What’s implemented

| Area        | Workflows                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self roles  | Buttons, selects, reaction panels; single/multi selection; prerequisites; exclusive roles; role limits; preview, publication, and safe reassignment                                                                                         |
| Moderation  | Warnings, timeouts, kicks, bans, recent-message purges, case history, spam/repetition/mention/blocked-term rules, exemptions, escalation, audit channel                                                                                     |
| Economy     | Per-guild balances, rolling daily rewards, activity rewards/cooldowns, transfers, leaderboard, role/item shop, inventory, reclaimable role entitlements, atomic PostgreSQL ledger                                                           |
| Music       | Discord voice playback through Lavalink, supported-source search, persistent dashboard snapshots, queue, pause/resume/skip/stop, volume, shuffle, repeat, DJ restrictions                                                                   |
| Game deals  | IsThereAnyDeal search, shared game watchlists and general deal feeds; region/currency/shop/price/discount/historical-low filters; deduplicated alerts                                                                                       |
| News        | Official Steam app-news adapter; configurable RSS/Atom and signed webhooks; honest setup-required Blizzard/Wowhead/Mojang starters; keyword/tag routing, interval schedules, health, tests, delivery history                                |
| Dashboard   | OAuth2, manageable-server switcher, installed/invite distinction, responsive light/dark UI, configuration CRUD, validation, confirmations, search, server-paginated histories, loading/error/empty states, toasts, safe optimistic switches |
| Reliability | Separate services, migrations, transactional outbox, retry backoff, stable delivery keys, Discord nonce suppression, structured logs, configuration audits, SSRF protection, bounded XML/body parsing, sanitized content, explicit mentions |

## Run live

### 1. Create your Discord application

In the Discord Developer Portal:

1. Create an application and bot. Put its client ID, client secret, and bot token in `.env`.
2. Enable **Server Members Intent** and **Message Content Intent**. These are needed for member checks, automoderation, activity rewards, and optional reaction roles. Large/verified bots may need Discord approval.
3. Add the exact OAuth redirect: `http://localhost:3000/api/auth/callback` locally, or `https://your-domain/api/auth/callback` in production.
4. Set `DEMO_MODE=false`. Generate a strong application secret:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. Set `APP_SECRET` to that value and `APP_URL` to the public origin, without a trailing slash. Public live deployments require HTTPS. HTTP localhost is allowed for development.

### 2. Start PostgreSQL and Redis

```sh
docker compose up -d --wait postgres redis && npm run db:migrate
```

Orbit uses a dedicated `orbit_pgdata_v17` named volume. The original starter's `pgdata` volume is not reused, upgraded, or deleted: it used PostgreSQL 18 and a different mount layout. See [startup troubleshooting](docs/DEPLOYMENT.md#local-startup-troubleshooting) if you are updating an existing checkout.

The supplied local connection strings match the default Compose credentials. Change the database password for deployment, and update the password in `DATABASE_URL` to match. Changing `POSTGRES_PASSWORD` after a database has initialized does not rotate the existing database password. Redis is private to the containers and exposed only on loopback for local development.

Do **not** seed production. Live guilds are created and synchronized when the bot joins. `ALLOW_DEMO_SEED=true npm run db:seed` is only for a disposable development database; demo mode does not need this command.

### 3. Register slash commands

```sh
npm run commands:register
```

Set `DISCORD_GUILD_ID` for quick development-server registration. Leave it empty for global registration. This replaces the commands in the selected scope. If you later change scope, remove obsolete guild commands explicitly in your Discord application tooling to avoid duplicate commands.

### 4. Run the three services

In three terminals:

```sh
npm run dev        # dashboard :3000
npm run dev:bot    # Discord gateway + command handler + dashboard-action worker
npm run dev:worker # schedules, feeds, deals, and outbound deliveries
```

Sign in with Discord. Only communities you own or have **Manage Server / Administrator** permission for appear. Choose a community and click **Invite Orbit** if it is not installed. The invite does not request Administrator or Mention Everyone. Place Orbit above the community roles it will assign.

Configuration is read on every bot action/message; feed schedules are reconciled every minute. No bot restart is required. Channel and role metadata syncs on Discord events and every five minutes.

### 5. Configure optional integrations

- **Deals:** set `ITAD_API_KEY`. See [integration guide](docs/INTEGRATIONS.md).
- **Music:** configure a current Lavalink v4 server and supported sources. See [music guide](docs/MUSIC.md). Playback from arbitrary providers is not promised.
- **RSS/Atom:** enter a verified publisher URL. The bot never guesses feed URLs or scrapes sites.
- **Webhook:** create an incoming-webhook source, save it, then use **Webhook credentials** to generate a secret. See the signed request example in the integration guide.

## Docker Compose

```sh
# Demo web + local data services; no live bot or worker is started.
docker compose up -d --build

# Live, after configuring .env with DEMO_MODE=false and real credentials:
docker compose --profile live run --rm migrate
docker compose --profile live up -d --build

docker compose --profile live run --rm bot node dist/register.js

# Optional music server, after setting LAVALINK_PASSWORD in .env:
docker compose --profile music up -d lavalink

docker compose logs -f web bot worker
```

In containers, the database and Redis hosts are `postgres` and `redis`; Compose overrides the host connection URLs. Lavalink is `lavalink:2333` inside Compose and `localhost:2333` for a host-run bot; the optional music service publishes its port only on `127.0.0.1`, not publicly. Choose a strong Lavalink password and set it consistently in `.env`. Music connections are disabled by default in `.env.example`: leave both `LAVALINK_URL` and `LAVALINK_PASSWORD` empty if you are not using music.

Docker images run as the unprivileged `node` user. Compose uses an init process and graceful stop periods. PostgreSQL and Redis use persistent volumes. `.data`, credentials, dependencies, browser artifacts, and build outputs are not committed.

The schema is a new baseline for this expanded application, not an in-place migration of a previously deployed standalone starter. Back up an existing installation and plan data import before replacing it.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm audit --omit=dev
npm run build

# Browser tests use a built server or reuse a running development server.
npx playwright install chromium
npm run test:e2e
```

Local SQL tests run **real PostgreSQL in WASM (PGlite)**, without Docker or live credentials. CI also runs these tests against a dedicated PostgreSQL 17 service with the `pg` driver:

```sh
TEST_DATABASE_URL=postgres://.../dedicated_test_db npm test
```

Never point `TEST_DATABASE_URL` at a production database. Tests create and delete test guilds. Coverage includes authorization permission bits, protected role assignment/removal, hierarchy, prerequisites, exclusive groups, atomic/idempotent rewards, concurrent transfers and purchases, stock, rollback, cooldowns, SQL balance constraints, per-guild isolation, feed deduplication, bounded source validation, and signed webhooks. Browser tests exercise persistent CRUD, settings, simulated messages, economy, music controls, CSRF, invite states, and mobile layout.

## Repository map

```text
apps/
  web/                 Next.js App Router, OAuth, protected HTTP API, dashboard
  bot/src/             Discord.js gateway, slash commands, role/mod/music handlers
  worker/src/          BullMQ poll/delivery worker and schedule reconciliation
packages/
  core/src/            Shared types, Zod schemas, config, safety, feeds, jobs, logging
  db/src/              Drizzle schema, repositories, transactions, outbox, demo store
Drizzle migrations:    drizzle/
Infrastructure:       Dockerfile, docker-compose.yml, docker/lavalink/
Tests:                tests/ (unit/SQL), tests/e2e/ (Playwright)
```

See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [integration details](docs/INTEGRATIONS.md), [music setup](docs/MUSIC.md), and [deployment checklist](docs/DEPLOYMENT.md).

## Honest operational boundaries

- You must validate your application, intents, channel permissions, API keys, region/store choices, and voice backend in a real test server before a public launch. Automated tests do not impersonate a live Discord installation.
- The dashboard’s live activity chart derives from recent stored activity rewards; it is not a historical unique-online-member analytics system. Demo analytics are illustrative.
- Overview widgets use recent snapshots; the audit, case, transaction, and delivery tables query the full server-isolated history with server-side search and pagination. The leaderboard shows the top 100; the signed-in wallet is fetched independently so balances outside the top 100 remain accurate.
- Schedules are elapsed-minute polling intervals, not a cron/calendar editor. Webhooks are event driven. Workers perform a small first-run backfill and do not replay an entire publisher archive.
- Shared watchlists are server subscriptions, not unsolicited personal DMs. Currency matches the upstream regional quote; there is no conversion engine.
- Non-role shop items are persistent inventory entitlements. Custom real-world perk fulfillment is an administrator responsibility. No cash value, gambling, or payment processing is provided.
- Audio playback lives in Discord. Queue snapshots persist for observation, but voice sessions are not automatically restored after a complete bot restart. Submit `/play` to start a new session.
- Delivery processing is at-least-once with durable deduplication and Discord nonce protection. No integration can honestly guarantee exactly-once delivery across a process crash and a nontransactional external API; see architecture notes.

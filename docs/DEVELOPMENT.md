# Full-stack development in Docker

This runs the **dashboard, Discord bot, background worker, PostgreSQL, Redis, and Lavalink** together. The web app uses Next development mode; the bot and worker use `tsx watch`. Source changes are bind-mounted, so ordinary code edits do not need an image rebuild. Use a dedicated Discord application/test server: **development mode is not demo mode**, and real messages/moderation/audio actions are possible.

The base `docker-compose.yml` still uses production builds. `docker-compose.dev.yml` is an explicit override; do not use it for public production deployment.

## 1. Prepare your local environment

Use Docker Engine/Desktop with Compose **v2.24+**. No host Node/npm installation is required. Allow enough Docker memory for Next, the Node processes, and Java (at least 4 GB is a useful starting point).

Run from the repository root. Keep your existing `.env`; copy the template only if the file does not exist:

```sh
[ -f .env ] || cp .env.example .env
```

Configure these values **locally**, never in chat or Git:

```dotenv
DEMO_MODE=false
APP_URL=http://localhost:3000
APP_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
DISCORD_CLIENT_ID=YOUR_TEST_APPLICATION_ID
DISCORD_CLIENT_SECRET=YOUR_TEST_APPLICATION_CLIENT_SECRET
DISCORD_TOKEN=YOUR_TEST_BOT_TOKEN
DISCORD_GUILD_ID=YOUR_TEST_SERVER_ID
ITAD_API_KEY=YOUR_IS_THERE_ANY_DEAL_KEY
LAVALINK_URL=localhost:2333
LAVALINK_PASSWORD=YOUR_STRONG_LAVALINK_PASSWORD
LAVALINK_SECURE=false
MUSIC_SEARCH_PREFIX=scsearch
MUSIC_ALLOWED_HOSTS=soundcloud.com,bandcamp.com
```

These are placeholders, not working credentials. To generate an application secret without installing Node on your host:

```sh
docker run --rm node:22-bookworm-slim node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the existing `POSTGRES_PASSWORD` if you already initialized this database. Changing an environment variable does **not** rotate a stored database password. For a new database, choose a strong password; keep the host `DATABASE_URL` password in sync. Compose supplies the internal database/Redis URLs and `lavalink:2333` to containers automatically. The `localhost:2333` value above is for optional host-run utilities, not browser requests or container-to-container access.

In the Discord Developer Portal, enable **Server Members Intent** and **Message Content Intent**. Add the exact OAuth redirect `http://localhost:3000/api/auth/callback`. Set `DISCORD_GUILD_ID` to the test server for quick guild-scoped registration; leaving it blank registers commands globally instead. Registration replaces commands in the selected scope.

Stop any host-run web process using port 3000 and any other instance of this bot/worker. Do not run the host `dev:bot` alongside the Docker bot with the same token. Switching the same Compose project's services between runtime and dev modes recreates those services; it does not require deleting volumes.

## 2. Start every service

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build
```

This builds the Dockerfile's **dev** target, starts PostgreSQL/Redis/Lavalink, applies migrations, and starts the hot-reloading web/bot/worker services. The web app and bot/worker wait for migrations, and Redis readiness is checked. Lavalink can take longer to initialize; inspect its logs before testing audio. The development override intentionally preserves the base PostgreSQL/Redis volumes and the `DEMO_MODE` setting from `.env`—it never silently converts demo mode into a real Discord session.

Register the slash commands from the development container:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run commands:register
```

This utility uses REST only; it does not start a second gateway bot. Re-run it after changing command definitions; hot reload alone does not update Discord's registered commands.

Open **http://localhost:3000**, sign in with Discord, and invite the bot to the test server if necessary. You need ownership, Administrator, or Manage Server access to use its dashboard. Give the bot its required channel permissions and place its role above any roles/members it needs to manage. Administrator is not required.

```sh
# Inspect startup and health; migrate exiting with code 0 is expected.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music ps -a

# Follow all feature-service logs. Ctrl+C exits log following, not the stack.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 web bot worker lavalink
```

## 3. Enable/configure the features

- **Self roles:** create a panel, choose assignable roles, and publish it. Role hierarchy and Manage Roles checks still apply.
- **Moderation/activity rewards:** enable the modules/rules, configure exemptions and audit destinations, and verify the privileged intents and bot permissions. Test only in the development server.
- **Economy:** configure currency, rewards, transfers, and shop items. There is no real-money payment or gambling feature.
- **Deals:** provide a valid `ITAD_API_KEY`, configure watchlists/regions/stores/destinations, and allow the worker's reconciliation cycle to run (approximately once a minute).
- **News:** configure an authorized Steam source, verified RSS/Atom URL, or signed webhook and its destination. Setup-required source starters remain unavailable until configured; no feed URLs are guessed.
- **Music:** enable the module, join a voice channel, and give the bot Connect/Speak access. The supplied backend enables SoundCloud/Bandcamp, not arbitrary YouTube/Spotify playback. Loaded sources, provider restrictions, and current source/voice compatibility still determine whether playback succeeds. Starting the stack does not resolve an upstream source failure.
- **Commands/audit:** use the Commands reference and the audit detail copy controls in the dashboard. The reference is not live registration verification.

For the pending music-source investigation, repeat the failing lookup without playing audio or changing the queue:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run music:doctor -- --query "the same failing search text"
```

See [music setup and troubleshooting](MUSIC.md). Inspect/redact logs and diagnostic output before sharing them; never share `.env`, tokens, or passwords.

## Development lifecycle

**Ordinary source edits:** save on the host. Next hot reloads; `tsx watch` restarts the affected bot/worker process. A bot restart interrupts in-memory voice sessions; queue snapshots are not an automatic voice-session restore. Polling is enabled for Docker Desktop bind-mount reliability. On a native Linux filesystem, you can set `WATCHPACK_POLLING=false` and `CHOKIDAR_USEPOLLING=false` if file events work reliably.

**Environment changes:** container environment variables do not hot reload. Recreate app services to reload `.env`:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --force-recreate web bot worker
```

If the Lavalink password or source configuration changed, restart/recreate Lavalink as well, using the same password on both ends. Do not arbitrarily change `POSTGRES_PASSWORD` for an initialized database.

**Dependency/lockfile changes:** a rebuild alone does not replace dependencies in the persistent `dev_node_modules` volume. Stop the watchers, update that volume once, then rebuild/restart:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music stop web bot worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music build
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps web npm ci --no-audit --no-fund
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d
```

**New SQL migrations:** run the migration service again before using code that depends on the schema:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps migrate
```

**Stop everything without deleting data:**

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music down
```

Do **not** use `down -v` as a troubleshooting shortcut: PostgreSQL, Redis, and development dependency/cache volumes are persistent. The legacy starter's PostgreSQL volume is also not a migration source; see the [deployment guide](DEPLOYMENT.md#local-startup-troubleshooting).

Containers run as the unprivileged `node` user (UID/GID 1000). The dependency and Next-cache volumes are initialized from node-owned image directories. On Linux, ensure that this UID can read the checkout and write generated, ignored web TypeScript metadata; resolve ownership/ACL issues for your development checkout rather than running all services as root or making the repository world-writable.

# Full-stack development in Docker

This is one of the three supported workflows — the other two are the host-Node workflow in the README and the Dev Container. [Development workflows](WORKFLOWS.md) compares them; this page owns the Docker commands.

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

## Dashboard unreachable at localhost:3000

The **`web` service runs the dashboard**. The `bot` service is only the Discord gateway; `worker` handles scheduled jobs. A successful bot login/Lavalink connection does not start an HTTP server.

If you ran `up ... bot lavalink`, the dashboard was intentionally **not started**. Add it (and the scheduled worker) without deleting data or stopping the bot:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build web worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music ps -a web
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 web
```

Wait for Next to report ready, then open **http://localhost:3000**. The web container should be **Up**, with a host mapping like **`0.0.0.0:3000->3000/tcp`**. A bare **`3000/tcp` on `bot`** is just the shared image's `EXPOSE` metadata: no host port was published, and no dashboard is running there. Do not add a port mapping to the bot to fix this.

If `web` exits or restarts, read its logs and migration status rather than resetting the database. If Docker reports port 3000 already allocated, stop the conflicting host process/project; do not delete volumes. For remote Docker, `localhost` in your browser is your own computer, so use SSH/editor port forwarding to the Docker host. The Next dev command already binds `0.0.0.0:3000` inside the container.

For editor-based development, use the checked-in [Dev Container setup](DEVCONTAINER.md): it starts `web` and infrastructure automatically, and opens a separate persistent workspace without automatically logging in a second bot.

### `Module not found: Can't resolve '<package>'` after an update

All third-party dependencies are declared **once** in the root `package.json`
(the workspaces `apps/*` and `packages/*` deliberately have no dependency
blocks). That keeps one hoisted tree and one lockfile, but two provisioning
paths can end up behind the manifest:

- a host checkout that has not run `npm ci` since the manifest changed;
- the Docker dev stack, where `dev_node_modules` is mounted at
  `/app/node_modules`. Docker seeds a named volume from the image **only on its
  first use**, so a volume created by an older image keeps the old tree while the
  image underneath is rebuilt.

The only symptom is a deep build error:

```text
Module not found: Can't resolve 'marked'
Import trace: ./lib/docs-content.ts → ./app/docs/layout.tsx
```

`scripts/check-dependencies.mjs` runs before `dev`, `build:web` and `start`
(about 50 ms), names the missing packages and prints the remedy. It installs
nothing and never edits the lockfile, and it is not a package-manager
replacement: `npm ci` remains the install command.

#### The fix, in order

**Host or CI checkout:**

```sh
npm ci
```

**Docker Compose / Dev Container:** run the same command _inside_ the running
container:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npm ci
# Dev Container: `npm ci` in the workspace terminal
```

This does repair the volume, and the reason is structural rather than
incidental: Compose mounts `dev_node_modules` at **`/app/node_modules`**, which is
exactly the directory `npm ci` installs into, and the bind-mounted checkout
supplies the current `package-lock.json`. There is no separate hidden
`node_modules` for the volume to mask; the volume _is_ the install location.
(Rebuilding the image alone still does nothing to an existing volume — only the
install command does.)

Verified in this repository: a volume-equivalent tree installed from `eeb0e68`
(before `marked` existed) was mounted over a fully installed checkout, which
reproduced `Module not found: 'marked'`; running `npm ci` there installed 628
packages into that tree and the build then compiled. Re-check with
`docs/CONTINUATION.md` before relying on it in a new environment.

**Only if `npm ci` cannot write to the volume** (for example `EACCES`, because a
volume was created by a different user) recreate that one volume:

```sh
docker volume ls | grep dev_node_modules
docker volume rm <compose-project>_dev_node_modules
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The volume name is `<project>_dev_node_modules`, where the Compose project name
defaults to the directory name (or `COMPOSE_PROJECT_NAME`). The new volume is
seeded from the freshly built image. Never delete the database, Redis, demo-data
or Next-cache volumes, and never use `docker compose down -v` for this.

## Run just the main bot

**`bot` is the main Discord gateway process.** With this override it runs `npm run dev:bot` (`tsx watch apps/bot/src/index.ts`), not the compiled production entrypoint. You do not need Node/npm on the host and must not start a second host bot with the same token.

After the `.env` setup above (`DEMO_MODE=false` and the Discord credentials), start only the bot and audio backend:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build bot lavalink
```

Compose starts the bot's PostgreSQL/migration/Redis dependencies too. **This is a headless bot-only command: http://localhost:3000 will not be available unless `web` is already running.** The explicit service list does not start `web` or `worker`; already-running services are not stopped. Scheduled news/deals jobs need `worker`, and the dashboard needs `web`—use the full-stack command above when you want those too. Without music, leave both Lavalink variables empty and omit `lavalink`/`--profile music`.

Register commands and follow the main bot's logs:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run commands:register
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 bot lavalink
```

Save a TypeScript source file on the host to restart the bot watcher. No rebuild is needed for ordinary app edits; environment/dependency changes follow the lifecycle below. A restart interrupts in-memory voice sessions. The audio image includes the pinned Soundy AAC/fMP4 fix; first build needs internet access for its Java dependencies. See [the exact SoundCloud diagnosis and adapter change](MUSIC.md#soundcloud-did-not-detect-any-supported-formats). Start a fresh `/play` session after replacing a source adapter.

## 3. Enable/configure the features

- **Self roles:** create a panel, choose assignable roles, and publish it. Role hierarchy and Manage Roles checks still apply.
- **Moderation/activity rewards:** enable the modules/rules, configure exemptions and audit destinations, and verify the privileged intents and bot permissions. Test only in the development server.
- **Economy:** configure currency, rewards, transfers, and shop items. There is no real-money payment or gambling feature.
- **Deals:** provide a valid `ITAD_API_KEY`, configure watchlists/regions/stores/destinations, and allow the worker's reconciliation cycle to run (approximately once a minute).
- **News:** configure an authorized Steam source, verified RSS/Atom URL, or signed webhook and its destination. Setup-required source starters remain unavailable until configured; no feed URLs are guessed.
- **Music:** enable the module, join a voice channel, and give the bot Connect/Speak access. The supplied backend enables SoundCloud through the pinned Soundy AAC/fMP4 adapter and built-in Bandcamp, not arbitrary YouTube/Spotify playback. Loaded sources, provider restrictions, and current source/voice compatibility still determine whether playback succeeds. Starting the stack does not resolve an upstream source failure.
- **Native polls / one-time announcements:** both are off by default. Apply the additive migration, register the new definitions once, deliberately enable/configure the module and grant only its destination rights (conditional Send Polls for polls). Drafts never auto-publish; the worker/bot must be running for live schedules and retention. See [community setup, UTC examples, privacy and recovery](COMMUNITY.md). Own transaction history, optional requester queue limits and no-send news routing preview are also available without enabling new collection or broad privileges.
- **Commands/audit:** use the Commands reference and the audit detail copy controls in the dashboard. The reference is not live registration verification.

To check the configured music adapter or repeat a failed lookup without playing audio or changing the queue:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run music:doctor -- --query "the same failing search text"
```

See [music setup and troubleshooting](MUSIC.md). Inspect/redact logs and diagnostic output before sharing them; never share `.env`, tokens, or passwords.

## Development lifecycle

**Ordinary source edits:** save on the host. Next hot reloads; `tsx watch` restarts the affected bot/worker process. A bot restart interrupts in-memory voice sessions; queue snapshots are not an automatic voice-session restore. Polling is enabled for Docker Desktop bind-mount reliability. On a native Linux filesystem, you can set `WATCHPACK_POLLING=false` and `CHOKIDAR_USEPOLLING=false` if file events work reliably.

**Content-Security-Policy:** the dev build's policy is deliberately looser than production's — `script-src` includes `'unsafe-eval'` and `connect-src` includes plaintext `ws:`, because Next's dev server serves eval source maps and needs an unencrypted HMR socket. Production omits both. If you tighten the CSP in `apps/web/next.config.mjs`, check `npm run dev` as well as `npm start`: a policy that blocks `eval` breaks the dev server before React hydrates, which looks like "no control responds" rather than a header problem. `tests/csp.test.ts` asserts the two environments differ.

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

## Docker development compared with main

Rechecked the actual [`main@dc9726a`](https://github.com/dcizov/discordjs-starter/tree/dc9726a8aa039c31b5e5be33de738c8c95756710) Dockerfile, Compose file, package scripts and PostgreSQL init script on 2026-10-24. This comparison describes the configurations, not an unperformed fresh build of `main`.

**Neither Docker development workflow needs Node/npm installed on the host.** Docker installs/runs them in its images. This branch deliberately has no npm scripts wrapping Docker Compose; execute Compose directly from the host. The `dev`, `dev:bot`, `dev:worker` and database npm scripts are application commands **inside** the containers (also usable in the separate optional host-Node workflow).

| Area                        | `main`                                                                                                                                                                                      | This branch                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application                 | Standalone Discord bot (`src/index.ts`); no dashboard, scheduled-delivery worker, Redis or Lavalink services                                                                                | Monorepo: `web`, `bot`, `worker`, one-shot `migrate`, PostgreSQL, Redis and optional Lavalink                                                                                                                                                                                    |
| Dev startup                 | `docker compose --profile dev up dev` starts the hot-reloading bot and PostgreSQL                                                                                                           | Combine the base and development override with `--profile live --profile music` for the full stack; see the exact commands below                                                                                                                                                 |
| Meaning of `dev`            | The `dev` service itself runs `npm run dev` → `tsx watch src/index.ts` (the bot)                                                                                                            | The `dev` service is an idle editor/toolbox (`sleep infinity`), not another bot. Hot-reloading apps run in `web`/`bot`/`worker`; `npm run dev` means Next.js                                                                                                                     |
| Node/image                  | Declares Node `24.21.0`, Debian trixie-slim                                                                                                                                                 | Node `22` image, Debian bookworm-slim; no version upgrade is part of this change                                                                                                                                                                                                 |
| Hot reload                  | Bind-mounts only `./src:/app/src`; `tsx watch` watches the bot                                                                                                                              | Bind-mounts the full checkout at `/app`; Next watches web code, `tsx watch` watches bot/worker                                                                                                                                                                                   |
| Dependencies/config changes | Dependencies and TypeScript config are copied into the image. `develop.watch` declares package/lockfile rebuilds, but that requires Compose watch mode; plain `up dev` does not activate it | Linux `node_modules` lives in a shared named volume; Next has a separate cache volume. Source/config edits are visible, but dependency changes still require the documented **container-side** `npm ci` refresh; rebuilding alone does not replace a populated dependency volume |
| File watching               | `CHOKIDAR_USEPOLLING=false`                                                                                                                                                                 | Polling defaults on for Next and bot/worker, configurable for bind mounts across Docker Desktop/remote filesystems                                                                                                                                                               |
| Database/data               | PostgreSQL `18-alpine`, database `bot` plus first-init `bot_test`; `pgdata:/var/lib/postgresql`                                                                                             | PostgreSQL `17-alpine`, database `orbit`; separate `orbit_pgdata_v17:/var/lib/postgresql/data`. Old data is not imported or reused automatically                                                                                                                                 |
| Readiness/migrations        | PostgreSQL `pg_isready`; no Compose migration service/gate. README documents a separate schema migration step                                                                               | Authenticated TCP `SELECT 1`; migration service waits for PostgreSQL, and dev apps wait for successful migrations and Redis readiness. Optional music also checks authenticated Lavalink readiness before bot startup                                                            |
| Host ports                  | Publishes database port `5432` on all host interfaces by default; no web service/port                                                                                                       | Dashboard publishes `3000`; PostgreSQL `5432`, Redis `6379` and Lavalink `2333` are bound only to host loopback                                                                                                                                                                  |
| Dev Container               | Not provided on `main`                                                                                                                                                                      | Persistent unprivileged editor workspace; starts web/infra without logging in a duplicate bot/worker                                                                                                                                                                             |
| Default/base Compose        | Runs the production bot and PostgreSQL; `.env` is required for the runtime bot                                                                                                              | Default is isolated demo web/infra; live bot/worker and music are explicit profiles. The dev override selects source/hot-reload commands instead of runtime bundles                                                                                                              |

The main branch's `docker compose --profile dev up dev` is therefore **not equivalent** here: this branch's `dev` is a toolbox, not the gateway bot or dashboard. Use the actual application services/full-stack command:

```sh
# Docker host; existing live .env configured. No host npm invocation.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 web bot worker lavalink
```

Compose/image commands such as `command: ["npm", "run", "dev:bot"]` or `docker compose ... run --rm --no-deps bot npm run commands:register` execute npm **inside Node containers**, not on the host. Node, Git and developer tools used in the editor also come from its dev image. No Docker socket/CLI is required inside the application containers.

**Do not switch the PostgreSQL tag or reuse `pgdata` to make the branches match.** PostgreSQL 18 → 17 is not an in-place downgrade, the volume layouts differ, and Orbit's application schema differs too. Keep old volumes/backups and plan an explicit import if needed; these configuration differences do not imply an automatic version change or data migration.

The previously reviewed [`arena/752cdf1a-discordjs-starter@2ed0fec`](https://github.com/dcizov/discordjs-starter/tree/2ed0fecbe66a33228a10d1e2acbc7e5d7b6e8615) has a separate editor setup. Its persistent-workspace/shared-Linux-dependency ideas informed this branch, but it should not be confused with the `main` configuration compared above.

Sources on the pinned main revision: [Compose](https://github.com/dcizov/discordjs-starter/blob/dc9726a8aa039c31b5e5be33de738c8c95756710/docker-compose.yml), [Dockerfile](https://github.com/dcizov/discordjs-starter/blob/dc9726a8aa039c31b5e5be33de738c8c95756710/Dockerfile), [package scripts](https://github.com/dcizov/discordjs-starter/blob/dc9726a8aa039c31b5e5be33de738c8c95756710/package.json), [database init](https://github.com/dcizov/discordjs-starter/blob/dc9726a8aa039c31b5e5be33de738c8c95756710/docker/postgres/init.d/01-databases.sql).

## Permission and deployment checks after this update

Follow [the least-privilege setup guide](PERMISSIONS.md), not the Portal's invite permission calculator as a live audit. New invitations request basic text posting only; feature permissions are conditional grants in Discord. No existing role/overwrite is silently modified. The permission screen expands existing synced JSON metadata and needs no database migration/reset; wait for the intended bot to sync old records.

The current deal reply style removes UUID fields even from `/deals info`, removes Game deals headings/counters, and uses large provider artwork independently of concise fields. If a **fresh** reply still has those old elements, compare your checkout/head and bot logs, rebuild/recreate the intended service and inspect bind mounts. `up --build` does not fetch Git. Older already-sent messages are not rewritten. This presentation-only change does not alter slash definitions; re-register only if your deployment predates title autocomplete or other command definition updates.

Do not start a second bot in the editor while Compose already owns the gateway. The doctor/registration are read-only/REST-only with respect to Discord gateway login. See [the implementation review](IMPLEMENTATION-REVIEW.md) for verified tests, reference-license research and live-integration limits.

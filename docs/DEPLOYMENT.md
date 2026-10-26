# Deployment checklist

## Before launch

- [ ] Node 22.14+, PostgreSQL 17+, Redis 7+, and optional current Lavalink v4 are available **inside containers**, or installed for the non-Docker workflow. Docker hosts do not need Node/npm installed.
- [ ] `DEMO_MODE=false` is explicit on all live services; demo mode is never used as authentication.
- [ ] Discord application, OAuth callback, bot token, members/message-content intents, and command registration are configured.
- [ ] `ORBIT_SOURCE_REF` (optional) is the commit id you deployed, so the docs
      pages' "view the source" link points at the code that is actually running.
      Pass it at build time (`docker build --build-arg ORBIT_SOURCE_REF=$(git rev
    parse HEAD)`, or `ORBIT_SOURCE_REF=…` before `npm run build`); unset links
      to `main`. It is a build-time value, never read from a request.
- [ ] `APP_URL` is the actual HTTPS origin (no trailing slash), proxy forwards trusted headers, secure cookies are enabled, and `APP_SECRET` is at least 32 random characters.
- [ ] Database/Redis/Lavalink credentials are strong and held in a secret manager or protected environment files. No `NEXT_PUBLIC_*` secret variables exist.
- [ ] Database, Redis, and Lavalink are private. Worker and audio egress cannot reach metadata/private networks.
- [ ] Migrations have been applied **before** routing live traffic. Backups and recovery have been tested.
- [ ] Minimal posting invite (`19456`) and only needed feature grants are reviewed using [PERMISSIONS.md](PERMISSIONS.md); bot hierarchy, channel overwrites, notification-role mentionability, and moderator hierarchy are tested in a staging guild. No Administrator default.
- [ ] `ITAD_API_KEY` is present if deals are enabled, quotas allow the chosen intervals, and region/currency/store mappings are verified.
- [ ] Publisher URLs are verified and authorized. Blizzard/Wowhead/Mojang starters are either configured or left paused/setup-required.
- [ ] Music sources and the current voice protocol/encryption are verified against your installed Lavalink release and provider terms.
- [ ] Apply additive `0002_community_posts.sql` before updated bot/web/worker services; do not reset/seed existing data. Polls/announcements default off, including legacy JSON. Register new command definitions in the intended scope, deliberately grant Send Polls only where needed, and keep the bot consumer plus worker running for scheduled execution/retention. Review [community privacy/recovery](COMMUNITY.md).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm audit --omit=dev`, and `npm run build` pass.

## Build and run without Docker

```sh
npm ci
npm run build
npm run db:migrate
npm run commands:register

# Separate supervised services, with the same protected live environment:
npm start
npm run start:bot
npm run start:worker
```

The service bundles are `dist/bot.js`, `dist/worker.js`, `dist/register.js`, `dist/migrate.js`, and the read-only `dist/export-channels.js` (channels or `--roles-only`) and `dist/music-doctor.js` developer CLIs. Web artifacts are in `apps/web/.next`. Production dependencies must include the root npm workspace packages. The supplied Dockerfile builds and assembles these paths correctly, including workspace manifests for `npm ci`.

Use a service supervisor/container orchestrator, restart on failure, and allow at least 30 seconds for worker/job shutdown. For scaling, run one gateway owner per Discord shard assignment, any number of BullMQ workers, and multiple live web replicas backed by the same PostgreSQL/Redis. Do not share a demo JSON store across replicas.

## Local startup troubleshooting

### PostgreSQL is unhealthy: data directory exists but is not empty

The original starter used PostgreSQL 18 with `pgdata` mounted at `/var/lib/postgresql`. Orbit uses PostgreSQL 17 with its data mounted at `/var/lib/postgresql/data`. Reusing that original volume at the new mount point makes initialization fail; changing a container tag is not a supported database downgrade.

The corrected Compose file uses the separate `orbit_pgdata_v17` volume, leaving the original `pgdata` untouched. Pull the updated branch, stop your development web process, and run:

```sh
# Docker-only runtime; Node/npm are supplied by the application image.
docker compose up -d --wait postgres redis
docker compose --profile live run --rm --build migrate
docker compose --profile live up -d --build
```

For hot-reloading Docker development, use the [development override/startup commands](DEVELOPMENT.md#2-start-every-service) instead. Host-run Node services remain a separate optional workflow; [Development workflows](WORKFLOWS.md) compares all three.

Do **not** delete the old volume or run `docker compose down -v` as a troubleshooting shortcut. The new Orbit database starts empty. If you need data from the original installation, keep its volume, back it up using a compatible PostgreSQL version, and plan an explicit import into Orbit's new schema. If an earlier Orbit installation already stored data in `pgdata`, back it up before moving that data to the new volume; the volume switch does not migrate it automatically.

The PostgreSQL health check now runs an authenticated `SELECT 1` over TCP. It does not become healthy merely because the temporary initialization server is accepting Unix-socket connections, or because a server is listening with mismatched credentials.

If startup still fails, inspect:

```sh
docker compose ps
docker compose logs --tail=100 postgres
```

For host-run services, `DATABASE_URL` must use user `orbit`, database `orbit`, host `localhost:5432`, and the same password as `POSTGRES_PASSWORD`. Changing `.env` does not change a password already stored in an initialized database; use the database administrator's password-rotation procedure instead of deleting data.

### Discord says `Invalid OAuth2 redirect_uri`

Open the Discord Developer Portal and select the application matching `DISCORD_CLIENT_ID`. Under **OAuth2 → Redirects**, add and save the exact local callback:

```text
http://localhost:3000/api/auth/callback
```

Set `APP_URL=http://localhost:3000` (without a trailing slash), restart the development server after `.env` changes, and start sign-in again from the dashboard rather than reusing an old authorization URL. `localhost` versus `127.0.0.1`, HTTP versus HTTPS, port, path, and a trailing slash all need to match. For a deployed site, register its exact HTTPS callback instead. Never share your client secret, bot token, or `.env` file while troubleshooting.

### Dashboard cannot verify Discord server permissions

This is a Discord OAuth guild-list lookup, not a Lavalink error. Check web stdout for `Discord guild-permission lookup failed`: it includes the upstream HTTP status and retry delay, but no tokens or upstream response bodies.

- **429:** wait for the displayed cooldown. Do not repeatedly refresh or repeatedly authorize the application. The dashboard coalesces in-flight checks, honors `Retry-After`/`retry_after`, disables speculative prefetch on protected navigation, and shows a recoverable wait screen.
- **401/403 from Discord:** start sign-in again from `/login`; make sure the selected application's OAuth scopes include `identify` and `guilds`. You still need ownership, Administrator, or Manage Server permission for the selected community.
- **503/network failures:** Discord or the connection is temporarily unavailable. Retry after the displayed delay. Do not rotate unrelated bot, database, or Lavalink credentials.

No operation is authorized with expired cached guild permissions when verification fails. The permission cache and cooldowns are process-local; multiple web replicas have independent caches, so large deployments should coordinate upstream quotas across replicas rather than lengthening authorization-cache lifetimes. Bot actions continue to independently validate current member permissions.

## Optional bot presence

The bot sets one activity once, after the gateway is ready:

| Variable            | Default    | Accepted values                                          |
| ------------------- | ---------- | -------------------------------------------------------- |
| `BOT_ACTIVITY`      | `/help`    | Any text (trimmed to 128 chars); empty disables presence |
| `BOT_ACTIVITY_TYPE` | `watching` | `playing`, `watching`, `listening`, `competing`          |
| `BOT_STATUS`        | `online`   | `online`, `idle`, `dnd`, `invisible`                     |

It is deliberately not a rotating status and it never invents member or server
counts, because those drift between shards and the dashboard. Unknown values fall
back to watching/online and the startup log says so. Demo mode never logs in, so it
never sets a presence.

## Health and observability

- `GET /api/healthz` is a lightweight web liveness endpoint; it intentionally does not claim database or bot readiness.
- The authenticated Overview shows independent gateway, database, worker, and music state. Missing heartbeats become offline after two minutes.
- Bot heartbeats occur every 30 seconds; worker reconciliation/heartbeat every minute.
- Inspect structured stdout logs, failed BullMQ jobs, source health, audit events, and delivery history. Alert on missing heartbeats, repeated 429s, permission failures, database pool pressure, and outbox backlog.
- A disabled optional music backend should not be mistaken for a failed web/database service.
- The supplied Lavalink image owns its authenticated HTTP `HEALTHCHECK`; Compose inherits it. Plain Docker can use the same metadata; other supervisors can exec `/opt/Lavalink/healthcheck/run`. Rebuild the custom image when upgrading this contract. HTTP ready is not WebSocket/plugin/voice/playback proof; see the [health ownership matrix](STRUCTURE-REFACTOR.md#remaining-checks-consumers-and-meaning).

PostgreSQL is the source of truth for settings, money, entitlements, audits, and delivery uniqueness. Redis is the transport/scheduling system, with AOF and no eviction. Durable outbox recovery repairs a database-reserved delivery that could not be enqueued, but exhausted failures should be investigated rather than blindly replayed. Stable event IDs and nonces should be preserved when retrying operationally.

## Updating

1. Back up PostgreSQL and retain Redis persistence.
2. Test dependency/image updates and migrations in staging.
3. Build the image, apply migrations once, then roll out services.
4. Re-register commands if command definitions changed.
5. Verify OAuth, role assignment/removal, permission failures, a daily claim, a transfer, source testing, delivery, and supported voice playback in a test guild.
6. Monitor errors and queue backlog. Keep a known-good image and a database recovery plan.

The initial migration replaces the original starter schema. It is intended for a new Orbit database. It is not a safe automatic upgrade path for an existing production starter deployment. Preserve its database and import required guild data deliberately.

## What was verified automatically

The repository includes local PostgreSQL-WASM tests and CI real-PostgreSQL execution, TypeScript checks for all services and the web app, ESLint, a production Next/services build, and credential-free Playwright flows. Live Discord OAuth, gateway, provider availability/quotas, external feed DNS/TLS, actual Discord message delivery, and audio playback still require your own infrastructure and authorized test credentials. Do not interpret a passing demo as a live-integration certification.

For the 2026-10-25 voice/card/hydration/setup changes, see [IMPLEMENTATION-REVIEW.md](IMPLEMENTATION-REVIEW.md). New synced permission fields reuse existing JSON columns; this update needs no new SQL migration. Never reset a database or remove volumes to refresh metadata or a renderer. A current checkout/rebuilt bot and a fresh Discord response are needed to judge the new embed layout; an old screenshot alone cannot establish the deployed revision.

# Deployment checklist

## Before launch

- [ ] Node 22.14+, PostgreSQL 17+, Redis 7+, and optional current Lavalink v4 are available.
- [ ] `DEMO_MODE=false` is explicit on all live services; demo mode is never used as authentication.
- [ ] Discord application, OAuth callback, bot token, members/message-content intents, and command registration are configured.
- [ ] `APP_URL` is the actual HTTPS origin (no trailing slash), proxy forwards trusted headers, secure cookies are enabled, and `APP_SECRET` is at least 32 random characters.
- [ ] Database/Redis/Lavalink credentials are strong and held in a secret manager or protected environment files. No `NEXT_PUBLIC_*` secret variables exist.
- [ ] Database, Redis, and Lavalink are private. Worker and audio egress cannot reach metadata/private networks.
- [ ] Migrations have been applied **before** routing live traffic. Backups and recovery have been tested.
- [ ] Invite has no Administrator permission; bot hierarchy, channel overwrites, notification-role mentionability, and moderator hierarchy are tested in a staging guild.
- [ ] `ITAD_API_KEY` is present if deals are enabled, quotas allow the chosen intervals, and region/currency/store mappings are verified.
- [ ] Publisher URLs are verified and authorized. Blizzard/Wowhead/Mojang starters are either configured or left paused/setup-required.
- [ ] Music sources and the current voice protocol/encryption are verified against your installed Lavalink release and provider terms.
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

The service bundles are `dist/bot.js`, `dist/worker.js`, `dist/register.js`, and `dist/migrate.js`. Web artifacts are in `apps/web/.next`. Production dependencies must include the root npm workspace packages. The supplied Dockerfile builds and assembles these paths correctly, including workspace manifests for `npm ci`.

Use a service supervisor/container orchestrator, restart on failure, and allow at least 30 seconds for worker/job shutdown. For scaling, run one gateway owner per Discord shard assignment, any number of BullMQ workers, and multiple live web replicas backed by the same PostgreSQL/Redis. Do not share a demo JSON store across replicas.

## Health and observability

- `GET /api/healthz` is a lightweight web liveness endpoint; it intentionally does not claim database or bot readiness.
- The authenticated Overview shows independent gateway, database, worker, and music state. Missing heartbeats become offline after two minutes.
- Bot heartbeats occur every 30 seconds; worker reconciliation/heartbeat every minute.
- Inspect structured stdout logs, failed BullMQ jobs, source health, audit events, and delivery history. Alert on missing heartbeats, repeated 429s, permission failures, database pool pressure, and outbox backlog.
- A disabled optional music backend should not be mistaken for a failed web/database service.

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

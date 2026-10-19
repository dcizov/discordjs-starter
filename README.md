# discordjs-starter

discord.js 14 + TypeScript. Slash command handler, zod-validated env, Postgres via Drizzle, Vitest, eslint/prettier/husky, tsup build.

## Getting started

**1. Clone it.**

```bash
git clone https://github.com/dcizov/discordjs-starter.git
cd discordjs-starter
```

**2. Set** `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` **and** `DATABASE_URL`**.** (Bot needs to be invited with `bot` + `applications.commands` permissions)

```bash
cp .env.example .env
```

**3. Install deps (with Node), or skip.**

```bash
npm install
```

The `dev` image already contains the dependencies, so a Docker-only setup skips this step.

**4. Start Postgres and apply the migrations.**

```bash
docker compose up -d --wait postgres
npm run db:migrate
```

Without Node, the dev image has `drizzle-kit` (the runtime image does not):

```bash
docker compose --profile dev run --rm dev npm run db:migrate
```

**5. Deploy the commands and run it.**

```bash
npm run deploy
npm run dev
```

Without Node:

```bash
docker compose --profile dev run --rm dev npm run deploy
docker compose --profile dev up dev
```

## Development

Pick whichever fits. All three run the same code against the same `postgres` service, and the `dev` service bind-mounts this directory, so edits apply immediately. The `dev` image is the single source of truth: the dev container, CI, and `docker compose up dev` all use it.

| Setup | Run the bot | Lint, test, migrate |
| --- | --- | --- |
| Node on the host | `npm run dev` | `npm test`, `npm run lint`, … |
| Docker only | `docker compose --profile dev up dev` | `docker compose --profile dev run --rm dev npm test` |
| Dev container | `npm run dev` in the editor terminal | `npm test` in the container |

### With Node

```bash
docker compose up -d --wait postgres
npm run dev
```

### With Docker only (no Node needed)

```bash
docker compose --profile dev up dev
```

`run --rm` executes any other script in the same image and container network. It mounts the repo, so migrations and builds land on the host and `DATABASE_URL` already points at the `postgres` service:

```bash
docker compose --profile dev run --rm dev npm test
docker compose --profile dev run --rm dev npm run typecheck
docker compose --profile dev run --rm dev npm run lint
docker compose --profile dev run --rm dev npm run db:migrate
docker compose --profile dev run --rm dev npm run db:seed
docker compose --profile dev run --rm dev npm run deploy
```

This is also the path for a VPS or homelab host where only Docker is installed.

After changing `package.json` or `package-lock.json`, refresh the `dev_node_modules` volume:

```bash
docker compose --profile dev run --rm dev npm install
```

### Dev container

VS Code, Codespaces, and the dev container CLI reuse the `dev` service and the `postgres` service from `docker-compose.yml`. Start the bot with `npm run dev` in the container — the container itself is kept alive so a missing token cannot kill it.

VS Code: command palette → **Dev Containers: Reopen in Container**.

Any editor, including VSCodium:

```bash
npx @devcontainers/cli up --workspace-folder .
npx @devcontainers/cli exec --workspace-folder . npm run dev
```

VSCodium does not ship Microsoft's Dev Containers extension (it is proprietary and not on Open VSX). Use the CLI above, or the community **Dev Containers OSS** extension from Open VSX. If neither works on a machine, use the Docker-only path — same image, no IDE integration.

Already running Node in WSL2 or a distrobox box? That is the **With Node** path; nothing else is needed. Keep a WSL2 checkout on the WSL filesystem so bind mounts stay fast.

### Notes

- Do not run `docker compose up` and the dev service at the same time: both use `DISCORD_TOKEN`, which means two gateway connections and duplicate replies.
- A dev container shares the compose project with a stack started from the same checkout, so closing it stops that stack too. Do not open one against a production deployment.
- `postgres` publishes on `127.0.0.1` only. Containers use the compose network, so nothing is exposed on a public host.
- The dev container and a host `npm run dev` share `.env`; keep using `.env`, never commit tokens.

## Database

```bash
docker compose up -d --wait postgres
npm run db:migrate
```

- `npm run db:generate` — write a migration after changing `src/db/schema.ts`
- `npm run db:migrate` — apply pending migrations to `DATABASE_URL` (the `bot` database)
- `npm run db:seed` — insert the example rows from `src/db/seed.ts`
- `npm run db:studio` — browse the data with drizzle-kit studio

Every script also runs inside the dev image; prefix it with `docker compose --profile dev run --rm dev` (add `--service-ports` and `-- --host 0.0.0.0` for studio).

Compose keeps the cluster in the `pgdata` volume, which the postgres 18 image mounts at `/var/lib/postgresql`. From the host the server is `localhost:5432`; from a container it is `postgres:5432`. The init script creates the `bot_test` database on first start.

## Testing

```bash
docker compose up -d --wait postgres
npm test
npm run test:watch
npm run test:coverage
```

Without Node:

```bash
docker compose --profile dev run --rm dev npm test
```

Tests use `bot_test`, not the `bot` database: `TEST_DATABASE_URL` takes precedence inside compose, and CI points `DATABASE_URL` at `bot_test` directly. CI runs the same commands against the same Postgres image. Without a reachable database the database tests skip themselves with a warning, so `npm test` also works on a machine without Docker.

## Production

With Node:

```bash
npm run build
npm start
```

With Docker:

```bash
docker compose up -d --build
docker compose logs -f bot
```

The `bot` image runs `dist/index.js` with production dependencies only. Migrations therefore run from the dev image, and never from `bot`:

```bash
docker compose --profile dev run --rm dev npm run db:migrate
```

The image is multi-arch (`linux/amd64`, `linux/arm64`), so the same `docker compose up -d --build` works on x86 hosts, Proxmox VMs, and Raspberry Pis. Building on a Pi is slow; build elsewhere and push instead:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.com/discordjs-starter:latest --push .
```

Change `POSTGRES_PASSWORD` (and the matching `DATABASE_URL`) before exposing a host to the internet.

**Deploy commands**

Global commands can take up to an hour to show up in Discord. Set `DISCORD_GUILD_ID` in `.env` to deploy to a single server instead — guild commands register instantly.

With Node:

```bash
npm run deploy
```

With Docker:

```bash
docker compose run --rm bot node dist/deploy-commands.js
```

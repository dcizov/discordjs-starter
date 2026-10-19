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

**3. Install deps.**

```bash
npm install
```

**4. Start Postgres and apply the migrations.**

```bash
docker compose up -d --wait postgres
npm run db:migrate
```

**5. Deploy the commands and run it.**

```bash
npm run deploy
npm run dev
```

## Development

With Node:

```bash
npm run dev
```

With Docker:

```bash
docker compose --profile dev up dev
```

## Database

```bash
docker compose up -d --wait postgres
npm run db:migrate
```

- `npm run db:generate` — write a migration after changing `src/db/schema.ts`
- `npm run db:migrate` — apply pending migrations to `DATABASE_URL` (the `bot` database)
- `npm run db:seed` — insert the example rows from `src/db/seed.ts`
- `npm run db:studio` — browse the data with drizzle-kit studio

Compose keeps the cluster in the `pgdata` volume, which the postgres 18 image mounts at `/var/lib/postgresql`. From the host the server is `localhost:5432`; from a container it is `postgres:5432`. The init script creates the `bot_test` database on first start.

## Testing

```bash
docker compose up -d --wait postgres
npm test
npm run test:watch
npm run test:coverage
```

CI runs the same commands against the same Postgres image. Without a reachable database the database tests skip themselves with a warning, so `npm test` also works on a machine without Docker.

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

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
docker compose up -d postgres
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
docker compose up -d postgres
npm run db:migrate
```

- `npm run db:generate` — write a migration after changing `src/db/schema.ts`
- `npm run db:migrate` — apply pending migrations to `DATABASE_URL`
- `npm run db:seed` — insert the example rows from `src/db/seed.ts`
- `npm run db:studio` — browse the data with drizzle-kit studio

Compose reaches Postgres at `postgres:5432`; from the host it is `localhost:5432`. Tests use the `bot_test` database, which the postgres service creates on first start.

## Testing

```bash
docker compose up -d postgres
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
With Node:

```bash
npm run deploy
```

With Docker:

```bash
docker compose run --rm bot node dist/deploy-commands.js
```

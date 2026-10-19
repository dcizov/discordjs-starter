# discordjs-starter

discord.js 14 + TypeScript. Slash command handler, zod-validated env, eslint/prettier/husky, tsup build.

## Getting started

**1. Clone it.**

```bash
git clone https://github.com/dcizov/discordjs-starter.git
cd discordjs-starter
```

**2. Set** `DISCORD_TOKEN` **and** `DISCORD_CLIENT_ID`**.** (Bot needs to be invited with `bot` + `applications.commands` permissions)

```bash
cp .env.example .env
```

**3. Install deps.**

```bash
npm install
```

**4. Deploy the commands and run it.**

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

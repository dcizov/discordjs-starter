# Development workflows

Orbit supports three development workflows. This page is a **router**: it tells you which one fits your machine, shows the command that starts it, and links to the guide that owns the exact steps. It deliberately does not repeat those steps — a second copy of a setup procedure is a second thing that can drift out of date.

The three labels below are the same ones used in the [README](../README.md) and in the dashboard.

## Pick a workflow

|                    | Host-Node workflow                                       | Full-stack development with hot reload                                                                        | Dev Container (VS Code / compatible editors) |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Host prerequisites | Node **22.14+** and npm 10+; Docker for PostgreSQL/Redis | Docker Engine/Desktop with Compose **v2.24+** only                                                            | Docker plus a Dev Containers-capable editor  |
| Node/npm run on    | Your host                                                | Inside the containers                                                                                         | Inside the workspace container               |
| Dashboard          | `npm run dev` on host, port 3000                         | `web` service, port 3000                                                                                      | Started for you, port 3000                   |
| Bot and worker     | `npm run dev:bot`, `npm run dev:worker`                  | `bot` and `worker` services                                                                                   | Not started automatically                    |
| Live reload        | Next dev + `tsx watch`                                   | Next dev + `tsx watch` in containers                                                                          | Next dev inside the container                |
| First command      | `npm ci`                                                 | `docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build` | **Dev Containers: Reopen in Container**      |
| Full guide         | [Start here](#host-node-workflow)                        | [Development workflow](DEVELOPMENT.md)                                                                        | [Dev container](DEVCONTAINER.md)             |

> **Prerequisite:** every workflow reads the same root `.env`. It is never committed, and `DEMO_MODE=true` keeps Discord, music and outbound deliveries simulated. All three expect a **dedicated test application and test server** once you leave demo mode.

> **Warning:** never run two bots on the same token. The host `npm run dev:bot`, the Compose `bot` service and a Dev Container bot are three separate gateway connections; stop the one you are not using first. The Dev Container deliberately does not auto-start a bot for this reason.

## Addresses: what reaches what

The same value has two different correct answers depending on where the process
runs, and mixing them is the most common setup mistake. Docker's service name
works **inside** the Compose network; the published port works **outside** it.

| Service       | Inside Compose (bot/worker/web/Dev Container) | On the host (browser, host-run scripts) | Published as                     |
| ------------- | --------------------------------------------- | --------------------------------------- | -------------------------------- |
| Dashboard     | `web:3000`                                    | `http://localhost:3000`                 | `3000:3000` (all interfaces)     |
| PostgreSQL    | `postgres:5432`                               | `localhost:5432`                        | `127.0.0.1:5432` (loopback only) |
| Redis         | `redis:6379`                                  | `localhost:6379`                        | `127.0.0.1:6379` (loopback only) |
| Lavalink REST | `lavalink:2333`                               | `localhost:2333`                        | `127.0.0.1:2333` (loopback only) |

- **`APP_URL` is browser-facing.** It becomes the OAuth redirect and the origin
  in links, so it is the address a _browser_ can reach (`http://localhost:3000`
  locally, the real HTTPS origin in production). Never set it to a service name.
- **`LAVALINK_URL` is bot-facing** and is `hostname:port` **without** a scheme,
  path or credentials: `localhost:2333` for a host-run bot, `lavalink:2333`
  inside Compose. Compose sets the container value itself when
  `LAVALINK_PASSWORD` is non-empty, and leaves the URL empty otherwise so music
  stays optional.
- **`LAVALINK_SECURE=true`** switches the client to `https`/`wss`; only use it
  when something in front of Lavalink actually terminates TLS with a certificate
  the bot trusts. A plain-HTTP Lavalink with `LAVALINK_SECURE=true` fails the
  handshake, and the bot now reports that as a TLS failure rather than a generic
  connection error.
- The database and audio ports are published to **loopback only** on purpose. A
  remote Docker host therefore needs an SSH or editor tunnel; do not widen the
  mapping to `0.0.0.0` to make a local browser work.

## Host-Node workflow

Use it when Node is already installed on your machine and you only want containers for PostgreSQL and Redis. It is also the path the [demo](../README.md#try-it-without-credentials) uses, where no Discord credentials are configured at all.

```sh
npm ci
npm run dev            # dashboard on http://localhost:3000
npm run dev:bot        # Discord gateway, command handler, dashboard-action worker
npm run dev:worker     # schedules, feeds, deals, and outbound deliveries
```

`npm run dev` alone is **web-only**. `npm run dev:bot` and `npm run dev:worker` are separate processes, and the bot and worker need `DEMO_MODE=false` plus real credentials. **No npm command starts PostgreSQL, Redis or Lavalink for you**, and music is not part of the default stack: the bot only uses music after `LAVALINK_URL`/`LAVALINK_PASSWORD` are set and a Lavalink is running somewhere it can reach (the Compose `lavalink` service, or your own). Without it, every other module keeps working. Start the supporting services with:

```sh
docker compose up -d --wait postgres redis && npm run db:migrate
```

Steps, OAuth redirect, slash-command registration and the optional integrations are in the [start-here guide](../README.md#run-live). Container-versus-host differences are documented in [the comparison with `main`](DEVELOPMENT.md#docker-development-compared-with-main).

## Full-stack development with hot reload

Use it when the host must stay clean, or when you want the dashboard, bot, worker, PostgreSQL, Redis and Lavalink started together with one command and the same image production uses.

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run commands:register
```

Every `npm` command in this workflow runs **inside a container**. `docker-compose.dev.yml` is an explicit override for development and is not a production deployment file. Prerequisites, logs, ports, dependency refreshes and data-safe stopping are in [Development workflow](DEVELOPMENT.md).

## Dev Container (VS Code / compatible editors)

Use it when you want an editor that already sees a working dashboard: the container starts `web` and the infrastructure, then opens a persistent workspace as the unprivileged `node` user.

**Dev Containers: Reopen in Container** from the command palette, then open **http://localhost:3000**. The bot is not started; running `npm run dev:bot` in the workspace is only correct after stopping any Compose bot that holds the same token. Live/demo configuration, port forwarding, UID handling and shutdown are in [Dev container](DEVCONTAINER.md).

## Before you open a pull request

These commands are the same in all three workflows; only the shell they run in differs.

```sh
npm run lint
npm run typecheck
npm test               # Vitest unit and integration suites
npm run format:check   # Prettier, as CI runs it
npm run test:e2e       # Playwright, builds and starts the demo web app
```

`npm run test:e2e` needs a Playwright browser download on first use. CI installs Chromium and runs the same suites; a local pass is useful evidence, not a substitute for CI.

> **Note:** documentation lives in `docs/*.md` and `README.md` and is the source of truth for the in-app guides. If you change a command in a guide, change it in the file — do not edit the rendered page, which is generated at build time.

## Where to go next

- [Repository map and architecture](ARCHITECTURE.md) — what the three runtimes do.
- [Developer navigation](DEVELOPER-NAVIGATION.md) — where a file, screen or job lives.
- [Security model](SECURITY.md) — trust boundaries before you add a provider or a webhook.
- [Deployment](DEPLOYMENT.md) — the same images, without hot reload.

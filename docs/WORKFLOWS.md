# Development workflows

Orbit supports three development workflows. This page is a **router**: it tells you which one fits your machine, shows the command that starts it, and links to the guide that owns the exact steps. It deliberately does not repeat those steps — a second copy of a setup procedure is a second thing that can drift out of date.

The three labels below are the same ones used in the [README](README.md) and in the dashboard.

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

## Host-Node workflow

Use it when Node is already installed on your machine and you only want containers for PostgreSQL and Redis. It is also the path the [demo](README.md#try-it-without-credentials) uses, where no Discord credentials are configured at all.

```sh
npm ci
npm run dev            # dashboard on http://localhost:3000
npm run dev:bot        # Discord gateway, command handler, dashboard-action worker
npm run dev:worker     # schedules, feeds, deals, and outbound deliveries
```

`npm run dev` alone is **web-only**. `npm run dev:bot` and `npm run dev:worker` are separate processes, and the bot and worker need `DEMO_MODE=false` plus real credentials. Start the data services with:

```sh
docker compose up -d --wait postgres redis && npm run db:migrate
```

Steps, OAuth redirect, slash-command registration and the optional integrations are in the [start-here guide](README.md#run-live). Container-versus-host differences are documented in [the comparison with `main`](DEVELOPMENT.md#docker-development-compared-with-main).

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

# Development workflows

**All three workflows need Node.js 22.14.0 or newer.** The version is pinned in `.nvmrc` (22.22.3), read by CI and by `nvm use`; `npm ci` refuses to install on an older Node rather than warning and continuing. The Docker and Dev Container workflows run npm inside the image, so their hosts need no Node installed.

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

This is the workflow the Node requirement applies to directly. Run `nvm use` in the repository root first, or make sure `node -v` reports at least 22.14.0; `npm ci` stops with `EBADENGINE` if it does not.

```sh
nvm use            # picks up .nvmrc
node -v            # must be v22.14.0 or newer
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

`npm run test:e2e` needs a Playwright browser download on first use. CI installs Chromium and Firefox and runs the same suites; a local pass is useful evidence, not a substitute for CI.

### Running those commands with no Node on the host

Every line above is an npm script, and npm is installed **inside the images** — a Docker host needs neither Node nor npm. The `dev` service is the container to use: it is built from the Dockerfile's `dev` target, which includes devDependencies, so vitest, ESLint and the TypeScript compiler are all present. The production `runtime` target installs with `--omit=dev` and cannot run any of them.

Run any check as a one-off container against your working tree:

```sh
docker compose --profile dev run --rm --no-deps dev npm test
docker compose --profile dev run --rm --no-deps dev npm run lint
docker compose --profile dev run --rm --no-deps dev npm run typecheck
docker compose --profile dev run --rm --no-deps dev npm run build
docker compose --profile dev run --rm --no-deps dev npm run format:check
```

`--profile dev` enables the `dev` service, which is profile-gated so an ordinary `up` does not start a container whose command is `sleep infinity`. `--no-deps` skips PostgreSQL, Redis and the migration container: none of the suites need them, because the database tests run against in-process PGlite rather than a server.

The service bind-mounts the repository at `/app`, so these run against your working tree, not a copy of it.

**A rebuild does not refresh dependencies.** `dev_node_modules` is a named volume, so `docker compose build` leaves the installed tree untouched. After any lockfile change, reinstall inside the volume — the same reason [the full-stack workflow has to do it](DEVELOPMENT.md#development-lifecycle):

```sh
docker compose --profile dev run --rm --no-deps dev npm ci --no-audit --no-fund
```

If you would rather work in a shell than type `run` each time, the [Dev Container](DEVCONTAINER.md) is this same service with an editor attached to it; its terminal is a normal shell inside the image.

#### Browser tests in a container

`npm run test:e2e` also needs a Playwright browser inside the container, and the system libraries that browser needs. Installing those means running as root, because the `dev` image runs as the unprivileged `node` user — and the browser cache lives under the installing user's home directory, so installing as root and testing as `node` would not find it. Do both in the same container:

```sh
docker compose --profile dev run --rm --no-deps --user root dev \
  bash -lc "npx playwright install --with-deps chromium && npm run build && npm run test:e2e"
```

The e2e server listens on 3100 inside the container and Playwright runs in that same container, so no port needs publishing. `npm run build` is required first because the e2e server is `next start`, which serves a production build.

### The e2e server runs on its own port

The browser tests start a **demo** web app (`DEMO_MODE=true`, `.data/e2e.json`) on **port 3100**, not 3000, so `npm run dev` can keep running at the same time. Outside CI Playwright reuses a server that is already listening rather than starting a second one — which is worth keeping, but it means a non-demo server on that port becomes the system under test. Every spec then fails the same opaque way, as a timeout waiting for the page to hydrate, with nothing in the output that mentions the server.

A preflight runs first and refuses to continue when the port is held by something that is not the demo build:

```
port 3100 is serving a non-demo build; stop it or set E2E_PORT. It reports mode "live";
  The browser tests need the demo server (DEMO_MODE=true) on this port, and
  Playwright is configured to reuse whatever is already listening. Set
  E2E_PORT to a free port to run alongside it.
```

`GET /api/healthz` is the discriminator: it reports `mode` as `"demo"` or `"live"`. To point the run somewhere else:

```sh
E2E_PORT=3300 npm run test:e2e
```

> **Note:** documentation lives in `docs/*.md` and `README.md` and is the source of truth for the in-app guides. If you change a command in a guide, change it in the file — do not edit the rendered page, which is generated at build time.

## Where to go next

- [Repository map and architecture](ARCHITECTURE.md) — what the three runtimes do.
- [Developer navigation](DEVELOPER-NAVIGATION.md) — where a file, screen or job lives.
- [Security model](SECURITY.md) — trust boundaries before you add a provider or a webhook.
- [Deployment](DEPLOYMENT.md) — the same images, without hot reload.

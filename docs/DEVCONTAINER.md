# Dev Container: editor + running dashboard

This is the editor workflow; [Development workflows](WORKFLOWS.md) compares it with the host-Node workflow and full-stack Docker, and this page owns the Dev Container steps.

This adapts the separate-editor-container approach from the [working starter branch](https://github.com/dcizov/discordjs-starter/tree/arena/752cdf1a-discordjs-starter) to this monorepo. It reuses **this branch's** Compose services and Node 22 dev image; it does not bring back the old bot-only commands, PostgreSQL 18 image, or legacy database volume.

## What starts

`.devcontainer/devcontainer.json` opens the repository at `/app` in the **`dev`** service. That service stays alive with `sleep infinity`, so a missing Discord token or a stopped bot cannot close your editor.

The configuration layers the root Compose files with a small `.devcontainer/docker-compose.yml` override. That override clears profiles **only for `dev`, `migrate`, and `lavalink`**, because the Dev Container CLI also runs `compose build` without profile flags. An explicit `runServices` list by itself does not activate the migration profile during that build. Normal Docker-only profiles are unchanged; `bot`/`worker` remain opt-in. The workspace uses the same Dockerfile `dev` stage under an editor-specific image tag, so the CLI's image metadata cannot race with the dashboard/migration image tag.

The explicit `runServices` list starts:

- **`dev`** — the unprivileged editor/terminal workspace, with Git, Node/npm, and development dependencies.
- **`web`** — the Next dashboard with hot reload and host port **3000** published.
- **`migrate`, `postgres`, `redis`** — migrations and the same database/queue services used by Docker development.
- **`lavalink`** — the pinned Soundy-enabled audio backend. Its first build downloads Java build dependencies; no provider or Discord integration test runs during that build.

The workspace and dashboard wait for `migrate`. Besides applying the schema, this orders container creation so **one migration container seeds a cold shared `dev_node_modules` volume first**. Creating several dev-image consumers in parallel can otherwise race Docker's volume copy-up and fail with `mkdir ... node_modules/...: file exists`. No PostgreSQL volume is deleted or replaced.

It deliberately **does not automatically start `bot` or `worker`**. This avoids a second gateway login or duplicate deliveries when you already have them running. Opening the editor does not register commands, seed/reset the database, or log in to Discord. Migrations run against the configured local development database. Existing containers outside this startup list are not stopped.

## Open it

1. Install Docker Engine/Desktop with Compose v2.24+ and an editor with Dev Container support. Open this repository's root folder.
2. Keep your existing `.env`. For a credential-free dashboard use `DEMO_MODE=true` (the default). For real test-server features configure `DEMO_MODE=false` and the credentials described in [Docker development](DEVELOPMENT.md#1-prepare-your-local-environment). Keep the database password that initialized your current volume. Set a strong Lavalink password before using real music.
3. Ensure no unrelated project/host server is occupying port 3000 (or the configured database/Redis/Lavalink host ports). Do **not** delete volumes to resolve a port conflict. If this same checkout's `web` is already running under the same Compose project, it can be reused.
4. In VS Code select **Dev Containers: Reopen in Container**. The shared dev image includes Git; no Docker socket, privileged container, or host Node installation is needed for editor use.
5. Open **http://localhost:3000** after Next finishes starting. For a remote Docker host, use the **Orbit dashboard** entry in the editor's Ports view; it forwards **`web:3000`**, not the idle workspace's port. Keep `APP_URL` and your Discord OAuth callback aligned with the browser-visible URL. The local callback is `http://localhost:3000/api/auth/callback`.

For an editor/automation environment with Node 20+ and the Dev Container CLI available on the **host**, the equivalent commands are:

```sh
npx --yes --package=@devcontainers/cli@0.89.0 devcontainer up --workspace-folder .
npx --yes --package=@devcontainers/cli@0.89.0 devcontainer exec --workspace-folder . npm test
```

These CLI commands require host Node; the VS Code extension and normal Docker Compose workflow do not. VSCodium users can use the CLI or a compatible Dev Containers extension; the configuration is not tied to a particular editor extension.

## Work inside the editor

The dashboard is **already running in `web`**. Edit `apps/web` and let Next hot reload. Do not start another `npm run dev` in the workspace: it would be a separate web process, not the service to which the dashboard port is routed.

Use the workspace terminal for tools:

```sh
npm test
npm run lint
npm run typecheck
npm run commands:register
npm run music:doctor -- --query "an authorized public track or search"
```

The last two commands require the appropriate live configuration; registration replaces commands in the selected Discord scope. The workspace inherits Compose's server-side environment: `postgres:5432`, `redis:6379`, and, when a music password is configured, `lavalink:2333`. Do not replace these with `localhost`; the browser's `localhost:3000` is a different connection.

### Run/debug the main bot and worker

If a Docker `bot`/`worker` instance is already running, either leave it running and edit the shared source, **or stop it first from a host terminal** before starting that process manually in the workspace:

```sh
# Host terminal: stop only the processes you intend to replace.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music stop bot worker
```

Then use separate **workspace terminals** as needed:

```sh
# Main Discord gateway; needs DEMO_MODE=false and the test-server credentials.
npm run dev:bot

# Separate terminal: scheduled feed/deal jobs and deliveries.
npm run dev:worker
```

Do not run the manual processes alongside their Docker services with the same credentials. Ctrl+C stops a manual watcher, not the editor or dashboard. In demo mode the entrypoints keep Discord/external deliveries disabled.

## Dependencies, permissions, and stopping

- The image installs the lockfile's dependencies and seeds the shared `dev_node_modules` volume. **Rebuilding does not refresh an existing volume**, so a dependency added to the root `package.json` after that volume was created is missing until you install into it. The fix is `npm ci` **in the workspace terminal** (the volume is mounted at `/app/node_modules`, the directory npm installs into), not a volume deletion; see [`Module not found` after an update](DEVELOPMENT.md#module-not-found-cant-resolve-package-after-an-update). Recreate the dependency volume only if that command cannot write to it. The post-create command only checks tool versions and does not modify dependencies while Next is watching: stop `web` first (`docker compose stop web`), run `npm ci`, then restart it.
- `node` stays UID/GID **1000**, matching the ordinary Docker dev services and their named-volume ownership. Automatic UID rewriting is disabled so the workspace cannot make the shared cache/dependencies incompatible with the other containers. On a Linux host with a different UID, grant container UID 1000 access to this development checkout with appropriate ownership/ACLs; do not run the stack as root or make the checkout world-writable. Only `/app` is marked as an intentional Git safe directory.
- The dependency and Next caches remain container volumes; secrets stay in the ignored `.env`. No host Docker socket is mounted in the workspace. Use a host terminal for Compose lifecycle commands.
- **Closing the editor leaves containers running** (`shutdownAction: none`), so it will not unexpectedly stop an already-running bot/database in the same project. From the host, stop only what you want to stop:

  ```sh
  docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev --profile live --profile music stop dev web
  ```

- To stop the entire development project, use the same Compose project/files with `down` **without `-v`**. If you set `COMPOSE_PROJECT_NAME`, keep it consistent; changing project names can select different volumes. Neither this setup nor the editor migrates/imports the old PostgreSQL 18 starter database automatically.

## Dashboard still unreachable?

From a host terminal, use the checks in [dashboard connection troubleshooting](DEVELOPMENT.md#dashboard-unreachable-at-localhost3000). You need an **Up `web` container** with a mapping such as `0.0.0.0:3000->3000/tcp`. Seeing only `3000/tcp` on a bot/workspace container is image metadata, not a running or published web server.

CI uses the real Dev Container CLI to open this configuration in demo mode and checks workspace permissions, internal service addresses, dashboard HTTP access, host port publication, and the absence of automatically started bot/worker services. This is a container/HTTP check, not a graphical-editor or live Discord/audio test.

### Recent Compose/Buildx: outside-context generated Dockerfile

If opening the editor fails **during build** with `additional privileges
requested: --allow=fs.read=.../Dockerfile-with-features`, Compose's Bake mode is
rejecting the Dev Container CLI's generated Dockerfile in the host temporary
directory. This is not a bot/database/provider failure. Do **not** grant wildcard
host filesystem access or mount the Docker socket into the workspace to fix it.

Use Compose's regular builder for this CLI/editor session:

```sh
# Docker host terminal (not inside the workspace container)
export COMPOSE_BAKE=false
code .
```

Launch a fresh editor process so it inherits that environment; on PowerShell,
set `$env:COMPOSE_BAKE="false"` before launching it. The CI opening smoke sets
this explicitly as well. This changes only build orchestration, not image
contents, container privileges, persisted volumes or the editor-started services.
Ordinary Compose builds use checked-in Dockerfiles inside the checkout and do
not require this outside-context permission.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSeq, parseDocument } from "yaml";

const config = JSON.parse(
  readFileSync(
    new URL("../.devcontainer/devcontainer.json", import.meta.url),
    "utf8"
  )
);
const compose = parseDocument(
  readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8"),
  { merge: true }
).toJS();
const development = parseDocument(
  readFileSync(new URL("../docker-compose.dev.yml", import.meta.url), "utf8"),
  { merge: true }
).toJS();
const dockerfile = readFileSync(
  new URL("../Dockerfile", import.meta.url),
  "utf8"
);

describe("Dev Container and dashboard startup contract", () => {
  it("reuses the actual Compose files and dev image rather than a divergent editor-only stack", () => {
    expect(config.dockerComposeFile).toEqual([
      "../docker-compose.yml",
      "../docker-compose.dev.yml",
      "docker-compose.yml",
    ]);
    for (const path of config.dockerComposeFile)
      expect(existsSync(resolve(".devcontainer", path))).toBe(true);
    expect(config.service).toBe("dev");
    expect(config.workspaceFolder).toBe("/app");
    expect(compose.services.dev.build).toEqual({ context: ".", target: "dev" });
    expect(compose.services.dev.image).toBe(development.services.web.image);
    expect(compose.services.dev.volumes).toEqual([
      ".:/app",
      "dev_node_modules:/app/node_modules",
    ]);
    expect(compose.volumes).toHaveProperty("dev_node_modules");
  });

  it("clears only editor-started profiles so the CLI build can resolve web's migration dependency", () => {
    const editor = parseDocument(
      readFileSync(
        new URL("../.devcontainer/docker-compose.yml", import.meta.url),
        "utf8"
      ),
      {
        customTags: [
          { tag: "!reset", collection: "seq", resolve: (seq) => seq },
        ],
      }
    );
    expect(editor.errors).toEqual([]);
    expect(editor.toJS().services.dev.image).toBe(
      "orbit-community:devcontainer"
    );
    expect(editor.toJS().services.dev.image).not.toBe(
      development.services.web.image
    );
    expect(Object.keys(editor.toJS().services).sort()).toEqual([
      "dev",
      "lavalink",
      "migrate",
    ]);
    for (const name of ["dev", "migrate", "lavalink"]) {
      const profiles = editor.getIn(["services", name, "profiles"], true);
      if (!isSeq(profiles))
        throw new Error(`Expected a profile reset for ${name}`);
      // Plain [] would merge with, not remove, profiles from the root file.
      expect(profiles.tag).toBe("!reset");
      expect(profiles.toJSON()).toEqual([]);
    }
    expect(compose.services.bot.profiles).toEqual(["live"]);
    expect(compose.services.worker.profiles).toEqual(["live"]);
    expect(compose.services.migrate.profiles).toEqual(["live"]);
    expect(compose.services.lavalink.profiles).toEqual(["music"]);
  });

  it("starts the dashboard/infrastructure explicitly, but never a second bot or delivery worker", () => {
    expect(config.runServices).toEqual([
      "dev",
      "web",
      "migrate",
      "postgres",
      "redis",
      "lavalink",
    ]);
    expect(config.runServices).not.toContain("bot");
    expect(config.runServices).not.toContain("worker");
    for (const service of config.runServices)
      expect(compose.services).toHaveProperty(service);
    expect(config.postCreateCommand).toBe(
      "node --version && npm --version && git --version"
    );
    // Opening an editor must not change dependencies while Next is watching,
    // register commands, seed data, or open another Discord gateway connection.
    expect(config.postCreateCommand).not.toMatch(
      /npm (ci|install|run)|seed|register|dev:bot/
    );
    expect(config).not.toHaveProperty("postStartCommand");
  });

  it("publishes the actual Next service and forwards its port, not image EXPOSE metadata on the bot/workspace", () => {
    expect(compose.services.web.ports).toEqual(["3000:3000"]);
    expect(compose.services.bot.ports).toBeUndefined();
    expect(compose.services.dev.ports).toBeUndefined();
    expect(config.forwardPorts).toEqual(["web:3000"]);
    expect(config.portsAttributes["3000"].label).toBe("Orbit dashboard");
    expect(development.services.web.command).toEqual(["npm", "run", "dev"]);
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    );
    expect(pkg.scripts.dev).toContain("--hostname 0.0.0.0 --port 3000");
  });

  it("serializes cold dependency-volume population before the workspace/dashboard are created", () => {
    // migrate is the first dev-image consumer. Compose's dependency creation
    // order prevents concurrent Docker copy-up into a brand new shared volume.
    expect(compose.services.dev.depends_on.migrate.condition).toBe(
      "service_completed_successfully"
    );
    for (const name of ["web", "bot", "worker"])
      expect(
        (
          development.services[name].depends_on ??
          compose.services[name].depends_on
        ).migrate.condition
      ).toBe("service_completed_successfully");
    expect(compose.services.migrate.depends_on.postgres.condition).toBe(
      "service_healthy"
    );
    expect(compose.services.dev.depends_on).not.toHaveProperty("bot");
    expect(compose.services.dev.depends_on).not.toHaveProperty("worker");
  });

  it("keeps the editor alive independently and does not stop an existing stack on editor close", () => {
    expect(compose.services.dev.command).toEqual(["sleep", "infinity"]);
    expect(compose.services.dev.profiles).toEqual(["dev"]);
    expect(compose.services.dev.restart).toBe("no");
    expect(compose.services.dev.init).toBe(true);
    expect(config.overrideCommand).toBe(false);
    expect(config.shutdownAction).toBe("none");
    expect(config.remoteUser).toBe("node");
    // All shared-volume users retain the same UID as the ordinary dev image.
    expect(config.updateRemoteUserUID).toBe(false);
  });

  it("inherits demo gating and internal service addresses instead of overriding credentials or using localhost", () => {
    const env = compose.services.dev.environment;
    expect(compose.services.dev.env_file).toEqual([
      { path: ".env", required: false },
    ]);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DEMO_MODE).toBe("${DEMO_MODE:-true}");
    expect(env.DATABASE_URL).toBe(
      compose.services.bot.environment.DATABASE_URL
    );
    expect(env.DATABASE_URL).toContain("@postgres:5432/");
    expect(env.REDIS_URL).toBe("redis://redis:6379");
    expect(env.LAVALINK_URL).toBe("${LAVALINK_PASSWORD:+lavalink:2333}");
    expect(env.LAVALINK_PASSWORD).toBe("${LAVALINK_PASSWORD:-}");
    expect(env).not.toHaveProperty("TEST_DATABASE_URL");
    expect(config).not.toHaveProperty("containerEnv");
    expect(config).not.toHaveProperty("remoteEnv");
    expect(compose.services.dev.depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
      postgres: { condition: "service_healthy" },
      redis: { condition: "service_healthy" },
    });
  });

  it("adds Git/SSH only to the unprivileged dev image and trusts only the intended workspace", () => {
    const stage = dockerfile
      .split("FROM deps AS dev\n")[1]
      .split("FROM deps AS builder")[0];
    expect(stage).toContain(
      "apt-get install -y --no-install-recommends git ca-certificates openssh-client"
    );
    expect(stage).toContain("USER node");
    expect(stage.indexOf("git config --global")).toBeGreaterThan(
      stage.indexOf("USER node")
    );
    expect(stage).toContain("git config --global --add safe.directory /app");
    expect(stage).not.toContain("safe.directory '*'");
    expect(dockerfile.split("FROM base AS runtime")[1]).not.toContain(
      "apt-get install"
    );
    expect(compose.services.dev.privileged).toBeUndefined();
    expect(compose.services.dev.volumes.join(" ")).not.toContain("docker.sock");
    expect(config).not.toHaveProperty("mounts");
  });

  it("refuses the destructive CI lifecycle harness outside a clean Actions environment", () => {
    const result = spawnSync("bash", [".devcontainer/ci-smoke.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "false" },
      timeout: 5000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "clean GitHub Actions checkout without .env"
    );
    expect(result.stdout).toBe("");
  });

  it("does not grant broad filesystem entitlements to build the CLI-generated editor Dockerfile", () => {
    const harness = readFileSync(
      new URL("../.devcontainer/ci-smoke.sh", import.meta.url),
      "utf8"
    );
    expect(harness).toContain("export COMPOSE_BAKE=false");
    expect(harness).not.toContain("--allow=fs.read=*");
  });

  it("refuses the real-queue CI smoke outside its credential-free isolated project", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tests/integration/action-queue-smoke.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          ORBIT_ACTION_QUEUE_SMOKE: "false",
        },
        timeout: 5000,
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("credential-free, isolated CI");
    expect(result.stderr).not.toContain("Transform failed");
  });

  it("retains the PostgreSQL 17 layout and never reintroduces the reference branch's legacy volume", () => {
    expect(compose.services.postgres.image).toBe("postgres:17-alpine");
    expect(compose.services.postgres.volumes).toEqual([
      "orbit_pgdata_v17:/var/lib/postgresql/data",
    ]);
    expect(compose.volumes).not.toHaveProperty("pgdata");
    expect(development.services.web.depends_on.migrate.condition).toBe(
      "service_completed_successfully"
    );
  });
});

/*
 * Running the checks without Node on the host.
 *
 * `docs/WORKFLOWS.md` tells a Docker-only host to run `npm test`, lint,
 * typecheck and build inside the `dev` service. That only works while the
 * `dev` image target carries devDependencies — the production `runtime`
 * target installs with `--omit=dev` and has no vitest, ESLint or tsc. Nothing
 * in the build would fail if the `dev` target were changed to omit them; the
 * documented commands would just stop working for the people who need them
 * most, because they have no host Node to fall back on.
 */
describe("the dev image can run the checks a Docker-only host is told to run", () => {
  it("builds the dev target from the stage that installs devDependencies", () => {
    // `deps` is the stage that runs a plain `npm ci`. If `dev` ever becomes
    // `FROM production-deps`, every command in that docs section breaks.
    expect(dockerfile).toMatch(/^FROM\s+deps\s+AS\s+dev\s*$/m);
    expect(dockerfile).toMatch(/^FROM\s+manifests\s+AS\s+deps\s*$/m);
    expect(dockerfile).toMatch(/^RUN\s+npm\s+ci\s+--no-audit\s+--no-fund\s*$/m);
  });

  it("installs the production stage with --omit=dev, so the two targets really differ", () => {
    // The contrast is the point of the docs paragraph: runtime cannot run
    // these, dev can.
    expect(dockerfile).toMatch(/^FROM\s+manifests\s+AS\s+production-deps\s*$/m);
    expect(dockerfile).toMatch(
      /^RUN\s+npm\s+ci\s+--omit=dev\s+--no-audit\s+--no-fund\s*$/m
    );
  });

  it("exposes the dev service under a profile, so an ordinary up does not start it", () => {
    expect(compose.services.dev.profiles).toEqual(["dev"]);
  });

  it("bind-mounts the working tree into the dev service", () => {
    // The documented commands run against the developer's files, not a copy.
    expect(compose.services.dev.volumes).toContain(".:/app");
  });

  it("keeps installed dependencies in a named volume, which a rebuild does not refresh", () => {
    // Documented as a caveat: `docker compose build` will not update
    // dependencies, so the docs tell you to run `npm ci` inside the volume.
    expect(compose.services.dev.volumes).toContain(
      "dev_node_modules:/app/node_modules"
    );
  });
});

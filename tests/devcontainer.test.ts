import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

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

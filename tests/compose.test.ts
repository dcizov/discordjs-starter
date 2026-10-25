import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const document = parseDocument(
  readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8"),
  { merge: true }
);
const compose = document.toJS();

describe("Compose startup and upgrade safety", () => {
  it("uses a dedicated PostgreSQL 17 volume without reusing or declaring the legacy volume", () => {
    expect(document.errors).toEqual([]);
    expect(compose.services.postgres.image).toBe("postgres:17-alpine");
    expect(compose.services.postgres.volumes).toEqual([
      "orbit_pgdata_v17:/var/lib/postgresql/data",
    ]);
    expect(compose.volumes).toHaveProperty("orbit_pgdata_v17");
    // Declaring pgdata would also make `compose down -v` eligible to delete it.
    expect(compose.volumes).not.toHaveProperty("pgdata");
  });

  it("checks database authentication over TCP rather than the temporary init socket", () => {
    const health = compose.services.postgres.healthcheck;
    expect(health.test[0]).toBe("CMD-SHELL");
    expect(health.test[1]).toContain("--host=127.0.0.1");
    expect(health.test[1]).toContain('PGPASSWORD="$$POSTGRES_PASSWORD"');
    expect(health.test[1]).toContain('--username="$$POSTGRES_USER"');
    expect(health.test[1]).toContain('--dbname="$$POSTGRES_DB"');
    expect(health.test[1]).toContain("SELECT 1");
    expect(health.test[1]).toContain("PGCONNECT_TIMEOUT=3");
    expect(health.start_period).toBe("10s");
  });

  it("waits for database readiness before migrations and migrations before live services", () => {
    expect(compose.services.migrate.depends_on.postgres.condition).toBe(
      "service_healthy"
    );
    for (const service of ["bot", "worker"]) {
      expect(compose.services[service].depends_on.migrate.condition).toBe(
        "service_completed_successfully"
      );
    }
  });

  it("publishes the optional music backend on host loopback for local bot development", () => {
    const music = compose.services.lavalink;
    expect(music.profiles).toEqual(["music"]);
    expect(music.ports).toEqual(["127.0.0.1:2333:2333"]);
    expect(music.environment.LAVALINK_SERVER_PASSWORD).toContain(
      "${LAVALINK_PASSWORD:"
    );
  });

  it("gates only the optional music dependency on authenticated backend readiness", () => {
    expect(compose.services.bot.depends_on.lavalink).toEqual({
      condition: "service_healthy",
      required: false,
    });
    expect(compose.services.lavalink.profiles).toEqual(["music"]);
    for (const name of ["web", "worker", "migrate", "dev"])
      expect(compose.services[name].depends_on ?? {}).not.toHaveProperty(
        "lavalink"
      );
    // The derived image owns readiness, including plain-Docker deployments.
    // Actual HTTP/auth/refusal/redirect/recovery tests run with image curl in CI.
    expect(compose.services.lavalink).not.toHaveProperty("healthcheck");
    const docker = readFileSync(
      new URL("../docker/lavalink/Dockerfile", import.meta.url),
      "utf8"
    );
    expect(docker).toMatch(
      /HEALTHCHECK --interval=5s --timeout=5s --start-period=20s --retries=12/
    );
    expect(docker).toContain('CMD ["/opt/Lavalink/healthcheck/run"]');
    const run = readFileSync(
      new URL("../docker/lavalink/healthcheck.sh", import.meta.url),
      "utf8"
    );
    expect(run).toContain("curl --disable --silent");
    expect(run).toContain("--header @-");
    expect(run).not.toMatch(/java|node|python/);
  });

  it("keeps the headless CI readiness wait alive between unrefed backend retries, then cancels its deadline", () => {
    const workflow = parseDocument(
      readFileSync(
        new URL("../.github/workflows/ci.yml", import.meta.url),
        "utf8"
      )
    ).toJS();
    const steps = workflow.jobs.containers.steps as Array<{
      name?: string;
      run?: string;
    }>;
    const smoke = steps.find(
      (step) =>
        step.name ===
        "Verify plugins, backend WebSocket and readiness without Discord/provider access"
    )?.run;
    // Execute the actual CI wait, not a duplicate implementation. The simulated
    // ready signal is unrefed just like the production supervisor retry timer.
    const wait = smoke?.match(
      /const deadline = new AbortController\(\);[\s\S]*?deadline\.abort\(\);\s*}/
    )?.[0];
    if (!wait)
      throw new Error("Missing cancellable backend readiness deadline in CI");
    const run = (body: string) =>
      spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import { setTimeout } from "node:timers/promises";
      const connected = setTimeout(30, undefined, { ref: false });
      const lastSocketError = "not ready";
      ${body}
      console.log("ready");
    `,
        ],
        { encoding: "utf8", timeout: 5000 }
      );
    const fixed = run(wait);
    expect(fixed.error).toBeUndefined();
    expect(fixed.status, fixed.stderr).toBe(0);
    expect(fixed.stdout).toBe("ready\n");
    // Reproduce the old unsettled top-level-await exit, without any Docker,
    // provider or Discord access, so a future ref:false regression is visible.
    const broken = run(
      wait.replace(
        "signal: deadline.signal",
        "signal: deadline.signal, ref: false"
      )
    );
    expect(broken.status).toBe(13);
    expect(broken.stdout).toBe("");
  });

  it("builds the canonical commit-pinned AAC/fMP4 adapter and never registers the broken builtin alongside it", () => {
    expect(compose.services.lavalink.build).toEqual({
      context: ".",
      dockerfile: "docker/lavalink/Dockerfile",
    });
    expect(compose.services.lavalink.image).toBe("orbit-lavalink:local");
    const dockerfile = readFileSync(
      new URL("../docker/lavalink/Dockerfile", import.meta.url),
      "utf8"
    );
    expect(dockerfile).toContain("FROM ghcr.io/lavalink-devs/lavalink:4.2.2");
    expect(dockerfile).toContain(
      "https://codeload.github.com/lowkwrs/soundy/tar.gz/e2c5da8e96661d2a9eb96ee53e3d5b95903bc194"
    );
    expect(dockerfile).toContain(
      "--checksum=sha256:67c3ef77f9792605263be47825373a35f30f7b77ba6bd048e38274ea6cba22f0"
    );
    expect(dockerfile).toContain("ENV SOUNDY_IT=0");
    expect(dockerfile).toContain(":source:test :plugin:build");
    expect(dockerfile).toContain("chown -R gradle:gradle /soundy");
    expect(dockerfile).toContain("USER gradle");
    expect(dockerfile).toContain(
      "cat /tmp/soundy-plugin.gradle.kts >> plugin/build.gradle.kts"
    );
    const metadata = readFileSync(
      new URL("../docker/lavalink/soundy-plugin.gradle.kts", import.meta.url),
      "utf8"
    );
    expect(metadata).toContain('apiVersion.set("4.2.2")');
    expect(metadata).toContain('name.set("soundy")');
    expect(metadata).toContain('path.set("com.waris4ly.soundy")');
    expect(metadata).toContain('dependsOn(":source:compileTestJava")');
    expect(dockerfile).toContain(
      "/opt/Lavalink/plugins/soundy-plugin-1.1.0.jar"
    );
    expect(dockerfile).toContain("/opt/Lavalink/licenses/soundy-LICENSE");
    const config = parseDocument(
      readFileSync(
        new URL("../docker/lavalink/application.yml", import.meta.url),
        "utf8"
      )
    ).toJS();
    expect(config.plugins.soundy.enabled).toBe(true);
    expect(config.lavalink.server.sources.soundcloud).toBe(false);
    expect(config.lavalink.server.sources.bandcamp).toBe(true);
    for (const source of ["youtube", "http", "local"])
      expect(config.lavalink.server.sources[source]).toBe(false);
    expect(config.lavalink.plugins).toBeUndefined(); // No unversioned startup download.
  });

  it("keeps shared music connections disabled in Compose when no password is configured", () => {
    for (const service of ["web", "bot", "worker", "migrate"]) {
      const env = compose.services[service].environment;
      expect(env.LAVALINK_URL).toBe("${LAVALINK_PASSWORD:+lavalink:2333}");
      expect(env.LAVALINK_PASSWORD).toBe("${LAVALINK_PASSWORD:-}");
    }
  });
});

const devDocument = parseDocument(
  readFileSync(new URL("../docker-compose.dev.yml", import.meta.url), "utf8"),
  { merge: true }
);
const development = devDocument.toJS();
const applicationServices = ["web", "bot", "worker", "migrate"] as const;
describe("full-stack Docker development override", () => {
  it("keeps Docker host entrypoints out of npm while preserving container app commands", () => {
    const { scripts } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts: Record<string, string> };
    const dockerWrappers = Object.entries(scripts).filter(([, command]) =>
      /(?:^|[\s;&|])docker(?:-compose)?\s/u.test(command)
    );
    expect(dockerWrappers).toEqual([]);
    for (const name of [
      "dev",
      "dev:bot",
      "dev:worker",
      "db:migrate",
      "commands:register",
    ])
      expect(scripts[name]).toEqual(expect.any(String));
  });

  it("documents direct Docker host commands instead of removed npm wrappers", () => {
    const prefix =
      "docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music";
    for (const path of [
      "README.md",
      "docs/DEVELOPMENT.md",
      "docs/DEALS.md",
      "docs/MUSIC.md",
      "docs/MUSIC-PLUGINS.md",
    ]) {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/\bnpm run dev:(?:stack|docker)\b/u);
      expect(text).toContain(`${prefix} up -d --build`);
      expect(text).toContain(
        `${prefix} logs -f --tail=100 web bot worker lavalink`
      );
    }
  });

  it("is valid YAML and overrides only the four application services", () => {
    expect(devDocument.errors).toEqual([]);
    expect(Object.keys(development.services).sort()).toEqual(
      [...applicationServices].sort()
    );
    // Database, Redis, Lavalink, their credentials and their persistent volumes
    // remain defined exclusively by the base Compose file.
    expect(Object.keys(development.volumes).sort()).toEqual([
      "dev_next",
      "dev_node_modules",
    ]);
  });

  it("uses the actual dev build and development environment for every app", () => {
    for (const name of applicationServices) {
      const service = development.services[name];
      expect(service.build).toEqual({ context: ".", target: "dev" });
      expect(service.image).toBe("orbit-community:dev");
      expect(service.environment.NODE_ENV).toBe("development");
      expect(compose.services[name].build.target).toBe("runtime");
      expect(compose.services[name].environment.NODE_ENV).toBe("production");
    }
  });

  it("preserves demo gating and internal connection URLs rather than forcing live credentials or localhost", () => {
    for (const name of applicationServices) {
      const overrides = development.services[name].environment;
      for (const key of [
        "DEMO_MODE",
        "DATABASE_URL",
        "REDIS_URL",
        "LAVALINK_URL",
        "LAVALINK_PASSWORD",
        "DISCORD_TOKEN",
      ])
        expect(overrides).not.toHaveProperty(key);
      expect(compose.services[name].environment.DATABASE_URL).toContain(
        "@postgres:5432/"
      );
      expect(compose.services[name].environment.REDIS_URL).toBe(
        "redis://redis:6379"
      );
      expect(compose.services[name].environment.LAVALINK_URL).toBe(
        "${LAVALINK_PASSWORD:+lavalink:2333}"
      );
    }
  });

  it("runs source commands with hot reload and migrations without requiring dist bundles", () => {
    expect(development.services.web.command).toEqual(["npm", "run", "dev"]);
    expect(development.services.bot.command).toEqual(["npm", "run", "dev:bot"]);
    expect(development.services.worker.command).toEqual([
      "npm",
      "run",
      "dev:worker",
    ]);
    expect(development.services.migrate.command).toEqual([
      "npm",
      "run",
      "db:migrate",
    ]);
  });

  it("binds source while isolating Linux dependencies and the web development cache", () => {
    for (const name of applicationServices) {
      expect(development.services[name].volumes).toContain(".:/app");
      expect(development.services[name].volumes).toContain(
        "dev_node_modules:/app/node_modules"
      );
    }
    expect(development.services.web.volumes).toContain(
      "dev_next:/app/apps/web/.next"
    );
    const dockerfile = readFileSync(
      new URL("../Dockerfile", import.meta.url),
      "utf8"
    );
    const devStage = dockerfile
      .split("FROM deps AS dev\n")[1]
      .split("FROM deps AS builder")[0];
    expect(devStage).toContain("mkdir -p .data apps/web/.next");
    expect(devStage).toContain("chown -R node:node /app");
    expect(devStage).toContain("USER node");
  });

  it("waits for migrations/Redis before serving live dashboard requests", () => {
    expect(development.services.web.depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
      redis: { condition: "service_healthy" },
    });
    expect(development.services.web.environment.WATCHPACK_POLLING).toBe(
      "${WATCHPACK_POLLING:-true}"
    );
    for (const name of ["bot", "worker"])
      expect(development.services[name].environment.CHOKIDAR_USEPOLLING).toBe(
        "${CHOKIDAR_USEPOLLING:-true}"
      );
  });
});

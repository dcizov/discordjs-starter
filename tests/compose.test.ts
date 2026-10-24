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

  it("keeps shared music connections disabled in Compose when no password is configured", () => {
    for (const service of ["web", "bot", "worker", "migrate"]) {
      const env = compose.services[service].environment;
      expect(env.LAVALINK_URL).toBe("${LAVALINK_PASSWORD:+lavalink:2333}");
      expect(env.LAVALINK_PASSWORD).toBe("${LAVALINK_PASSWORD:-}");
    }
  });
});

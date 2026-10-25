import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDemo,
  required,
  validateEnvironment,
} from "../packages/core/src/environment";

const live = {
  NODE_ENV: "production",
  DEMO_MODE: "false",
  DATABASE_URL: "postgres://test:test@localhost/orbit_test",
  REDIS_URL: "redis://localhost:6379",
  DISCORD_TOKEN: "test-only-bot-token",
  DISCORD_CLIENT_ID: "120000000000000099",
  DISCORD_CLIENT_SECRET: "test-only-client-secret",
  APP_SECRET: "test-only-application-secret-at-least-32-characters",
  APP_URL: "https://orbit.example",
  LAVALINK_URL: "",
  LAVALINK_PASSWORD: "",
};
function environment(overrides: Partial<typeof live> = {}) {
  for (const [name, value] of Object.entries({ ...live, ...overrides }))
    vi.stubEnv(name, value);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("existing service environment invariants", () => {
  it("never implicitly enters demo in production, but supports explicit isolated demo", () => {
    environment({ DEMO_MODE: "", DISCORD_CLIENT_ID: "" });
    expect(isDemo()).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemo()).toBe(true);
    expect(() => validateEnvironment("web")).not.toThrow();
  });
  it("defaults credential-free development to demo, never over explicit live mode", () => {
    environment({
      NODE_ENV: "development",
      DEMO_MODE: "",
      DISCORD_CLIENT_ID: "",
    });
    expect(isDemo()).toBe(true);
    vi.stubEnv("DEMO_MODE", "false");
    expect(isDemo()).toBe(false);
  });
  it.each(["bot", "worker"] as const)(
    "does not require web OAuth secrets for %s",
    (service) => {
      environment({ APP_SECRET: "", APP_URL: "", DISCORD_CLIENT_SECRET: "" });
      expect(() => validateEnvironment(service)).not.toThrow();
    }
  );
  it("requires live web origin/crypto/OAuth credentials and rejects unsafe public HTTP", () => {
    environment();
    expect(() => validateEnvironment("web")).not.toThrow();
    vi.stubEnv("APP_URL", "http://orbit.example");
    expect(() => validateEnvironment("web")).toThrow(/APP_URL/);
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(() => validateEnvironment("web")).not.toThrow();
  });
  it("requires paired optional music on the bot", () => {
    environment({ LAVALINK_URL: "localhost:2333" });
    expect(() => validateEnvironment("bot")).toThrow(/LAVALINK/);
  });
  it("names missing settings without including credential values", () => {
    environment({ APP_SECRET: "private-bad-value" });
    expect(() => validateEnvironment("web")).toThrow(/APP_SECRET/);
    try {
      validateEnvironment("web");
    } catch (error) {
      expect(String(error)).not.toContain("private-bad-value");
    }
    vi.stubEnv("DISCORD_TOKEN", "");
    expect(() => required("DISCORD_TOKEN")).toThrow(/DISCORD_TOKEN/);
  });
});

describe("runtime-specific typed environment contract", () => {
  it.each([
    [
      "register",
      {
        DISCORD_TOKEN: live.DISCORD_TOKEN,
        DISCORD_CLIENT_ID: live.DISCORD_CLIENT_ID,
      },
    ],
    ["export", { DISCORD_TOKEN: live.DISCORD_TOKEN }],
    ["migrate", { DATABASE_URL: live.DATABASE_URL }],
    [
      "music-doctor",
      { LAVALINK_URL: "localhost:2333", LAVALINK_PASSWORD: "test-password" },
    ],
  ] as const)(
    "validates only actual dependencies for %s",
    (service, values) => {
      expect(() =>
        validateEnvironment(service, { DEMO_MODE: "false", ...values })
      ).not.toThrow();
      expect(() =>
        validateEnvironment(service, { DEMO_MODE: "false" })
      ).toThrow(/environment/);
    }
  );
  it("keeps explicit demo services credential-free, but does not skip a requested migration", () => {
    for (const service of ["web", "bot", "worker", "register"] as const)
      expect(() =>
        validateEnvironment(service, {
          DEMO_MODE: "true",
          NODE_ENV: "production",
        })
      ).not.toThrow();
    expect(() => validateEnvironment("migrate", { DEMO_MODE: "true" })).toThrow(
      /DATABASE_URL/
    );
  });
  it("does not impose optional music credentials on web or worker", () => {
    for (const service of ["web", "worker"] as const)
      expect(() =>
        validateEnvironment(service, { ...live, LAVALINK_URL: "unused" })
      ).not.toThrow();
  });
  it("checks bot music pairing/address/TLS without changing secret strings", () => {
    expect(() =>
      validateEnvironment("bot", {
        ...live,
        LAVALINK_URL: "localhost:2333",
        LAVALINK_PASSWORD: "test",
      })
    ).not.toThrow();
    expect(() =>
      validateEnvironment("bot", {
        ...live,
        LAVALINK_URL: "https://localhost:2333",
        LAVALINK_PASSWORD: "test",
      })
    ).toThrow(/LAVALINK_URL/);
    expect(() =>
      validateEnvironment("bot", { ...live, LAVALINK_SECURE: "probably" })
    ).toThrow(/LAVALINK_SECURE/);
    expect(
      required("LAVALINK_PASSWORD", { LAVALINK_PASSWORD: " test password " })
    ).toBe(" test password ");
  });
  it.each(["DATABASE_URL", "REDIS_URL"] as const)(
    "uses the same protocol validation for startup and individual %s reads",
    (name) => {
      const invalid = "https://private-credential-value.example";
      expect(() => required(name, { [name]: invalid })).toThrow(name);
      expect(() =>
        validateEnvironment("worker", { ...live, [name]: invalid })
      ).toThrow(name);
    }
  );
  it("never includes malformed URL/secret values in diagnostics", () => {
    for (const [name, value] of [
      ["DATABASE_URL", "private-unknown-url"],
      ["APP_URL", "https://user:private-password@example.test"],
    ] as const) {
      try {
        required(name, { [name]: value });
        throw new Error("Expected validation failure");
      } catch (error) {
        expect(String(error)).toContain(name);
        expect(String(error)).not.toContain(value);
        expect(String(error)).not.toContain("private-password");
      }
    }
  });
  it("rejects ambiguous mode configuration instead of accidentally selecting live/demo", () => {
    expect(() => isDemo({ DEMO_MODE: "yes" })).toThrow(/DEMO_MODE/);
  });
  it("refuses credential reads in a browser context", () => {
    vi.stubGlobal("window", {});
    expect(() => required("APP_SECRET", live)).toThrow(/only.*server/);
    expect(() => validateEnvironment("web", live)).toThrow(/only.*server/);
  });
});

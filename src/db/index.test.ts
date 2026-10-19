import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "./index";

beforeAll(() => {
  vi.stubEnv("DISCORD_TOKEN", "token");
  vi.stubEnv("DISCORD_CLIENT_ID", "123");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/bot");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("getDb", () => {
  it("reuses one pool", () => {
    expect(getDb().pool).toBe(getDb().pool);
  });

  it("creates a new pool after closeDb", async () => {
    const first = getDb().pool;

    await closeDb();

    expect(getDb().pool).not.toBe(first);
  });

  it("does nothing when closeDb has nothing to close", async () => {
    await closeDb();

    await expect(closeDb()).resolves.toBeUndefined();
  });
});

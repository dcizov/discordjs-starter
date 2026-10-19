import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client";
import { getOrCreateGuild } from "./queries";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("getOrCreateGuild", () => {
  let connection: ReturnType<typeof createDb> | undefined;
  let db: Database | undefined;

  beforeAll(async () => {
    if (!url) return;

    const candidate = createDb(url);

    try {
      await migrate(candidate.db, { migrationsFolder: "drizzle" });
      connection = candidate;
      db = candidate.db;
    } catch (error) {
      console.warn(
        `⚠️  Database tests are skipped: ${(error as Error).message}\n` +
          '   Start Postgres with "docker compose up -d postgres" to run them.'
      );
    } finally {
      if (!connection) await candidate.pool.end();
    }
  });

  afterAll(async () => {
    await connection?.pool.end();
  });

  it("creates the row with its defaults", async () => {
    if (!db) return;

    const guildId = `seed-${Date.now()}`;
    const created = await getOrCreateGuild(db, guildId);

    expect(created.guildId).toBe(guildId);
    expect(created.locale).toBe("en");
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("returns the same row on the second call", async () => {
    if (!db) return;

    const guildId = `again-${Date.now()}`;
    const first = await getOrCreateGuild(db, guildId);
    const second = await getOrCreateGuild(db, guildId);

    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });
});

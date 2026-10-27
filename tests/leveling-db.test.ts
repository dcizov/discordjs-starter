import { defaultConfig } from "@orbit/core";
import { database, closeDb } from "@orbit/db";
import {
  awardXp,
  closeVoiceSession,
  getXpTotal,
  listRewardGrants,
  listVoiceSessions,
  listXpLeaderboard,
  markVoiceInterval,
  openVoiceSession,
  recordRewardGrant,
} from "@orbit/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "../packages/db/src/schema";

// PGlite runs real PostgreSQL in WASM for local SQL/transaction tests.
// CI sets TEST_DATABASE_URL to also exercise pg, row locks and concurrent
// connections.
vi.mock("../packages/db/src/client", async (importOriginal) => {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return importOriginal();
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { readFile, readdir } = await import("node:fs/promises");
  const schema = await import("../packages/db/src/schema");
  const pg = new PGlite();
  for (const f of (await readdir("./drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(`./drizzle/${f}`, "utf8"));
  const db = drizzle(pg, { schema });
  return {
    database: () => ({ db, pool: { end: () => pg.close() } }),
    closeDb: () => pg.close(),
  };
});

// `isDemo()` is true whenever NODE_ENV is not production and no
// DISCORD_CLIENT_ID is set, which is the case under vitest. Without this these
// functions take their demo branch and never touch SQL.
beforeAll(() => {
  vi.stubEnv("DEMO_MODE", "false");
});
afterAll(async () => {
  await closeDb();
});

const db = () => database().db;

let counter = 0;
function nextGuild() {
  return `8800000000000${String(10000 + counter++).padStart(5, "0")}`;
}

async function seedGuild() {
  const guildId = nextGuild();
  await db()
    .insert(s.guilds)
    .values({
      id: guildId,
      name: "Leveling test guild",
      config: structuredClone(defaultConfig),
    });
  return guildId;
}

describe("awarding XP", () => {
  it("counts an award once and reports the level", async () => {
    const guildId = await seedGuild();
    const first = await awardXp(guildId, "700000000000000001", {
      key: "message:1",
      kind: "message",
      amount: 100,
    });
    expect(first.applied).toBe(true);
    expect(first.total).toBe(100);
    expect(first.level).toBe(1);
    expect(first.leveledUp).toBe(true);

    const again = await awardXp(guildId, "700000000000000001", {
      key: "message:1",
      kind: "message",
      amount: 100,
    });
    // The same message must never pay twice, however it is redelivered.
    expect(again.applied).toBe(false);
    expect(again.total).toBe(100);
    expect(again.leveledUp).toBe(false);
    expect(again.levelsGained).toBe(0);
  });

  it("pays two different events for the same member", async () => {
    const guildId = await seedGuild();
    await awardXp(guildId, "700000000000000002", {
      key: "message:1",
      kind: "message",
      amount: 20,
    });
    await awardXp(guildId, "700000000000000002", {
      key: "message:2",
      kind: "message",
      amount: 20,
    });
    expect((await getXpTotal(guildId, "700000000000000002")).total).toBe(40);
  });

  it("does not lose an award when two land at once", async () => {
    // The total is incremented in SQL. A read-modify-write would drop one of
    // these and the member would silently lose XP.
    const guildId = await seedGuild();
    const userId = "700000000000000003";
    await Promise.all([
      awardXp(guildId, userId, {
        key: "message:1",
        kind: "message",
        amount: 20,
      }),
      awardXp(guildId, userId, {
        key: "message:2",
        kind: "message",
        amount: 20,
      }),
      awardXp(guildId, userId, { key: "voice:c:0", kind: "voice", amount: 7 }),
    ]);
    expect((await getXpTotal(guildId, userId)).total).toBe(47);
  });

  it("pays a duplicated concurrent award exactly once", async () => {
    // Both calls use the same key. The unique index is the guarantee, so
    // exactly one wins and the total is 20, not 40.
    const guildId = await seedGuild();
    const userId = "700000000000000004";
    const results = await Promise.all([
      awardXp(guildId, userId, {
        key: "message:same",
        kind: "message",
        amount: 20,
      }),
      awardXp(guildId, userId, {
        key: "message:same",
        kind: "message",
        amount: 20,
      }),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect((await getXpTotal(guildId, userId)).total).toBe(20);
  });

  it("splits the total by source", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000005";
    await awardXp(guildId, userId, { key: "m:1", kind: "message", amount: 20 });
    await awardXp(guildId, userId, { key: "v:1", kind: "voice", amount: 7 });
    await awardXp(guildId, userId, { key: "a:1", kind: "adjust", amount: -5 });
    const row = await getXpTotal(guildId, userId);
    expect(row.messageXp).toBe(20);
    expect(row.voiceXp).toBe(7);
    expect(row.adjustedXp).toBe(-5);
    expect(row.total).toBe(22);
  });

  it("never lets a total go negative", async () => {
    // An admin correction larger than the member's total floors at zero; a
    // negative total would make every level calculation nonsense.
    const guildId = await seedGuild();
    const userId = "700000000000000006";
    await awardXp(guildId, userId, { key: "m:1", kind: "message", amount: 20 });
    const after = await awardXp(guildId, userId, {
      key: "a:1",
      kind: "adjust",
      amount: -500,
    });
    expect(after.total).toBe(0);
    expect((await getXpTotal(guildId, userId)).total).toBe(0);
  });

  it("bounds an absurd award instead of trusting it", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000007";
    const result = await awardXp(guildId, userId, {
      key: "m:1",
      kind: "message",
      amount: Number.MAX_SAFE_INTEGER,
    });
    expect(result.total).toBeLessThanOrEqual(1_000_000);
    await awardXp(guildId, userId, {
      key: "m:2",
      kind: "message",
      amount: Number.NaN,
    });
    expect((await getXpTotal(guildId, userId)).total).toBeLessThanOrEqual(
      1_000_000
    );
  });

  it("reports a multi-level jump as one award crossing several levels", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000008";
    const result = await awardXp(guildId, userId, {
      key: "a:bulk",
      kind: "adjust",
      amount: 5000,
    });
    expect(result.previousLevel).toBe(0);
    expect(result.level).toBeGreaterThan(1);
    expect(result.levelsGained).toBe(result.level);
    // Reward reconciliation needs every level crossed, not just the newest.
    expect(result.levelsGained).toBeGreaterThan(1);
  });

  it("keeps XP inside its own guild", async () => {
    const a = await seedGuild();
    const b = await seedGuild();
    await awardXp(a, "700000000000000009", {
      key: "m:1",
      kind: "message",
      amount: 50,
    });
    expect((await getXpTotal(a, "700000000000000009")).total).toBe(50);
    expect((await getXpTotal(b, "700000000000000009")).total).toBe(0);
  });
});

describe("the leaderboard", () => {
  it("orders by total and paginates", async () => {
    const guildId = await seedGuild();
    for (let i = 0; i < 7; i++)
      await awardXp(guildId, `7000000000000001${i}0`, {
        key: `m:${i}`,
        kind: "message",
        amount: (i + 1) * 10,
      });
    const first = await listXpLeaderboard(guildId, { page: 1, pageSize: 3 });
    expect(first.total).toBe(7);
    expect(first.rows).toHaveLength(3);
    expect(first.rows.map((r) => r.total)).toEqual([70, 60, 50]);
    expect(first.rows[0].rank).toBe(1);

    const second = await listXpLeaderboard(guildId, { page: 2, pageSize: 3 });
    expect(second.rows.map((r) => r.rank)).toEqual([4, 5, 6]);
    // No overlap between pages.
    expect(
      second.rows.some((r) => first.rows.some((f) => f.userId === r.userId))
    ).toBe(false);

    const last = await listXpLeaderboard(guildId, { page: 3, pageSize: 3 });
    expect(last.rows).toHaveLength(1);
  });

  it("leaves members with no XP off the board", async () => {
    const guildId = await seedGuild();
    await awardXp(guildId, "700000000000000020", {
      key: "m:1",
      kind: "message",
      amount: 5,
    });
    // A zero total is not a rank.
    expect((await listXpLeaderboard(guildId, {})).total).toBe(1);
  });

  it("does not mix guilds", async () => {
    const a = await seedGuild();
    const b = await seedGuild();
    await awardXp(a, "700000000000000021", {
      key: "m:1",
      kind: "message",
      amount: 30,
    });
    await awardXp(b, "700000000000000022", {
      key: "m:1",
      kind: "message",
      amount: 90,
    });
    const board = await listXpLeaderboard(a, {});
    expect(board.total).toBe(1);
    expect(board.rows[0].userId).toBe("700000000000000021");
  });
});

describe("voice sessions", () => {
  it("opens, advances and closes", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000030";
    await openVoiceSession(guildId, userId, "900000000000000001");
    let [session] = await listVoiceSessions(guildId);
    expect(session.channelId).toBe("900000000000000001");
    expect(session.intervalsAwarded).toBe(0);
    expect(session.lastIntervalAt).toBeNull();

    await markVoiceInterval(guildId, userId, {
      intervalStart: new Date("2026-01-01T00:00:00Z"),
      broken: false,
    });
    [session] = await listVoiceSessions(guildId);
    expect(session.intervalsAwarded).toBe(1);
    expect(session.lastIntervalAt).toBe("2026-01-01T00:00:00.000Z");

    await closeVoiceSession(guildId, userId);
    expect(await listVoiceSessions(guildId)).toEqual([]);
  });

  it("remembers that an interval was broken, and forgets when it heals", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000031";
    await openVoiceSession(guildId, userId, "900000000000000002");
    await markVoiceInterval(guildId, userId, {
      intervalStart: new Date(),
      broken: true,
    });
    expect((await listVoiceSessions(guildId))[0].brokenAt).not.toBeNull();
    await markVoiceInterval(guildId, userId, {
      intervalStart: new Date(),
      broken: false,
    });
    expect((await listVoiceSessions(guildId))[0].brokenAt).toBeNull();
  });

  it("restarts a session on a channel move", async () => {
    // Moving channel ends one session and starts another, which is what makes
    // "present for the whole interval" answerable.
    const guildId = await seedGuild();
    const userId = "700000000000000032";
    await openVoiceSession(guildId, userId, "900000000000000003");
    await markVoiceInterval(guildId, userId, {
      intervalStart: new Date(),
      broken: false,
    });
    await openVoiceSession(guildId, userId, "900000000000000004");
    const [session] = await listVoiceSessions(guildId);
    expect(session.channelId).toBe("900000000000000004");
    expect(session.intervalsAwarded).toBe(0);
    expect(session.lastIntervalAt).toBeNull();
  });
});

describe("reward grants", () => {
  it("records a success and a failure the same way", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000040";
    await recordRewardGrant({
      guildId,
      userId,
      level: 5,
      roleId: "900000000000000010",
      grantedAt: new Date().toISOString(),
      error: null,
    });
    await recordRewardGrant({
      guildId,
      userId,
      level: 10,
      roleId: "900000000000000011",
      grantedAt: null,
      error: "Missing permissions",
    });
    const grants = await listRewardGrants(guildId, userId);
    expect(grants).toHaveLength(2);
    // A failed grant is still recorded, so a later reconcile can retry it and
    // an announcement is not sent twice.
    expect(grants.find((g) => g.level === 10)?.error).toBe(
      "Missing permissions"
    );
    expect(grants.find((g) => g.level === 10)?.grantedAt).toBeNull();
  });

  it("updates rather than duplicating when reconciled twice", async () => {
    const guildId = await seedGuild();
    const userId = "700000000000000041";
    await recordRewardGrant({
      guildId,
      userId,
      level: 5,
      roleId: "900000000000000012",
      grantedAt: null,
      error: "Missing permissions",
    });
    await recordRewardGrant({
      guildId,
      userId,
      level: 5,
      roleId: "900000000000000012",
      grantedAt: new Date().toISOString(),
      error: null,
    });
    const grants = await listRewardGrants(guildId, userId);
    expect(grants).toHaveLength(1);
    expect(grants[0].grantedAt).not.toBeNull();
    expect(grants[0].error).toBeNull();
  });
});

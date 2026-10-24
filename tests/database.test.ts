import { defaultConfig } from "@orbit/core";
import {
  closeDb,
  database,
  deleteResource,
  economyTransaction,
  getResource,
  queryHistory,
  getAccount,
  reserveDelivery,
  saveConfig,
  saveResource,
} from "@orbit/db";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as s from "../packages/db/src/schema";
// PGlite runs real PostgreSQL in WASM for local SQL/transaction tests.
// CI sets TEST_DATABASE_URL to also exercise pg, row locks and concurrent connections.
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
const g1 = "990000000000000001",
  g2 = "990000000000000002",
  u1 = "990000000000000101",
  u2 = "990000000000000102";
const actor = { id: u1, name: "Test owner" };
const ids = {
  role: "990000000000000201",
  admin: "990000000000000202",
  channel1: "990000000000000301",
  channel2: "990000000000000302",
};
const input = (extra: Record<string, any> = {}) => ({
  guildId: g1,
  userId: u1,
  userName: "Test member",
  type: "daily" as const,
  key: randomUUID(),
  ...extra,
});
const account = async (guildId = g1, userId = u1) =>
  (
    await database()
      .db.select()
      .from(s.accounts)
      .where(
        and(eq(s.accounts.guildId, guildId), eq(s.accounts.userId, userId))
      )
  )[0];
beforeAll(async () => {
  vi.stubEnv("DEMO_MODE", "false");
  if (process.env.TEST_DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(database().db, { migrationsFolder: "./drizzle" });
  }
}, 30000);
afterAll(async () => {
  await database()
    .db.delete(s.guilds)
    .where(sql`${s.guilds.id} IN (${g1},${g2})`);
  await closeDb();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  const db = database().db;
  await db.delete(s.guilds).where(sql`${s.guilds.id} IN (${g1},${g2})`);
  for (const id of [g1, g2])
    await db.insert(s.guilds).values({
      id,
      name: "Test community",
      installed: true,
      memberCount: 2,
      config: structuredClone(defaultConfig),
      botRolePosition: 10,
      roles: [
        {
          id: ids.role,
          name: "Community",
          position: 2,
          permissions: "0",
          managed: false,
          color: "#aaa",
        },
        {
          id: ids.admin,
          name: "Admin",
          position: 5,
          permissions: "8",
          managed: false,
          color: "#e00",
        },
      ],
      channels: [
        {
          id: id === g1 ? ids.channel1 : ids.channel2,
          name: "updates",
          type: "text",
          canSend: true,
        },
      ],
    });
});
describe("atomic PostgreSQL economy transactions", () => {
  it("awards exactly one daily reward under concurrent distinct requests", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => economyTransaction(input()))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await account()).balance).toBe(250);
    expect(await database().db.select().from(s.ledger)).toHaveLength(1);
  });
  it("replays the same idempotency key without creating duplicate ledger entries", async () => {
    const i = input();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => economyTransaction(i))
    );
    expect(results.filter((r) => r.replayed)).toHaveLength(7);
    expect((await account()).balance).toBe(250);
    expect(await database().db.select().from(s.ledger)).toHaveLength(1);
  });
  it("rejects reuse of an idempotency key for a different operation", async () => {
    const i = input();
    await economyTransaction(i);
    await expect(
      economyTransaction({ ...i, type: "transfer", toUserId: u2, amount: 20 })
    ).rejects.toThrow("different operation");
    expect((await account()).balance).toBe(250);
  });
  it("never overdraws concurrent transfers and conserves currency", async () => {
    await economyTransaction(input());
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        economyTransaction(
          input({ type: "transfer", toUserId: u2, amount: 100 })
        )
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await account()).balance).toBe(50);
    expect((await account(g1, u2)).balance).toBe(200);
    const entries = await database()
      .db.select()
      .from(s.ledger)
      .where(eq(s.ledger.type, "transfer"));
    expect(entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
    expect(entries).toHaveLength(4);
  });
  it("keeps transfers isolated to their own server", async () => {
    await economyTransaction(input());
    await economyTransaction(input({ guildId: g2 }));
    await economyTransaction(
      input({ type: "transfer", toUserId: u2, amount: 100 })
    );
    expect((await account(g2)).balance).toBe(250);
    expect(await account(g2, u2)).toBeUndefined();
  });
  it("validates amounts and forbids self-transfers", async () => {
    for (const amount of [-1, 0, 1.5, NaN, Infinity, 100000001])
      await expect(
        economyTransaction(input({ type: "transfer", amount, toUserId: u2 }))
      ).rejects.toThrow();
    await expect(
      economyTransaction(input({ type: "transfer", amount: 1, toUserId: u1 }))
    ).rejects.toThrow("another");
  });
  it("enforces the daily window even with a new idempotency key", async () => {
    await economyTransaction(input());
    await expect(economyTransaction(input())).rejects.toThrow("24 hours");
    await database()
      .db.update(s.accounts)
      .set({ lastDaily: new Date(Date.now() - 86401000) })
      .where(eq(s.accounts.userId, u1));
    await economyTransaction(input());
    expect((await account()).balance).toBe(500);
  });
  it("enforces activity cooldowns under concurrency", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        economyTransaction(input({ type: "activity" }))
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await account()).balance).toBe(10);
  });
  it("sells the last stock unit once and atomically records the entitlement", async () => {
    await economyTransaction(input());
    await economyTransaction(input({ userId: u2 }));
    const item = await saveResource(
      g1,
      "shop",
      {
        name: "One little ticket",
        enabled: true,
        data: {
          description: "",
          type: "item",
          roleId: "",
          price: 100,
          stock: 1,
          emoji: "🎫",
        },
      },
      actor
    );
    const results = await Promise.allSettled(
      [u1, u2].map((userId) =>
        economyTransaction(input({ userId, type: "purchase", itemId: item.id }))
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getResource(g1, item.id))?.data.stock).toBe(0);
    expect((await account()).balance + (await account(g1, u2)).balance).toBe(
      400
    );
    const inventory = await database().db.select().from(s.inventory);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].quantity).toBe(1);
  });
  it("rolls back a failed purchase without a debit or operation receipt", async () => {
    await economyTransaction(input());
    const item = await saveResource(
      g1,
      "shop",
      {
        name: "Expensive reward",
        enabled: true,
        data: {
          description: "",
          type: "item",
          roleId: "",
          price: 1000,
          stock: 1,
          emoji: "✦",
        },
      },
      actor
    );
    await expect(
      economyTransaction(input({ type: "purchase", itemId: item.id }))
    ).rejects.toThrow("Insufficient");
    expect((await account()).balance).toBe(250);
    expect((await getResource(g1, item.id))?.data.stock).toBe(1);
    expect(await database().db.select().from(s.inventory)).toHaveLength(0);
  });
  it("enforces nonnegative balances even for direct SQL writes", async () => {
    await expect(
      database()
        .db.insert(s.accounts)
        .values({ guildId: g1, userId: u1, name: "Test", balance: -1 })
    ).rejects.toThrow();
  });
  it("respects live module configuration without a restart", async () => {
    const config = structuredClone(defaultConfig);
    config.modules.economy = false;
    await saveConfig(g1, config, actor);
    await expect(economyTransaction(input())).rejects.toThrow("disabled");
  });
});
describe("persistent feed deduplication and tenant isolation", () => {
  const delivery = (extra: Record<string, any> = {}) => ({
    guildId: g1,
    sourceId: "source-a",
    externalId: "event-1",
    title: "Community update",
    url: "https://example.com/story",
    channelId: ids.channel1,
    ...extra,
  });
  it("reserves one event per source and destination under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, () => reserveDelivery(delivery()))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await database().db.select().from(s.deliveries)).toHaveLength(1);
  });
  it("allows the same event in a different server, source, or destination", async () => {
    await reserveDelivery(delivery());
    expect(await reserveDelivery(delivery())).toBeNull();
    expect(
      await reserveDelivery(delivery({ guildId: g2, channelId: ids.channel2 }))
    ).not.toBeNull();
    expect(
      await reserveDelivery(delivery({ sourceId: "source-b" }))
    ).not.toBeNull();
    expect(
      await reserveDelivery(delivery({ channelId: ids.channel2 }))
    ).not.toBeNull();
  });
  it("never reads, updates, or deletes another server’s resource by ID", async () => {
    const r = await saveResource(
      g1,
      "rule",
      {
        name: "Spam protection",
        enabled: true,
        data: {
          type: "spam",
          threshold: 5,
          windowSeconds: 10,
          action: "warn",
          durationMinutes: 10,
          terms: [],
          exemptRoleIds: [],
          exemptChannelIds: [],
        },
      },
      actor
    );
    expect(await getResource(g2, r.id)).toBeNull();
    await expect(
      saveResource(
        g2,
        "rule",
        { name: "Hacked setting", enabled: false, data: r.data },
        actor,
        r.id
      )
    ).rejects.toThrow("not found");
    await expect(deleteResource(g2, "rule", r.id, actor)).rejects.toThrow(
      "not found"
    );
    expect((await getResource(g1, r.id))?.name).toBe("Spam protection");
  });
  it("rejects cross-server channels and privileged self-roles", async () => {
    const panel = {
      name: "Unsafe panel",
      enabled: true,
      data: {
        description: "",
        channelId: ids.channel2,
        roleIds: [ids.role],
        mode: "buttons",
        selection: "single",
        maxRoles: 1,
        prerequisiteIds: [],
        exclusiveRoleIds: [],
        emojis: [],
      },
    };
    await expect(saveResource(g1, "panel", panel, actor)).rejects.toThrow(
      "belonging"
    );
    await expect(
      saveResource(
        g1,
        "panel",
        {
          ...panel,
          data: {
            ...panel.data,
            channelId: ids.channel1,
            roleIds: [ids.admin],
          },
        },
        actor
      )
    ).rejects.toThrow("elevated");
  });
  it("writes configuration and its audit record together", async () => {
    const r = await saveResource(
      g1,
      "rule",
      { name: "A transparent change", enabled: true, data: { type: "spam" } },
      actor
    );
    const logs = await database()
      .db.select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.guildId, g1));
    expect(logs).toHaveLength(1);
    expect(logs[0].target).toBe(r.name);
    expect(logs[0].actorId).toBe(u1);
  });
});

describe("complete server-paginated history and exact wallets", () => {
  it("searches all retained records, not just a recent dashboard window", async () => {
    for (let n = 0; n < 19; n++)
      await saveResource(
        g1,
        "rule",
        { name: `History item ${n}`, enabled: true, data: { type: "spam" } },
        actor
      );
    const first = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "History item",
      filter: "created",
    });
    const third = await queryHistory(g1, "audit", {
      page: 3,
      pageSize: 7,
      query: "History item",
      filter: "created",
    });
    expect(first.total).toBe(19);
    expect(first.rows).toHaveLength(7);
    expect(third.rows).toHaveLength(5);
    expect(
      (
        await queryHistory(g2, "audit", {
          page: 1,
          pageSize: 7,
          query: "",
          filter: "all",
        })
      ).total
    ).toBe(0);
  });
  it("retrieves an exact wallet independently of leaderboard limits", async () => {
    await economyTransaction(input());
    expect((await getAccount(g1, u1))?.balance).toBe(250);
    expect(await getAccount(g2, u1)).toBeNull();
  });
  it("filters both ledger legs with server isolation and total counts", async () => {
    await economyTransaction(input());
    await economyTransaction(
      input({
        type: "transfer",
        amount: 50,
        toUserId: u2,
        note: "A searchable thank-you",
      })
    );
    const page = await queryHistory(g1, "ledger", {
      page: 1,
      pageSize: 1,
      query: "thank-you",
      filter: "transfer",
    });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(
      (
        await queryHistory(g2, "ledger", {
          page: 1,
          pageSize: 7,
          query: "",
          filter: "all",
        })
      ).total
    ).toBe(0);
  });
});

import { refreshProfile } from "../apps/web/lib/auth";
vi.mock("server-only", () => ({}));
import * as community from "../packages/db/src/community";
import * as communityStore from "../packages/db/src/store";
import * as ownHistory from "../packages/db/src/history";
import { defaultConfig } from "@orbit/core";
import {
  audit,
  activityCounts,
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
  it("captures the actor avatar at the interaction and keeps it current, not historical", async () => {
    const first = "a_0123456789abcdef0123456789abcdef";
    const second = "0123456789abcdef0123456789abcdef";
    await economyTransaction(input({ userAvatar: first }));
    expect((await account()).avatar).toBe(first);
    // A later interaction that carries a newer hash refreshes the stored
    // identity (a transfer is used because daily and activity are rate limited).
    await economyTransaction(
      input({ type: "transfer", toUserId: u2, amount: 25, userAvatar: second })
    );
    expect((await account()).avatar).toBe(second);
    // An interaction with no hash (a caller without a member object) must not
    // erase what is already known.
    await economyTransaction(
      input({ type: "transfer", toUserId: u2, amount: 25 })
    );
    expect((await account()).avatar).toBe(second);
  });
  it("stores a transfer recipient's display name and avatar instead of their id", async () => {
    await economyTransaction(input());
    await economyTransaction(
      input({
        type: "transfer",
        toUserId: u2,
        amount: 50,
        toUserName: "Recipient name",
        toUserAvatar: "0123456789abcdef0123456789abcdef",
      })
    );
    const recipient = await account(g1, u2);
    expect(recipient.name).toBe("Recipient name");
    expect(recipient.avatar).toBe("0123456789abcdef0123456789abcdef");
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
  it("stores multiline errors safely and retrieves the exact detail with server isolation", async () => {
    const detail = `Source lookup failed\n\tjava.example.Loader.<init>\n${"nested detail ".repeat(140)}`;
    await audit(g1, actor, "failed", "music", detail);
    const page = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "",
      filter: "failed",
    });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ detail });
    expect(
      (
        await queryHistory(g2, "audit", {
          page: 1,
          pageSize: 7,
          query: "",
          filter: "failed",
        })
      ).total
    ).toBe(0);
  });
  it("keeps a one-line summary and the full diagnostic apart", async () => {
    const summary =
      "YouTube playback failed (provider-login): this video requires login";
    const details =
      "Client [ANDROID_VR] failed: This video requires login.\nClient [WEB] failed: No supported audio streams available.";
    await audit(g1, actor, "failed", "music playback", summary, { details });
    const page = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "",
      filter: "failed",
    });
    expect(page.rows[0]).toMatchObject({ detail: summary, details });
    // Old rows predate the column and still serialize (null, not undefined).
    await audit(g1, actor, "failed", "music", "A legacy summary");
    const legacy = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "legacy",
      filter: "failed",
    });
    expect(legacy.rows[0]).toMatchObject({ detail: "A legacy summary" });
    expect(legacy.rows[0].details ?? null).toBeNull();
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

describe("complete zoned activity chart SQL", () => {
  it("aggregates all rewards rather than latest history, isolates tenants and matches calendar labels across DST", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      guildId: g1,
      userId: index % 2 ? u1 : u2,
      type: "activity",
      amount: 10,
      key: randomUUID(),
      note: "test",
      createdAt: new Date("2026-10-25T01:30:00Z"),
    }));
    rows.push(
      {
        ...rows[0],
        key: randomUUID(),
        createdAt: new Date("2026-10-24T22:00:00Z"),
      },
      {
        ...rows[0],
        key: randomUUID(),
        createdAt: new Date("2026-10-25T00:30:00Z"),
      },
      {
        ...rows[0],
        key: randomUUID(),
        createdAt: new Date("2026-10-25T23:00:00Z"),
      },
      {
        ...rows[0],
        key: randomUUID(),
        createdAt: new Date("2026-10-24T21:59:59Z"),
      },
      {
        ...rows[0],
        key: randomUUID(),
        createdAt: new Date("2026-10-26T00:00:00Z"),
      },
      {
        ...rows[0],
        key: randomUUID(),
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      { ...rows[0], key: randomUUID(), guildId: g2 },
      { ...rows[0], key: randomUUID(), type: "transfer" },
      { ...rows[0], key: randomUUID(), type: "daily" }
    );
    await database().db.insert(s.ledger).values(rows);
    const result = await activityCounts(
      g1,
      "Europe/Berlin",
      "2026-10-25T23:30:00Z"
    );
    expect(result.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "2026-10-24", events: 1, members: 1 },
      { key: "2026-10-25", events: 252, members: 2 },
      { key: "2026-10-26", events: 1, members: 1 },
    ]);
  });
});

// The same suite runs on isolated real PostgreSQL in CI, or SQL-capable PGlite locally.
describe("opt-in community post lifecycle and own-account history", () => {
  async function enabled() {
    const config = structuredClone(defaultConfig);
    config.modules.polls = true;
    config.modules.announcements = true;
    await database()
      .db.update(s.guilds)
      .set({
        config,
        channels: [
          {
            id: ids.channel1,
            name: "updates",
            type: "text",
            canSend: true,
            supportsCommunityPosts: true,
          },
        ],
      })
      .where(eq(s.guilds.id, g1));
  }
  const draft = () => ({
    kind: "announcement",
    title: "A one-time notice",
    channelId: ids.channel1,
    body: "Join us for game night.",
    poll: null,
  });
  async function create() {
    await enabled();
    return community.createCommunityPost(g1, u1, draft(), randomUUID());
  }
  it("defaults legacy absent keys to false and blocks creation until enabled", async () => {
    const config = structuredClone(defaultConfig) as any;
    delete config.modules.polls;
    delete config.modules.announcements;
    delete config.music.maxPerMember;
    await database()
      .db.update(s.guilds)
      .set({ config })
      .where(eq(s.guilds.id, g1));
    expect((await communityStore.getGuild(g1))?.config).toMatchObject({
      modules: { polls: false, announcements: false },
      music: { maxPerMember: 0 },
    });
    await expect(
      community.createCommunityPost(g1, u1, draft(), randomUUID())
    ).rejects.toThrow(/paused/);
    expect(
      (await community.listCommunityPosts(g1, { kind: "announcement" })).total
    ).toBe(0);
  });
  it("makes duplicate create requests idempotent without sending", async () => {
    await enabled();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      community.createCommunityPost(g1, u1, draft(), key),
      community.createCommunityPost(g1, u1, draft(), key),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.state).toBe("draft");
    expect(
      (await community.listCommunityPosts(g1, { kind: "announcement" })).total
    ).toBe(1);
    await expect(
      community.createCommunityPost(
        g1,
        u1,
        { ...draft(), body: "Different" },
        key
      )
    ).rejects.toThrow(/idempotency key/);
  });
  it("scopes reads, editing, claims and deletion to the selected guild", async () => {
    const p = await create();
    expect(await community.getCommunityPost(g2, p.id)).toBeNull();
    expect(
      (await community.listCommunityPosts(g2, { kind: "announcement" })).items
    ).toEqual([]);
    await expect(
      community.editCommunityPost(g2, p.id, 1, u2, draft())
    ).rejects.toThrow(/not found/);
    await expect(
      community.deleteCommunityPost(g2, p.id, 1, u2)
    ).rejects.toThrow(/not found/);
    await expect(
      community.editCommunityPost(g1, p.id, 1, u1, {
        ...draft(),
        channelId: ids.channel2,
      })
    ).rejects.toThrow(/in this server/);
    expect((await community.getCommunityPost(g1, p.id))?.version).toBe(1);
  });
  it("rejects malformed post identifiers before PostgreSQL UUID casts", async () => {
    await enabled();
    expect(await community.getCommunityPost(g1, "not-a-uuid")).toBeNull();
    await expect(
      community.deleteCommunityPost(g1, "not-a-uuid", 1, u1)
    ).rejects.toThrow();
    await expect(
      community.cancelCommunityPost(g1, "not-a-uuid", 1, u1)
    ).rejects.toThrow();
    expect(await communityStore.getResource(g1, "not-a-uuid")).toBeNull();
  });
  it("checks an expired publication deadline inside the atomic claim", async () => {
    const p = await create();
    await expect(
      community.claimCommunityPost(
        g1,
        p.id,
        1,
        u1,
        false,
        undefined,
        Date.now() - 1
      )
    ).rejects.toThrow(/expired/);
    expect((await community.getCommunityPost(g1, p.id))?.state).toBe("draft");
  });
  it("rejects known-unsupported announcement channel subtypes instead of saving an unusable draft", async () => {
    await enabled();
    await database()
      .db.update(s.guilds)
      .set({
        channels: [
          {
            id: ids.channel1,
            name: "news channel",
            type: "text",
            canSend: true,
            supportsCommunityPosts: false,
          },
        ],
      })
      .where(eq(s.guilds.id, g1));
    await expect(
      community.createCommunityPost(g1, u1, draft(), randomUUID())
    ).rejects.toThrow(/supported server text channel/);
    expect(
      (await community.listCommunityPosts(g1, { kind: "announcement" })).total
    ).toBe(0);
  });
  it("atomically grants only one concurrent publication claim", async () => {
    const p = await create();
    const results = await Promise.allSettled([
      community.claimCommunityPost(g1, p.id, 1, u1, false),
      community.claimCommunityPost(g1, p.id, 1, u1, false),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await community.getCommunityPost(g1, p.id))?.state).toBe("sending");
    await expect(
      community.deleteCommunityPost(g1, p.id, 2, u1)
    ).rejects.toThrow(/settle/);
  });
  it("serializes cancellation against a claim and invalidates queued revisions", async () => {
    const p = await create();
    const results = await Promise.allSettled([
      community.cancelCommunityPost(g1, p.id, 1, u1),
      community.claimCommunityPost(g1, p.id, 1, u1, false),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const current = await community.getCommunityPost(g1, p.id);
    expect(["sending", "cancelled"]).toContain(current?.state);
    await expect(
      community.claimCommunityPost(g1, p.id, 1, u1, false)
    ).rejects.toThrow(/changed/);
  });
  it("preserves unconfirmed state and never permits a blind retry", async () => {
    const p = await create(),
      claim = await community.claimCommunityPost(g1, p.id, 1, u1, false);
    const ambiguous = await community.finishCommunityPost(
      g1,
      p.id,
      claim.version,
      u1,
      { state: "unconfirmed", error: "No acknowledgement" }
    );
    await expect(
      community.claimCommunityPost(g1, p.id, ambiguous.version, u1, false)
    ).rejects.toThrow(/blindly/);
    await expect(
      community.editCommunityPost(g1, p.id, ambiguous.version, u1, draft())
    ).rejects.toThrow(/unsent drafts/);
  });
  it("rechecks paused/removed guilds at the atomic claim, not just admission", async () => {
    const p = await create();
    await database()
      .db.update(s.guilds)
      .set({ config: defaultConfig })
      .where(eq(s.guilds.id, g1));
    await expect(
      community.claimCommunityPost(g1, p.id, 1, u1, false)
    ).rejects.toThrow(/paused/);
    const cancelled = await community.cancelCommunityPost(g1, p.id, 1, u1);
    expect(cancelled.state).toBe("cancelled");
    await database()
      .db.update(s.guilds)
      .set({ installed: false })
      .where(eq(s.guilds.id, g1));
    await expect(
      community.cancelCommunityPost(g1, p.id, cancelled.version, u1)
    ).rejects.toThrow(/Install Orbit/);
  });
  it("tracks the actual scheduling approver, expires old notices and never catches up", async () => {
    const p = await create(),
      due = Date.now() + 120_000;
    const scheduled = await community.scheduleCommunityPost(
      g1,
      p.id,
      1,
      u2,
      new Date(due).toISOString()
    );
    expect(scheduled.actorId).toBe(u2);
    const dueRows = await community.maintainCommunityPosts(due + 1000);
    expect(dueRows.map((r) => r.id)).toContain(p.id);
    await expect(
      community.claimCommunityPost(
        g1,
        p.id,
        scheduled.version,
        u1,
        true,
        due + 1000
      )
    ).rejects.toThrow(/approving manager/);
    await community.maintainCommunityPosts(due + 15 * 60000 + 1);
    expect((await community.getCommunityPost(g1, p.id))?.state).toBe("missed");
    expect(await community.maintainCommunityPosts(due + 86400000)).toEqual([]);
  });
  it("recovers abandoned sends as unconfirmed without changing the claim token", async () => {
    const p = await create(),
      claim = await community.claimCommunityPost(g1, p.id, 1, u1, false);
    await database()
      .db.update(s.communityPosts)
      .set({ attemptedAt: new Date(Date.now() - 180000) })
      .where(eq(s.communityPosts.id, p.id));
    await community.maintainCommunityPosts();
    expect(await community.getCommunityPost(g1, p.id)).toMatchObject({
      state: "unconfirmed",
      version: claim.version,
    });
    // If the original in-flight caller finally receives a definite acceptance, record it, never create again.
    await community.finishCommunityPost(g1, p.id, claim.version, u1, {
      state: "published",
      messageId: "990000000000000901",
    });
    expect((await community.getCommunityPost(g1, p.id))?.state).toBe(
      "published"
    );
  });
  it("bounds publication volume even after stored post records are deleted", async () => {
    await enabled();
    for (let i = 0; i < 10; i++) {
      const p = await community.createCommunityPost(
        g1,
        u1,
        draft(),
        randomUUID()
      );
      const claim = await community.claimCommunityPost(g1, p.id, 1, u1, false);
      const sent = await community.finishCommunityPost(
        g1,
        p.id,
        claim.version,
        u1,
        {
          state: "published",
          messageId: `9900000000000009${String(i).padStart(2, "0")}`,
        }
      );
      await community.deleteCommunityPost(g1, p.id, sent.version, u1);
    }
    const next = await community.createCommunityPost(
      g1,
      u1,
      draft(),
      randomUUID()
    );
    await expect(
      community.claimCommunityPost(g1, next.id, 1, u1, false)
    ).rejects.toThrow(/10 posts/);
  });
  it("removes inactive stored content after retention without retaining its text in audit", async () => {
    const p = await create();
    await database()
      .db.update(s.communityPosts)
      .set({ updatedAt: new Date(Date.now() - 91 * 86400000) })
      .where(eq(s.communityPosts.id, p.id));
    await community.maintainCommunityPosts();
    expect(await community.getCommunityPost(g1, p.id)).toBeNull();
    const rows = await database()
      .db.select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.guildId, g1));
    expect(JSON.stringify(rows)).not.toContain(p.body);
    expect(JSON.stringify(rows)).not.toContain(p.title);
  });
  it("bounds stored posts and validates SQL pagination/state filters", async () => {
    await enabled();
    await database()
      .db.insert(s.communityPosts)
      .values(
        Array.from({ length: 200 }, (_, i) => ({
          guildId: g1,
          kind: "announcement" as const,
          title: `Notice ${i}`,
          channelId: ids.channel1,
          body: "Unsent",
          actorId: u1,
          requestKey: randomUUID(),
        }))
      );
    await expect(
      community.createCommunityPost(g1, u1, draft(), randomUUID())
    ).rejects.toThrow(/200-post/);
    expect(
      await community.listCommunityPosts(g1, {
        kind: "announcement",
        page: 10,
        pageSize: 20,
      })
    ).toMatchObject({ total: 200, items: expect.any(Array) });
    expect(
      (
        await community.listCommunityPosts(g1, {
          kind: "announcement",
          page: 10,
          pageSize: 20,
        })
      ).items
    ).toHaveLength(20);
  });
  it("does not enqueue overdue schedules beyond the bounded maintenance batch", async () => {
    await enabled();
    const now = Date.now();
    await database()
      .db.insert(s.communityPosts)
      .values(
        Array.from({ length: 101 }, (_, i) => ({
          guildId: g1,
          kind: "announcement" as const,
          title: `Overdue ${i}`,
          channelId: ids.channel1,
          body: "Unsent",
          actorId: u1,
          requestKey: randomUUID(),
          state: "scheduled" as const,
          scheduledFor: new Date(now - 20 * 60000),
        }))
      );
    expect(await community.maintainCommunityPosts(now)).toEqual([]);
    const [remaining] = await database()
      .db.select({ n: sql<number>`count(*)::int` })
      .from(s.communityPosts)
      .where(
        and(
          eq(s.communityPosts.guildId, g1),
          eq(s.communityPosts.state, "scheduled")
        )
      );
    expect(remaining.n).toBe(1); // next minute processes the remaining record, never sends it
  });
  it("returns only the authenticated user's ledger in that guild with stable paging", async () => {
    for (const [gid, uid, note] of [
      [g1, u1, "Own"],
      [g1, u2, "Other member"],
      [g2, u1, "Other guild"],
    ])
      await database().db.insert(s.ledger).values({
        guildId: gid,
        userId: uid,
        amount: 10,
        type: "daily",
        key: randomUUID(),
        note,
      });
    for (let i = 0; i < 12; i++)
      await database()
        .db.insert(s.ledger)
        .values({
          guildId: g1,
          userId: u1,
          amount: i,
          type: "activity",
          key: randomUUID(),
          note: `Own ${i}`,
        });
    const first = await ownHistory.getOwnEconomyHistory(g1, u1, {
        page: 1,
        pageSize: 5,
      }),
      second = await ownHistory.getOwnEconomyHistory(g1, u1, {
        page: 2,
        pageSize: 5,
      });
    expect(first.total).toBe(13);
    expect(first.rows).toHaveLength(5);
    expect(first.rows.every((r) => r.guildId === g1 && r.userId === u1)).toBe(
      true
    );
    expect(first.rows.some((a) => second.rows.some((b) => a.id === b.id))).toBe(
      false
    );
    expect(JSON.stringify([...first.rows, ...second.rows])).not.toMatch(
      /Other member|Other guild/
    );
    await expect(
      ownHistory.getOwnEconomyHistory(g1, u1, { pageSize: 21 })
    ).rejects.toThrow();
  });
});

describe("profile refresh SQL ownership and session lifetime", () => {
  async function storedSession(
    userId: string,
    expiresAt = new Date(Date.now() + 60000)
  ) {
    const id = `identity-test-${randomUUID()}`;
    await database()
      .db.insert(s.sessions)
      .values({
        id,
        userId,
        name: "Original account",
        avatar: null,
        accessToken: "test-only-encrypted-token-placeholder",
        refreshToken: "test-only-refresh-placeholder",
        tokenExpiresAt: new Date(Date.now() + 60000),
        expiresAt,
      });
    return id;
  }
  function upstreamProfile() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Response.json({
          id: u1,
          username: "current_username",
          global_name: "Updated global name",
          avatar: "0123456789abcdef0123456789abcdef",
        })
      )
    );
  }
  it("updates only the matching session/account and refuses a foreign session ID", async () => {
    const own = await storedSession(u1),
      foreign = await storedSession(u2);
    const user = {
      id: u1,
      sessionId: own,
      name: "Original account",
      avatar: null,
      accessToken: "test-access",
    };
    upstreamProfile();
    try {
      expect(await refreshProfile(user)).toMatchObject({
        name: "Updated global name",
        avatar: "0123456789abcdef0123456789abcdef",
      });
      await expect(
        refreshProfile({ ...user, sessionId: foreign })
      ).rejects.toMatchObject({ status: 401 });
      const rows = await database()
        .db.select()
        .from(s.sessions)
        .where(sql`${s.sessions.id} IN (${own},${foreign})`);
      expect(rows.find((row) => row.id === own)).toMatchObject({
        userId: u1,
        name: "Updated global name",
        accessToken: "test-only-encrypted-token-placeholder",
      });
      expect(rows.find((row) => row.id === foreign)).toMatchObject({
        userId: u2,
        name: "Original account",
        avatar: null,
      });
    } finally {
      vi.unstubAllGlobals();
      await database()
        .db.delete(s.sessions)
        .where(sql`${s.sessions.id} IN (${own},${foreign})`);
    }
  });
  it("does not update expired sessions or recreate a session revoked during the upstream request", async () => {
    const id = await storedSession(u1, new Date(Date.now() - 1000));
    const user = {
      id: u1,
      sessionId: id,
      name: "Original account",
      avatar: null,
      accessToken: "test-access",
    };
    upstreamProfile();
    try {
      await expect(refreshProfile(user)).rejects.toMatchObject({ status: 401 });
      const [row] = await database()
        .db.select()
        .from(s.sessions)
        .where(eq(s.sessions.id, id));
      expect(row.name).toBe("Original account");
      await database()
        .db.update(s.sessions)
        .set({ expiresAt: new Date(Date.now() + 60000) })
        .where(eq(s.sessions.id, id));
      vi.mocked(fetch).mockImplementationOnce(async () => {
        // Revoke after the caller captured its identity, while Discord is in flight.
        await database().db.delete(s.sessions).where(eq(s.sessions.id, id));
        return Response.json({
          id: u1,
          username: "current_username",
          global_name: "Updated global name",
          avatar: "0123456789abcdef0123456789abcdef",
        });
      });
      await expect(refreshProfile(user)).rejects.toMatchObject({ status: 401 });
      expect(
        await database()
          .db.select()
          .from(s.sessions)
          .where(eq(s.sessions.id, id))
      ).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await database().db.delete(s.sessions).where(eq(s.sessions.id, id));
    }
  });
});

describe("server-side history ordering", () => {
  beforeEach(async () => {
    await database().db.delete(s.auditLogs).where(eq(s.auditLogs.guildId, g1));
  });

  it("orders by an allowed text field in both directions", async () => {
    await audit(g1, { id: u1, name: "zoe" }, "created", "roles", "first");
    await audit(g1, { id: u1, name: "alice" }, "updated", "news", "second");
    await audit(g1, { id: u1, name: "mike" }, "deleted", "deals", "third");

    const asc = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "",
      filter: "all",
      sort: "actorName",
      dir: "asc",
    });
    expect(asc.rows.map((r) => r.actorName)).toEqual(["alice", "mike", "zoe"]);

    const desc = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "",
      filter: "all",
      sort: "actorName",
      dir: "desc",
    });
    expect(desc.rows.map((r) => r.actorName)).toEqual(["zoe", "mike", "alice"]);
    // Ordering never changes which rows match: same filter, same total.
    expect(desc.total).toBe(asc.total);
  });

  it("keeps the default newest-first order when nothing is requested", async () => {
    await audit(g1, actor, "created", "roles", "older");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await audit(g1, actor, "updated", "roles", "newer");
    const page = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 7,
      query: "",
      filter: "all",
    });
    expect(page.rows[0].detail).toBe("newer");
    expect(page.rows[1].detail).toBe("older");
  });

  it("rejects a field the screen does not show for that dataset", async () => {
    // "amount" belongs to the ledger; sorting audit logs by it would be an
    // invented column, so it must fail rather than silently fall back.
    await expect(
      queryHistory(g1, "audit", {
        page: 1,
        pageSize: 7,
        query: "",
        filter: "all",
        sort: "amount" as never,
        dir: "asc",
      })
    ).rejects.toThrow('Cannot sort audit history by "amount"');
  });

  it("pages a sorted result without repeating or skipping rows", async () => {
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"])
      await audit(g1, { id: u1, name }, "created", "roles", name);
    const first = await queryHistory(g1, "audit", {
      page: 1,
      pageSize: 3,
      query: "",
      filter: "all",
      sort: "actorName",
      dir: "asc",
    });
    const second = await queryHistory(g1, "audit", {
      page: 2,
      pageSize: 3,
      query: "",
      filter: "all",
      sort: "actorName",
      dir: "asc",
    });
    expect(first.rows.map((r) => r.actorName)).toEqual(["a", "b", "c"]);
    expect(second.rows.map((r) => r.actorName)).toEqual(["d", "e", "f"]);
    expect(first.total).toBe(8);
  });
});

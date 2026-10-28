/**
 * The news re-post storm.
 *
 * Root cause: `deliveries` was deduplicated by
 * `(guild_id, source_id, external_id, channel_id)`. `source_id` is the row id
 * of the resource, not anything about the feed, so deleting a source and
 * adding it again with the same URL gave every item a brand-new key and the
 * next poll re-posted the whole feed into the channel.
 *
 * These tests run against real PostgreSQL (PGlite locally, `TEST_DATABASE_URL`
 * in CI) so the unique index itself is under test, not a JS re-implementation
 * of it. The four cases are the ones that were reported:
 *
 * 1. recreate a source for the same feed + channel → zero new deliveries
 * 2. move the same feed to a new channel → it is delivered there, once
 * 3. a worker restart mid-batch → no duplicates (`onConflictDoNothing`)
 * 4. the first fetch posts nothing, or the newest N when configured
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultConfig, type FeedItem } from "@orbit/core";
import { feedIdentity } from "@orbit/core/feed-identity";
import { planFirstFetch } from "@orbit/core/feed-priming";

const enqueued = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("@orbit/core/queue", () => ({
  createQueue: () => ({
    add: (name: string, data: any) => {
      enqueued.calls.push({ name, data });
    },
  }),
}));
// PGlite runs real PostgreSQL in WASM, so the unique index is genuinely
// enforced. CI sets TEST_DATABASE_URL to also exercise pg and row locks.
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

import {
  closeDb,
  database,
  deleteResource,
  dispatchItems,
  reserveDelivery,
  saveResource,
} from "@orbit/db";
import { eq } from "drizzle-orm";
import * as s from "../packages/db/src/schema";

const g1 = "990000000000000041";
const actor = { id: "990000000000000141", name: "Test owner" };
const ids = {
  channel1: "990000000000000341",
  channel2: "990000000000000342",
};
const FEED = "https://feeds.example.com/news.xml";

const sourceInput = (channelId: string) => ({
  name: "Publisher feed",
  enabled: true,
  data: {
    adapter: "rss" as const,
    url: FEED,
    channelId,
    intervalMinutes: 30,
  },
});

const item = (n: number): FeedItem => ({
  id: `story-${n}`,
  title: `Story ${n}`,
  url: `https://example.com/story-${n}`,
  summary: "Body text",
  publishedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  tags: [],
  attribution: "unknown" as const,
  sourceLabel: "",
});

const deliveries = async () =>
  database().db.select().from(s.deliveries).where(eq(s.deliveries.guildId, g1));

beforeAll(async () => {
  vi.stubEnv("DEMO_MODE", "false");
  if (process.env.TEST_DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(database().db, { migrationsFolder: "./drizzle" });
  }
}, 30000);

afterAll(async () => {
  await database().db.delete(s.guilds).where(eq(s.guilds.id, g1));
  await closeDb();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  enqueued.calls.length = 0;
  const db = database().db;
  await db.delete(s.guilds).where(eq(s.guilds.id, g1));
  await db.insert(s.guilds).values({
    id: g1,
    name: "Test community",
    installed: true,
    memberCount: 1,
    config: structuredClone(defaultConfig),
    botRolePosition: 10,
    roles: [],
    channels: [
      { id: ids.channel1, name: "news", type: "text", canSend: true },
      { id: ids.channel2, name: "announcements", type: "text", canSend: true },
    ],
  });
});

describe("the re-post storm", () => {
  it("delivers nothing when a source for the same feed and channel is recreated", async () => {
    const first = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    const items = [item(1), item(2), item(3)];
    expect(await dispatchItems(first, items)).toBe(3);
    expect(await deliveries()).toHaveLength(3);

    // The operator deletes the source and adds it again with the same URL.
    await deleteResource(g1, "source", first.id, actor);
    const recreated = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    expect(recreated.id).not.toBe(first.id);
    // Same feed, same channel: every item is already delivered.
    expect(await dispatchItems(recreated, items)).toBe(0);
    expect(await deliveries()).toHaveLength(3);
  });

  it("still delivers the feed once in a new channel after the move", async () => {
    const source = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    const items = [item(1), item(2)];
    expect(await dispatchItems(source, items)).toBe(2);

    const moved = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel2),
      actor,
      source.id
    );
    // A new destination is a new delivery, once — not silent, not twice.
    expect(await dispatchItems(moved, items)).toBe(2);
    const rows = await deliveries();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.channelId === ids.channel2)).toHaveLength(2);
    // And it does not re-post into the old channel either.
    expect(await dispatchItems(moved, items)).toBe(0);
  });

  it("does not duplicate when a worker restarts mid-batch", async () => {
    const source = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    const items = [item(1), item(2), item(3), item(4)];
    // The batch is processed twice, as it would be if the process died part
    // way through and BullMQ redelivered the poll.
    const [a, b] = await Promise.all([
      dispatchItems(source, items),
      dispatchItems(source, items),
    ]);
    expect(a + b).toBe(4);
    expect(await deliveries()).toHaveLength(4);
    expect(enqueued.calls).toHaveLength(4);
  });

  it("refuses a second row for the same feed, channel and item", async () => {
    const source = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    const identity = feedIdentity(source);
    const base = {
      guildId: g1,
      externalId: "story-1",
      title: "Story 1",
      url: "https://example.com/story-1",
      channelId: ids.channel1,
      feedIdentity: identity,
    };
    expect(
      await reserveDelivery({ ...base, sourceId: source.id })
    ).not.toBeNull();
    // A recreated source row, same feed: on-conflict-do-nothing, not an error
    // and not a second row.
    expect(
      await reserveDelivery({ ...base, sourceId: "some-other-source-id" })
    ).toBeNull();
    expect(await deliveries()).toHaveLength(1);
  });
});

describe("a source's first fetch", () => {
  // Mirrors the worker's pipeline exactly: decide whether the feed still needs
  // priming, split newest-first, dispatch the whole list with `postNewest`, and
  // mark the source primed afterwards.
  const runPoll = async (
    source: Awaited<ReturnType<typeof saveResource>>,
    items: FeedItem[]
  ) => {
    const identity = feedIdentity(source);
    const priming =
      source.kind === "source" && source.data.primedFeed !== identity;
    if (!priming)
      return { posted: await dispatchItems(source, items), primed: 0 };
    const plan = planFirstFetch(items, source.data.firstFetchPostCount ?? 0);
    const posted = await dispatchItems(source, [...plan.post, ...plan.skip], {
      postNewest: plan.post.length,
    });
    return { posted, primed: plan.skip.length };
  };

  it("posts nothing and records the whole feed as seen", async () => {
    const source = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    const items = [item(1), item(2), item(3)];
    const { posted, primed } = await runPoll(source, items);
    expect(posted).toBe(0);
    expect(primed).toBe(3);
    expect(enqueued.calls).toHaveLength(0);

    // Recorded, not dropped: the next poll compares against these rows.
    const rows = await deliveries();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "skipped")).toBe(true);

    // Marked primed, so a second poll is an ordinary poll — and posts nothing,
    // because nothing new has appeared.
    const again = await saveResource(
      g1,
      "source",
      {
        ...sourceInput(ids.channel1),
        data: {
          ...sourceInput(ids.channel1).data,
          primedFeed: feedIdentity(source),
        },
      },
      actor,
      source.id
    );
    expect(await runPoll(again, items)).toEqual({ posted: 0, primed: 0 });
    expect(await deliveries()).toHaveLength(3);
  });

  it("posts the newest N when the operator asks for them, and no more", async () => {
    const data = { ...sourceInput(ids.channel1).data, firstFetchPostCount: 2 };
    const source = await saveResource(
      g1,
      "source",
      { name: "Publisher feed", enabled: true, data },
      actor
    );
    // Oldest first on purpose: the plan must reorder, not trust the feed.
    const items = [item(1), item(2), item(3), item(4)];
    const { posted, primed } = await runPoll(source, items);
    expect(posted).toBe(2);
    expect(primed).toBe(2);
    expect(enqueued.calls).toHaveLength(2);

    const rows = await deliveries();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "skipped")).toHaveLength(2);
    // The two that were posted are the two most recent.
    expect(
      rows
        .filter((r) => r.status === "pending")
        .map((r) => r.externalId)
        .sort()
    ).toEqual(["story-3", "story-4"]);
  });

  it("primes again when the source is pointed at a different feed", async () => {
    const source = await saveResource(
      g1,
      "source",
      sourceInput(ids.channel1),
      actor
    );
    const identity = feedIdentity(source);
    await runPoll(source, [item(1)]);

    // Still primed for this feed: an ordinary poll.
    const same = await saveResource(
      g1,
      "source",
      {
        ...sourceInput(ids.channel1),
        data: { ...sourceInput(ids.channel1).data, primedFeed: identity },
      },
      actor,
      source.id
    );
    expect(feedIdentity(same)).toBe(identity);
    expect(await runPoll(same, [item(2)])).toEqual({ posted: 1, primed: 0 });

    // Pointed elsewhere: the identity changed, so it primes again instead of
    // treating a different feed's back catalogue as already seen.
    const moved = await saveResource(
      g1,
      "source",
      {
        ...sourceInput(ids.channel1),
        data: {
          ...sourceInput(ids.channel1).data,
          url: "https://feeds.example.com/other.xml",
          primedFeed: identity,
        },
      },
      actor,
      source.id
    );
    expect(feedIdentity(moved)).not.toBe(identity);
    expect(await runPoll(moved, [item(3)])).toEqual({ posted: 0, primed: 1 });
  });

  it("caps the newest-N setting at five, however it is stored", () => {
    // `planFirstFetch` clamps, so a value that slipped past the schema cannot
    // turn into "post the whole feed".
    const items = Array.from({ length: 9 }, (_, i) => item(i));
    expect(planFirstFetch(items, 999).post).toHaveLength(5);
    expect(planFirstFetch(items, 0).post).toHaveLength(0);
    expect(planFirstFetch(items, -1).post).toHaveLength(0);
    expect(planFirstFetch(items, 2).skip).toHaveLength(7);
  });
});

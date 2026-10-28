/**
 * Feed identity, and migration 0013 which backfills it.
 *
 * The identity is what a delivery is deduplicated against. It must come from
 * the feed, not from the row that reads it: keying deliveries on the source
 * row's id meant deleting a source and adding it again with the same URL gave
 * every item a fresh key, and the worker re-posted the whole feed.
 *
 * The backfill is written twice — once in TypeScript for the running
 * application, once in SQL for the rows that already exist — and the two must
 * produce byte-identical strings. If they drift, an old row and a new row for
 * the same feed disagree and the feed is re-posted, which is the exact bug
 * this exists to fix. So this file applies the real migration to a real
 * PostgreSQL (PGlite) and compares, rather than trusting the two to agree.
 */
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { feedIdentity, normalizeFeedUrl } from "@orbit/core/feed-identity";

const MIGRATION = "0013_feed_identity.sql";
const GUILD = "1";
const CHANNEL_A = "990000000000000301",
  CHANNEL_B = "990000000000000302";

type Seed = {
  id: string;
  kind: "source" | "deal";
  data: Record<string, unknown>;
};

/** Apply every migration before 0013, and hand back 0013's own SQL. */
async function schemaBeforeBackfill() {
  const { PGlite } = await import("@electric-sql/pglite");
  const files = (await readdir("./drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const at = files.indexOf(MIGRATION);
  expect(at, `${MIGRATION} must be in the migration chain`).toBeGreaterThan(-1);
  const pg = new PGlite();
  for (const file of files.slice(0, at))
    await pg.exec(await readFile(`./drizzle/${file}`, "utf8"));
  return { pg, sql: await readFile(`./drizzle/${MIGRATION}`, "utf8") };
}

const quote = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

async function seed(
  pg: Awaited<ReturnType<typeof schemaBeforeBackfill>>["pg"],
  sources: Seed[],
  deliveries: {
    sourceId: string;
    externalId: string;
    channelId?: string;
    minutesAgo?: number;
  }[]
) {
  await pg.exec(
    `INSERT INTO "guilds" ("id","name","config") VALUES (${quote(GUILD)},'g','{}');`
  );
  if (sources.length)
    await pg.exec(
      `INSERT INTO "resources" ("id","guild_id","kind","name","enabled","data") VALUES\n` +
        sources
          .map(
            (s) =>
              `(${quote(s.id)},${quote(GUILD)},${quote(s.kind)},${quote(s.id)},true,${quote(
                JSON.stringify(s.data)
              )}::jsonb)`
          )
          .join(",\n") +
        `;`
    );
  if (deliveries.length)
    await pg.exec(
      `INSERT INTO "deliveries" ("guild_id","source_id","external_id","title","url","channel_id","payload","status","attempts","created_at") VALUES\n` +
        deliveries
          .map(
            (d) =>
              `(${quote(GUILD)},${quote(d.sourceId)},${quote(d.externalId)},'t','https://example.invalid/a',${quote(
                d.channelId ?? CHANNEL_A
              )},'{}'::jsonb,'delivered',0, now() - interval '${Number(
                d.minutesAgo ?? 0
              )} minutes')`
          )
          .join(",\n") +
        `;`
    );
}

async function identitiesOf(
  pg: Awaited<ReturnType<typeof schemaBeforeBackfill>>["pg"]
) {
  const result = await pg.query<{
    source_id: string;
    external_id: string;
    feed_identity: string;
  }>(
    `SELECT "source_id","external_id","feed_identity" FROM "deliveries" ORDER BY "external_id","feed_identity"`
  );
  return result.rows ?? [];
}

describe("feed identity", () => {
  it("names an RSS feed by its normalized URL, not by the row reading it", () => {
    expect(
      feedIdentity({
        kind: "source",
        id: "aaa",
        data: { adapter: "rss", url: "https://WWW.Example.com/Feed/" },
      })
    ).toBe(
      feedIdentity({
        kind: "source",
        id: "zzz",
        data: { adapter: "rss", url: "http://example.com/feed" },
      })
    );
    expect(
      feedIdentity({
        kind: "source",
        id: "aaa",
        data: { adapter: "rss", url: "https://example.com/other" },
      })
    ).not.toBe(
      feedIdentity({
        kind: "source",
        id: "aaa",
        data: { adapter: "rss", url: "https://example.com/feed" },
      })
    );
  });

  it("names a Steam source by its app id", () => {
    expect(
      feedIdentity({
        kind: "source",
        id: "aaa",
        data: { adapter: "steam", appId: 570 },
      })
    ).toBe("steam:570");
  });

  it("names a webhook by the row, because the row owns the endpoint and its secret", () => {
    // A pushed feed has no upstream to name. Recreating the row genuinely
    // creates a new endpoint with a new secret, so it must not inherit the
    // old one's history.
    expect(
      feedIdentity({ kind: "source", id: "aaa", data: { adapter: "webhook" } })
    ).toBe("webhook:aaa");
    expect(
      feedIdentity({ kind: "source", id: "bbb", data: { adapter: "webhook" } })
    ).toBe("webhook:bbb");
  });

  it("names a deal watcher by the game it watches", () => {
    expect(feedIdentity({ kind: "deal", data: { gameId: "g1" } })).toBe(
      "deal:g1"
    );
  });

  it("collapses only the variations that are the same feed", () => {
    const cases: [string, string][] = [
      ["HTTPS://Example.com/Feed", "example.com/feed"],
      [
        "http://www.example.com/feed",
        "http://www.example.com/feed".replace(/^https?:\/\//, ""),
      ],
      ["https://example.com/feed///", "https://example.com/feed///"],
      ["  https://example.com/Feed  ", "https://example.com/feed"],
      ["https://example.com/feed#section", "https://example.com/feed"],
    ];
    for (const [input, expectedRaw] of cases)
      expect(normalizeFeedUrl(input)).toBe(normalizeFeedUrl(expectedRaw));
    // The scheme, `www.` and a trailing slash carry no information.
    expect(normalizeFeedUrl("https://www.example.com/feed/")).toBe(
      "example.com/feed"
    );
    // A path is part of the feed.
    expect(normalizeFeedUrl("https://example.com/a")).not.toBe(
      normalizeFeedUrl("https://example.com/b")
    );
  });
});

describe("migration 0013", () => {
  it("backfills every kind exactly as feedIdentity() computes it", async () => {
    const { pg, sql } = await schemaBeforeBackfill();
    try {
      const sources: Seed[] = [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "source",
          data: { adapter: "rss", url: "https://WWW.Example.com/Feed/" },
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "source",
          data: { adapter: "steam", appId: 570 },
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "source",
          data: { adapter: "webhook", url: "https://example.invalid/hook" },
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          kind: "deal",
          data: { gameId: "game-1" },
        },
      ];
      await seed(
        pg,
        sources,
        sources.map((s) => ({ sourceId: s.id, externalId: `item-${s.id}` }))
      );

      await pg.exec(sql);

      const rows = await identitiesOf(pg);
      expect(rows).toHaveLength(sources.length);
      const bySource = new Map(rows.map((r) => [r.source_id, r.feed_identity]));
      for (const source of sources)
        expect(bySource.get(source.id)).toBe(
          feedIdentity({ kind: source.kind, id: source.id, data: source.data })
        );
      expect(bySource.get(sources[0].id)).toBe("rss:example.com/feed");
      expect(bySource.get(sources[1].id)).toBe("steam:570");
      expect(bySource.get(sources[2].id)).toBe(
        "webhook:33333333-3333-4333-8333-333333333333"
      );
      expect(bySource.get(sources[3].id)).toBe("deal:game-1");
    } finally {
      await pg.close();
    }
  });

  it("keeps rows whose source is already gone, under a namespace no live feed can hit", async () => {
    const { pg, sql } = await schemaBeforeBackfill();
    try {
      // No `resources` row at all: the feed URL went with it, so there is
      // nothing to backfill from. Preserved, not dropped and not guessed at.
      await seed(
        pg,
        [],
        [
          { sourceId: "deleted-1", externalId: "kept-1" },
          { sourceId: "deleted-1", externalId: "kept-2" },
        ]
      );
      await pg.exec(sql);
      const rows = await identitiesOf(pg);
      expect(rows).toHaveLength(2);
      expect(
        rows.every((r) => r.feed_identity === "deleted-source:deleted-1")
      ).toBe(true);
    } finally {
      await pg.close();
    }
  });

  it("keeps colliding rows instead of deleting them, and disambiguates by source", async () => {
    const { pg, sql } = await schemaBeforeBackfill();
    try {
      // Two source rows, one feed, one channel, one item: under the old key
      // these were two deliveries, under the new one they collide. The item
      // was already posted twice, so the rows really are duplicates — but
      // history is not erased to create the index.
      const a = "11111111-1111-4111-8111-111111111111",
        b = "22222222-2222-4222-8222-222222222222";
      await seed(
        pg,
        [
          {
            id: a,
            kind: "source",
            data: { adapter: "rss", url: "https://example.com/feed" },
          },
          {
            id: b,
            kind: "source",
            data: { adapter: "rss", url: "https://example.com/feed" },
          },
        ],
        [
          { sourceId: a, externalId: "same-item", minutesAgo: 10 },
          { sourceId: b, externalId: "same-item", minutesAgo: 5 },
        ]
      );
      await pg.exec(sql);
      const rows = await identitiesOf(pg);
      expect(rows).toHaveLength(2);
      // The older row keeps the clean identity; the newer one is marked with
      // the source that produced it, so both survive.
      expect(rows.map((r) => r.feed_identity).sort()).toEqual(
        [`rss:example.com/feed`, `rss:example.com/feed#${b}`].sort()
      );
    } finally {
      await pg.close();
    }
  });

  it("replaces the deduplication index rather than adding a second one", async () => {
    const { pg, sql } = await schemaBeforeBackfill();
    try {
      await seed(pg, [], []);
      await pg.exec(sql);
      const indexes = await pg.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'deliveries' ORDER BY indexname`
      );
      const names = (indexes.rows ?? []).map((r) => r.indexname);
      expect(names).toContain("delivery_feed_deduplication");
      expect(names).not.toContain("delivery_deduplication");
    } finally {
      await pg.close();
    }
  });

  it("then refuses a second row for the same feed, channel and item", async () => {
    const { pg, sql } = await schemaBeforeBackfill();
    try {
      const a = "11111111-1111-4111-8111-111111111111";
      await seed(
        pg,
        [
          {
            id: a,
            kind: "source",
            data: { adapter: "rss", url: "https://example.com/feed" },
          },
        ],
        [{ sourceId: a, externalId: "item-1" }]
      );
      await pg.exec(sql);
      // The re-post storm, expressed as SQL: a *new* source row for the same
      // feed trying to deliver an item that is already recorded.
      await expect(
        pg.exec(
          `INSERT INTO "deliveries" ("guild_id","source_id","feed_identity","external_id","title","url","channel_id","payload","status","attempts")
           VALUES (${quote(GUILD)},'99999999-9999-4999-8999-999999999999','rss:example.com/feed','item-1','again','https://example.invalid/a',${quote(CHANNEL_A)},'{}'::jsonb,'pending',0);`
        )
      ).rejects.toThrow();
      // A different channel is a different delivery: moving a feed posts once
      // in the new place rather than staying silent.
      await pg.exec(
        `INSERT INTO "deliveries" ("guild_id","source_id","feed_identity","external_id","title","url","channel_id","payload","status","attempts")
         VALUES (${quote(GUILD)},'99999999-9999-4999-8999-999999999999','rss:example.com/feed','item-1','moved','https://example.invalid/a',${quote(CHANNEL_B)},'{}'::jsonb,'pending',0);`
      );
      const rows = await identitiesOf(pg);
      expect(rows).toHaveLength(2);
    } finally {
      await pg.close();
    }
  });
});

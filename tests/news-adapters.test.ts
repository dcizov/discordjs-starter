import { sourceSchema } from "@orbit/core";
import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";

/**
 * `blizzard`, `wowhead` and `mojang` were selectable news adapters that never
 * had a fetch path: feeds.ts handles `webhook` and `steam` and everything else
 * falls through to the RSS/Atom reader, so all three already behaved exactly
 * like `rss`. They were removed, and migration 0009 converts stored rows.
 *
 * These tests exist because the removal has to be a conversion, not a deletion:
 * an administrator's feed URL, schedule and destination are real configuration
 * and must survive it.
 */
const REMOVED = ["blizzard", "wowhead", "mojang"];

describe("news source adapters", () => {
  it("no longer offers the three unimplemented providers", () => {
    for (const adapter of REMOVED)
      expect(
        sourceSchema.safeParse({ name: "a source", data: { adapter } }).success
      ).toBe(false);
  });
  it("still offers the two that fetch, plus the signed webhook", () => {
    for (const adapter of ["rss", "steam", "webhook"])
      expect(
        sourceSchema.safeParse({ name: "a source", data: { adapter } }).success
      ).toBe(true);
  });
  it("defaults to RSS when no adapter is chosen", () => {
    expect(
      sourceSchema.parse({ name: "a source", data: {} }).data.adapter
    ).toBe("rss");
  });
  it("accepts a row written before the removal only after conversion", () => {
    // The exact shape migration 0009 produces.
    const converted = sourceSchema.parse({
      name: "Blizzard",
      data: { adapter: "rss", url: "https://example.test/feed.xml" },
    });
    expect(converted.data.adapter).toBe("rss");
    expect(converted.data.url).toBe("https://example.test/feed.xml");
  });
});

describe("migration 0009", () => {
  const migrations = async () =>
    (await readdir("./drizzle")).filter((f) => f.endsWith(".sql")).sort();
  const read = (file: string) => readFile(`./drizzle/${file}`, "utf8");

  it("is present and is the newest migration", async () => {
    const files = await migrations();
    expect(files.at(-1)).toBe("0009_drop_unimplemented_news_adapters.sql");
  });

  it("converts the removed adapters to rss and keeps every other field", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    try {
      // Everything up to but excluding 0009, so the rows can be written in the
      // pre-removal shape the migration expects to find.
      const files = (await migrations()).filter(
        (f) => f !== "0009_drop_unimplemented_news_adapters.sql"
      );
      for (const file of files) await pg.exec(await read(file));

      await pg.exec(`
        INSERT INTO "guilds" ("id", "name", "config")
        VALUES ('1', 'g', '{}');
        INSERT INTO "resources" ("id", "guild_id", "kind", "name", "enabled", "data")
        VALUES
          ('11111111-1111-4111-8111-111111111111', '1', 'source', 'Blizzard',  true,
           '{"adapter":"blizzard","url":"https://news.example/blizzard.xml","intervalMinutes":60,"tags":["Gaming"]}'),
          ('22222222-2222-4222-8222-222222222222', '1', 'source', 'Wowhead',   true,
           '{"adapter":"wowhead","url":"https://news.example/wowhead.xml","intervalMinutes":45,"tags":["Warcraft"]}'),
          ('33333333-3333-4333-8333-333333333333', '1', 'source', 'Mojang',    false,
           '{"adapter":"mojang","url":"","intervalMinutes":30,"tags":["Minecraft"]}'),
          ('44444444-4444-4444-8444-444444444444', '1', 'source', 'Untouched', true,
           '{"adapter":"steam","appId":570,"url":"","intervalMinutes":15,"tags":[]}'),
          ('55555555-5555-4555-8555-555555555555', '1', 'route',  'Not a source', true,
           '{"adapter":"blizzard","url":"https://news.example/route.xml"}');
      `);

      await pg.exec(await read("0009_drop_unimplemented_news_adapters.sql"));

      const rows = (
        await pg.query<{ id: string; data: any }>(
          `SELECT "id", "data" FROM "resources" ORDER BY "id"`
        )
      ).rows;

      const byId = Object.fromEntries(rows.map((r) => [r.id, r.data]));

      // Converted, and the real configuration survived the conversion.
      expect(byId["11111111-1111-4111-8111-111111111111"].adapter).toBe("rss");
      expect(byId["11111111-1111-4111-8111-111111111111"].url).toBe(
        "https://news.example/blizzard.xml"
      );
      expect(byId["11111111-1111-4111-8111-111111111111"].intervalMinutes).toBe(
        60
      );
      expect(byId["11111111-1111-4111-8111-111111111111"].tags).toEqual([
        "Gaming",
      ]);

      expect(byId["22222222-2222-4222-8222-222222222222"].adapter).toBe("rss");
      expect(byId["22222222-2222-4222-8222-222222222222"].url).toBe(
        "https://news.example/wowhead.xml"
      );
      expect(byId["22222222-2222-4222-8222-222222222222"].intervalMinutes).toBe(
        45
      );

      // A disabled starter with no URL is converted too, not dropped.
      expect(byId["33333333-3333-4333-8333-333333333333"].adapter).toBe("rss");
      expect(byId["33333333-3333-4333-8333-333333333333"].url).toBe("");

      // Anything already supported is untouched.
      expect(byId["44444444-4444-4444-8444-444444444444"].adapter).toBe(
        "steam"
      );
      expect(byId["44444444-4444-4444-8444-444444444444"].appId).toBe(570);
      expect(byId["44444444-4444-4444-8444-444444444444"].intervalMinutes).toBe(
        15
      );

      // The migration is scoped to source rows: it must not rewrite unrelated
      // jsonb that happens to carry the same key.
      expect(byId["55555555-5555-4555-8555-555555555555"].adapter).toBe(
        "blizzard"
      );
      expect(byId["55555555-5555-4555-8555-555555555555"].url).toBe(
        "https://news.example/route.xml"
      );

      // No row was deleted.
      expect(rows).toHaveLength(5);
    } finally {
      await pg.close();
    }
  });
});

import { defaultConfig } from "@orbit/core";
import { database, closeDb, listMembers } from "@orbit/db";
import { eq } from "drizzle-orm";
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
// DISCORD_CLIENT_ID is set, which is the case under vitest. Without this
// `listMembers` takes its demo branch and never touches SQL.
beforeAll(() => {
  vi.stubEnv("DEMO_MODE", "false");
});
afterAll(async () => {
  await closeDb();
});

const db = () => database().db;

/**
 * The demo branch and the SQL branch are two different implementations of the
 * same directory, so the role filter needs proving on both. The SQL branch
 * narrows with a jsonb containment test; these cases are the ones where that
 * could quietly do the wrong thing — matching a prefix, leaking across guilds,
 * or matching a member who merely holds a role with a similar id.
 */

const ADMIN = "770000000000000101";
const MOD = "770000000000000102";
const EVERYONE = "770000000000000099";

let guildA: string;
let guildB: string;
// Each test seeds its own pair of guilds. Random ids collided badly enough to
// make two tests read each other's rows, so the ids are handed out in order.
let counter = 0;

async function seed() {
  const n = counter++;
  guildA = `7700000000000${String(10000 + n * 2).padStart(6, "0")}`;
  guildB = `7700000000000${String(10001 + n * 2).padStart(6, "0")}`;
  for (const id of [guildA, guildB]) {
    await db()
      .insert(s.guilds)
      .values({
        id,
        name: `Role filter guild ${id}`,
        config: structuredClone(defaultConfig),
      });
  }
  const people: {
    guildId: string;
    userId: string;
    displayName: string;
    roles: string[];
  }[] = [
    {
      guildId: guildA,
      userId: "770000000000001001",
      displayName: "Ada",
      roles: [ADMIN, MOD],
    },
    {
      guildId: guildA,
      userId: "770000000000001002",
      displayName: "Bo",
      roles: [MOD],
    },
    {
      guildId: guildA,
      userId: "770000000000001003",
      displayName: "Cy",
      roles: [],
    },
    // A near-miss id: one digit different, and a strict prefix of ADMIN's.
    {
      guildId: guildA,
      userId: "770000000000001004",
      displayName: "Dee",
      roles: ["77000000000000010"],
    },
    // The same role id in another guild must not show up when guild A is read.
    {
      guildId: guildB,
      userId: "770000000000001005",
      displayName: "Eli",
      roles: [ADMIN],
    },
  ];
  await db()
    .insert(s.members)
    .values(people.map((p) => ({ ...p, syncedAt: new Date() })));
}

describe("member directory role filter (SQL)", () => {
  it("narrows to the members holding the role", async () => {
    await seed();
    const admins = await listMembers(guildA, { roleId: ADMIN });
    expect(admins.total).toBe(1);
    expect(admins.rows[0].displayName).toBe("Ada");

    const mods = await listMembers(guildA, { roleId: MOD });
    expect(mods.rows.map((m) => m.displayName).sort()).toEqual(["Ada", "Bo"]);
  });

  it("matches whole role ids, not prefixes", async () => {
    // `Dee` holds a role whose id is a strict prefix of ADMIN's. A LIKE-style
    // match would drag them in; containment must not.
    await seed();
    const admins = await listMembers(guildA, { roleId: ADMIN });
    expect(admins.rows.map((m) => m.displayName)).not.toContain("Dee");
  });

  it("stays inside the guild it was asked about", async () => {
    // `Eli` holds ADMIN in guild B. Reading guild A with the same id must not
    // return them — this is the guild-isolation guarantee.
    await seed();
    const all = await listMembers(guildA, { roleId: ADMIN, pageSize: 100 });
    expect(all.rows.every((m) => m.guildId === guildA)).toBe(true);
    expect(all.rows.map((m) => m.displayName)).not.toContain("Eli");
  });

  it("returns the whole roster when no role is named", async () => {
    await seed();
    const all = await listMembers(guildA, {});
    const empty = await listMembers(guildA, { roleId: "" });
    expect(empty.total).toBe(all.total);
    expect(all.total).toBe(4);
  });

  it("returns nobody for a role no one holds", async () => {
    await seed();
    const nobody = await listMembers(guildA, { roleId: EVERYONE });
    expect(nobody.total).toBe(0);
    expect(nobody.rows).toEqual([]);
  });

  it("combines the role filter with the presence filters", async () => {
    await seed();
    // `Bo` leaves; the role filter must respect the departed filter rather
    // than overriding it.
    await db()
      .update(s.members)
      .set({ present: false, departedAt: new Date() })
      .where(eq(s.members.userId, "770000000000001002"));
    // "all" is genuinely all — departed members included — so Bo is still a
    // Moderator there. The point is that narrowing by role does not replace
    // the presence filter; it narrows within it.
    const allMods = await listMembers(guildA, { roleId: MOD });
    expect(allMods.rows.map((m) => m.displayName).sort()).toEqual([
      "Ada",
      "Bo",
    ]);
    expect(
      (await listMembers(guildA, { roleId: MOD, filter: "humans" })).rows.map(
        (m) => m.displayName
      )
    ).toEqual(["Ada"]);
    expect(
      (await listMembers(guildA, { roleId: MOD, filter: "departed" })).rows.map(
        (m) => m.displayName
      )
    ).toEqual(["Bo"]);
    // And the role still excludes people who never held it.
    expect(
      (await listMembers(guildA, { roleId: MOD, filter: "departed" })).rows.map(
        (m) => m.displayName
      )
    ).not.toContain("Cy");
  });
});

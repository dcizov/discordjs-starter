import { defaultConfig } from "@orbit/core";
import { database, closeDb } from "@orbit/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "../packages/db/src/schema";
import {
  listTemplateRunSteps,
  recordTemplateRunStep,
} from "../packages/db/src/templates";

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

// `isDemo()` is true whenever NODE_ENV is not production and no
// DISCORD_CLIENT_ID is set, which is the case under vitest. Without this the
// step functions take their demo branch and these tests would never touch SQL.
beforeAll(() => {
  vi.stubEnv("DEMO_MODE", "false");
});

/**
 * The step table is only worth having if it survives a crash, which means it
 * has to survive a process that never reached the end of the run. These tests
 * exercise the real SQL: the unique index, the upsert, and the cascade that
 * keeps a deleted run from leaving orphaned steps behind.
 */

const db = () => database().db;

async function seedRun() {
  const guildId = `8800000000000${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
  await db()
    .insert(s.guilds)
    .values({
      id: guildId,
      name: "Step test guild",
      config: structuredClone(defaultConfig),
    });
  const [template] = await db()
    .insert(s.serverTemplates)
    .values({
      sourceGuildId: guildId,
      name: "Step test template",
      data: {},
      createdBy: "880000000000000099",
    })
    .returning();
  const [run] = await db()
    .insert(s.templateRuns)
    .values({
      guildId,
      templateId: template.id,
      actorId: "880000000000000099",
      plan: {},
    })
    .returning();
  return run;
}

afterAll(async () => {
  await closeDb();
});

describe("template run steps in the database", () => {
  it("created the table from the migration", async () => {
    // Every migration in ./drizzle is applied to a fresh PGlite instance, so
    // reaching this assertion at all means 0010 ran. This checks the shape the
    // apply engine depends on.
    const run = await seedRun();
    await recordTemplateRunStep({
      runId: run.id,
      key: "role:mod",
      kind: "role",
      action: "create",
      targetId: "880000000000000201",
      state: "done",
    });
    const rows = await db()
      .select()
      .from(s.templateRunSteps)
      .where(eq(s.templateRunSteps.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("role:mod");
    expect(rows[0]?.targetId).toBe("880000000000000201");
    expect(rows[0]?.state).toBe("done");
  });

  it("updates rather than duplicates when a step is re-recorded", async () => {
    // A resumed run re-records the steps it redoes. Two rows for one key would
    // leave the mapping ambiguous, so the unique index must collapse them.
    const run = await seedRun();
    await recordTemplateRunStep({
      runId: run.id,
      key: "role:mod",
      kind: "role",
      action: "create",
      targetId: "880000000000000201",
      state: "done",
    });
    await recordTemplateRunStep({
      runId: run.id,
      key: "role:mod",
      kind: "role",
      action: "reuse",
      targetId: "880000000000000202",
      state: "done",
    });
    const rows = await db()
      .select()
      .from(s.templateRunSteps)
      .where(eq(s.templateRunSteps.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("reuse");
    expect(rows[0]?.targetId).toBe("880000000000000202");
  });

  it("records a failure so the retry knows to have another go", async () => {
    const run = await seedRun();
    await recordTemplateRunStep({
      runId: run.id,
      key: "channel:general",
      kind: "channel",
      action: "create",
      state: "failed",
      error: "Missing Permissions",
    });
    const steps = await listTemplateRunSteps(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.state).toBe("failed");
    expect(steps[0]?.error).toBe("Missing Permissions");
    expect(steps[0]?.targetId).toBeNull();
  });

  it("steps for one run do not leak into another", async () => {
    const a = await seedRun();
    const b = await seedRun();
    await recordTemplateRunStep({
      runId: a.id,
      key: "role:mod",
      kind: "role",
      action: "create",
      targetId: "880000000000000201",
      state: "done",
    });
    await recordTemplateRunStep({
      runId: b.id,
      key: "role:admin",
      kind: "role",
      action: "create",
      targetId: "880000000000000202",
      state: "done",
    });
    expect((await listTemplateRunSteps(a.id)).map((x) => x.key)).toEqual([
      "role:mod",
    ]);
    expect((await listTemplateRunSteps(b.id)).map((x) => x.key)).toEqual([
      "role:admin",
    ]);
  });

  it("returns steps oldest first, in the order the run performed them", async () => {
    const run = await seedRun();
    for (const key of ["role:a", "role:b", "role:c"]) {
      await recordTemplateRunStep({
        runId: run.id,
        key,
        kind: "role",
        action: "create",
        targetId: "880000000000000201",
        state: "done",
      });
    }
    expect((await listTemplateRunSteps(run.id)).map((x) => x.key)).toEqual([
      "role:a",
      "role:b",
      "role:c",
    ]);
  });

  it("drops steps when their run is deleted", async () => {
    // A run is a child of its template; leaving steps behind would be orphans
    // with no way to read them.
    const run = await seedRun();
    await recordTemplateRunStep({
      runId: run.id,
      key: "role:mod",
      kind: "role",
      action: "create",
      targetId: "880000000000000201",
      state: "done",
    });
    await db().delete(s.templateRuns).where(eq(s.templateRuns.id, run.id));
    expect(await listTemplateRunSteps(run.id)).toEqual([]);
  });

  it("rejects a step for a run that does not exist", async () => {
    await expect(
      recordTemplateRunStep({
        runId: randomUUID(),
        key: "role:mod",
        kind: "role",
        action: "create",
        state: "done",
      })
    ).rejects.toThrow();
  });
});

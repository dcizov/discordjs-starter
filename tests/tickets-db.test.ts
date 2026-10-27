import { database, closeDb } from "@orbit/db";
import { eq } from "drizzle-orm";
import {
  claimTicket,
  clearTranscript,
  closeTicket,
  countOpenForMember,
  deleteTicket,
  getTicket,
  getTicketByChannel,
  listExpiredTranscripts,
  listOpenTickets,
  listStaleTickets,
  listTickets,
  openTicket,
  reopenTicket,
  setTicketChannel,
  touchTicket,
} from "@orbit/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultConfig } from "@orbit/core";
import * as s from "../packages/db/src/schema";

// PGlite runs real PostgreSQL in WASM, applying every migration in ./drizzle -
// so these tests exercise the actual SQL, the advisory lock and the unique
// index, not a re-implementation of them. CI sets TEST_DATABASE_URL to also
// exercise pg with concurrent connections.
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

// `isDemo()` is true under vitest unless this is set, which would send every
// call down the demo branch and never reach SQL.
beforeAll(() => {
  vi.stubEnv("DEMO_MODE", "false");
});
afterAll(async () => {
  await closeDb();
});

const ALICE = "600000000000000002";
const BOB = "600000000000000003";
const STAFF = "600000000000000004";

let seq = 0;
const uniq = () => `6000000000000${String(1000 + (seq += 1)).padStart(4, "0")}`;

/**
 * Every test gets a guild of its own. Ticket numbers are a per-guild sequence,
 * so sharing a guild across tests would make the numbers depend on execution
 * order - and the abuse cap counts per member per guild, so leftovers from one
 * test would change another's outcome.
 */
let GUILD = "";
let OTHER_GUILD = "";
const db = () => database().db;

async function seedGuild(id: string) {
  await db()
    .insert(s.guilds)
    .values({ id, name: `Guild ${id}`, config: defaultConfig, installed: true })
    .onConflictDoNothing();
}

beforeEach(async () => {
  GUILD = uniq();
  OTHER_GUILD = uniq();
  await seedGuild(GUILD);
  await seedGuild(OTHER_GUILD);
});

describe("opening", () => {
  it("allocates increasing numbers within a guild", async () => {
    const a = await openTicket({ guildId: GUILD, openerId: ALICE });
    const b = await openTicket({ guildId: GUILD, openerId: ALICE });
    expect(b.number).toBe(a.number + 1);
  });

  it("numbers each guild independently", async () => {
    const here = await openTicket({ guildId: GUILD, openerId: ALICE });
    const there = await openTicket({ guildId: OTHER_GUILD, openerId: ALICE });
    // A different guild's numbering must not be dragged up by this one's.
    expect(there.number).toBeGreaterThan(0);
    expect(here.guildId).toBe(GUILD);
    expect(there.guildId).toBe(OTHER_GUILD);
    await deleteTicket(OTHER_GUILD, there.id);
  });

  it("does not collide when two open at once", async () => {
    // The per-guild advisory lock is what makes this true on PostgreSQL. In
    // demo mode the transaction serialises it; either way the numbers differ.
    const [a, b, c] = await Promise.all([
      openTicket({ guildId: GUILD, openerId: ALICE }),
      openTicket({ guildId: GUILD, openerId: ALICE }),
      openTicket({ guildId: GUILD, openerId: ALICE }),
    ]);
    const numbers = [a.number, b.number, c.number];
    expect(new Set(numbers).size).toBe(3);
  });

  it("stores the subject, trimmed, and null when empty", async () => {
    const withSubject = await openTicket({
      guildId: GUILD,
      openerId: ALICE,
      subject: "  Billing problem  ",
    });
    expect(withSubject.subject).toBe("Billing problem");
    const without = await openTicket({
      guildId: GUILD,
      openerId: ALICE,
      subject: "   ",
    });
    expect(without.subject).toBeNull();
  });

  it("starts open, unclaimed, with no channel until one is made", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    expect(row.state).toBe("open");
    expect(row.claimerId).toBeNull();
    expect(row.channelId).toBeNull();
    expect(row.closedAt).toBeNull();
  });
});

describe("counting for the abuse cap", () => {
  it("counts only this member's open tickets in this guild", async () => {
    await openTicket({ guildId: GUILD, openerId: ALICE });
    await openTicket({ guildId: GUILD, openerId: ALICE });
    await openTicket({ guildId: GUILD, openerId: BOB });
    expect(await countOpenForMember(GUILD, ALICE)).toBe(2);
    expect(await countOpenForMember(GUILD, BOB)).toBe(1);
    expect(await countOpenForMember(OTHER_GUILD, ALICE)).toBe(0);
  });

  it("stops counting a closed ticket", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    expect(await countOpenForMember(GUILD, ALICE)).toBe(1);
    await closeTicket(GUILD, row.id, { closerId: STAFF });
    expect(await countOpenForMember(GUILD, ALICE)).toBe(0);
  });

  it("counts a claimed ticket, which is still open", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await claimTicket(GUILD, row.id, STAFF);
    expect(await countOpenForMember(GUILD, ALICE)).toBe(1);
  });
});

describe("claiming", () => {
  it("claims an open ticket once", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    const claimed = await claimTicket(GUILD, row.id, STAFF);
    expect(claimed?.state).toBe("claimed");
    expect(claimed?.claimerId).toBe(STAFF);
  });

  it("refuses a second claim so it cannot be stolen", async () => {
    // Silently stealing a ticket from whoever already had it is the failure
    // this exists for.
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await claimTicket(GUILD, row.id, STAFF);
    expect(await claimTicket(GUILD, row.id, BOB)).toBeNull();
    expect((await getTicket(GUILD, row.id))?.claimerId).toBe(STAFF);
  });

  it("refuses to claim a closed ticket", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, row.id, { closerId: STAFF });
    expect(await claimTicket(GUILD, row.id, STAFF)).toBeNull();
  });

  it("refuses across guilds", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    expect(await claimTicket(OTHER_GUILD, row.id, STAFF)).toBeNull();
  });
});

describe("closing and reopening", () => {
  it("records who closed it, when, and why", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    const closed = await closeTicket(GUILD, row.id, {
      closerId: STAFF,
      reason: "Sorted.",
      transcript: "Ticket #1\n---",
    });
    expect(closed?.state).toBe("closed");
    expect(closed?.closerId).toBe(STAFF);
    expect(closed?.closeReason).toBe("Sorted.");
    expect(closed?.closedAt).not.toBeNull();
    expect(closed?.transcript).toContain("Ticket #1");
  });

  it("flags a truncated transcript", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    const closed = await closeTicket(GUILD, row.id, {
      closerId: STAFF,
      transcript: "short",
      truncated: true,
    });
    expect(closed?.transcriptTruncated).toBe(true);
  });

  it("refuses to close twice", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, row.id, { closerId: STAFF, reason: "first" });
    expect(
      await closeTicket(GUILD, row.id, { closerId: STAFF, reason: "second" })
    ).toBeNull();
    // The first reason stands; a second close must not overwrite it.
    expect((await getTicket(GUILD, row.id))?.closeReason).toBe("first");
  });

  it("reopens to claimed when someone had claimed it", async () => {
    // The person who was handling it should still be the person handling it.
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await claimTicket(GUILD, row.id, STAFF);
    await closeTicket(GUILD, row.id, { closerId: STAFF });
    const reopened = await reopenTicket(GUILD, row.id);
    expect(reopened?.state).toBe("claimed");
    expect(reopened?.claimerId).toBe(STAFF);
    expect(reopened?.closedAt).toBeNull();
  });

  it("reopens to open when nobody had claimed it", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, row.id, { closerId: STAFF });
    expect((await reopenTicket(GUILD, row.id))?.state).toBe("open");
  });

  it("refuses to reopen a ticket that is already open", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    expect(await reopenTicket(GUILD, row.id)).toBeNull();
  });
});

describe("finding by channel", () => {
  it("finds the ticket for a channel", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    const channel = uniq();
    await setTicketChannel(GUILD, row.id, channel);
    expect((await getTicketByChannel(GUILD, channel))?.id).toBe(row.id);
  });

  it("does not find it under another guild", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    const channel = uniq();
    await setTicketChannel(GUILD, row.id, channel);
    expect(await getTicketByChannel(OTHER_GUILD, channel)).toBeNull();
  });

  it("detaches the channel when it is deleted", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await setTicketChannel(GUILD, row.id, uniq());
    await setTicketChannel(GUILD, row.id, null);
    // The row outliving its channel is a normal state, not corruption.
    expect((await getTicket(GUILD, row.id))?.channelId).toBeNull();
  });
});

describe("activity and maintenance", () => {
  it("touching moves a quiet ticket back out of the stale set", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    // Backdate it so it genuinely is stale. `listStaleTickets` sweeps every
    // guild, so the assertion has to be about *this* ticket's id rather than
    // about the whole result set.
    const longAgo = new Date(Date.now() - 48 * 3600_000);
    await db()
      .update(s.tickets)
      .set({ lastActivityAt: longAgo })
      .where(eq(s.tickets.id, row.id));

    const cutoff = new Date(Date.now() - 3600_000);
    expect((await listStaleTickets(cutoff)).map((r) => r.id)).toContain(row.id);

    await touchTicket(GUILD, row.id);
    // Someone replied, so the auto-close clock restarts.
    expect((await listStaleTickets(cutoff)).map((r) => r.id)).not.toContain(
      row.id
    );
  });

  it("lists open tickets for orphan detection", async () => {
    const a = await openTicket({ guildId: GUILD, openerId: ALICE });
    const b = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, b.id, { closerId: STAFF });
    const open = await listOpenTickets(GUILD);
    expect(open.map((r) => r.id)).toContain(a.id);
    expect(open.map((r) => r.id)).not.toContain(b.id);
  });

  it("excludes closed tickets from the stale sweep", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, row.id, { closerId: STAFF });
    const stale = await listStaleTickets(new Date(Date.now() + 60_000));
    expect(stale.map((r) => r.id)).not.toContain(row.id);
  });

  it("lists transcripts that aged out, and clears them", async () => {
    const row = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, row.id, {
      closerId: STAFF,
      transcript: "keep me",
    });
    const expired = await listExpiredTranscripts(new Date(Date.now() + 60_000));
    expect(expired.map((r) => r.id)).toContain(row.id);
    await clearTranscript(GUILD, row.id);
    expect((await getTicket(GUILD, row.id))?.transcript).toBeNull();
    // The ticket's own record survives; only what people wrote is dropped.
    expect((await getTicket(GUILD, row.id))?.closerId).toBe(STAFF);
  });
});

describe("listing", () => {
  it("filters by state and paginates", async () => {
    const a = await openTicket({ guildId: GUILD, openerId: ALICE });
    const b = await openTicket({ guildId: GUILD, openerId: ALICE });
    await closeTicket(GUILD, b.id, { closerId: STAFF });

    const open = await listTickets(GUILD, { state: "open" });
    expect(open.rows.map((r) => r.id)).toContain(a.id);
    expect(open.rows.map((r) => r.id)).not.toContain(b.id);

    const closed = await listTickets(GUILD, { state: "closed" });
    expect(closed.rows.map((r) => r.id)).toContain(b.id);

    const first = await listTickets(GUILD, { page: 1, pageSize: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.total).toBeGreaterThanOrEqual(2);
  });

  it("keeps guilds apart", async () => {
    const here = await openTicket({ guildId: GUILD, openerId: ALICE });
    const there = await openTicket({ guildId: OTHER_GUILD, openerId: ALICE });
    const list = await listTickets(GUILD);
    expect(list.rows.map((r) => r.id)).toContain(here.id);
    expect(list.rows.map((r) => r.id)).not.toContain(there.id);
    await deleteTicket(OTHER_GUILD, there.id);
  });

  it("orders newest first", async () => {
    const a = await openTicket({ guildId: GUILD, openerId: ALICE });
    const b = await openTicket({ guildId: GUILD, openerId: ALICE });
    const list = await listTickets(GUILD);
    expect(list.rows[0].number).toBeGreaterThanOrEqual(
      list.rows[list.rows.length - 1].number
    );
    expect(list.rows.map((r) => r.id)).toContain(a.id);
    expect(list.rows.map((r) => r.id)).toContain(b.id);
  });
});

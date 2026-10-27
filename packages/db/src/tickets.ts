/**
 * Ticket storage.
 *
 * Two properties matter here, and both are about things going wrong rather
 * than right.
 *
 * - **Ticket numbers never collide.** The per-guild sequence is allocated
 *   inside a transaction holding a per-guild advisory lock, so two people
 *   opening a ticket at the same instant get #4 and #5, not two #4s. A unique
 *   index backs it up, because a lock that can be forgotten should not be the
 *   only thing standing between a member and two channels called
 *   `ticket-0004`.
 * - **The row outlives the channel.** `channelId` is nullable by design; an
 *   orphaned row is a normal state after any incident, not corruption. Nothing
 *   here assumes the channel still exists.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { isDemo } from "@orbit/core/environment";
import type { TicketState } from "@orbit/core/tickets";
import { database } from "./client";
import { demoRead, demoTransaction } from "./demo";
import * as s from "./schema";

export type TicketRow = {
  id: string;
  guildId: string;
  number: number;
  channelId: string | null;
  openerId: string;
  claimerId: string | null;
  state: TicketState;
  subject: string | null;
  openedAt: string;
  closedAt: string | null;
  closerId: string | null;
  closeReason: string | null;
  lastActivityAt: string;
  transcript: string | null;
  transcriptTruncated: boolean;
  createdAt: string;
  updatedAt: string;
};

const toRow = (r: typeof s.tickets.$inferSelect): TicketRow => ({
  id: r.id,
  guildId: r.guildId,
  number: r.number,
  channelId: r.channelId,
  openerId: r.openerId,
  claimerId: r.claimerId,
  state: r.state as TicketState,
  subject: r.subject,
  openedAt: r.openedAt.toISOString(),
  closedAt: r.closedAt?.toISOString() ?? null,
  closerId: r.closerId,
  closeReason: r.closeReason,
  lastActivityAt: r.lastActivityAt.toISOString(),
  transcript: r.transcript,
  transcriptTruncated: r.transcriptTruncated,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const now = () => new Date();

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getTicket(
  guildId: string,
  id: string
): Promise<TicketRow | null> {
  if (isDemo()) {
    const state = await demoRead();
    const row = state.tickets?.[id];
    return row && row.guildId === guildId ? row : null;
  }
  const db = database().db;
  const [row] = await db
    .select()
    .from(s.tickets)
    .where(and(eq(s.tickets.guildId, guildId), eq(s.tickets.id, id)))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function getTicketByChannel(
  guildId: string,
  channelId: string
): Promise<TicketRow | null> {
  if (isDemo()) {
    const state = await demoRead();
    return (
      Object.values(state.tickets ?? {}).find(
        (row) => row.guildId === guildId && row.channelId === channelId
      ) ?? null
    );
  }
  const db = database().db;
  const [row] = await db
    .select()
    .from(s.tickets)
    .where(
      and(eq(s.tickets.guildId, guildId), eq(s.tickets.channelId, channelId))
    )
    .limit(1);
  return row ? toRow(row) : null;
}

/** How many tickets this member currently has open. Drives the abuse cap. */
export async function countOpenForMember(
  guildId: string,
  userId: string
): Promise<number> {
  if (isDemo()) {
    const state = await demoRead();
    return Object.values(state.tickets ?? {}).filter(
      (row) =>
        row.guildId === guildId &&
        row.openerId === userId &&
        row.state !== "closed"
    ).length;
  }
  const db = database().db;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.tickets)
    .where(
      and(
        eq(s.tickets.guildId, guildId),
        eq(s.tickets.openerId, userId),
        sql`${s.tickets.state} <> 'closed'`
      )
    );
  return count ?? 0;
}

export async function listTickets(
  guildId: string,
  options: {
    state?: TicketState | "all";
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  rows: TicketRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(
    50,
    Math.max(1, Math.floor(options.pageSize ?? 20))
  );
  const state = options.state ?? "all";

  if (isDemo()) {
    const all = Object.values((await demoRead()).tickets ?? {})
      .filter(
        (row) =>
          row.guildId === guildId && (state === "all" || row.state === state)
      )
      .sort((a, b) => b.number - a.number);
    return {
      rows: all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
      total: all.length,
      page,
      pageSize,
    };
  }
  const db = database().db;
  const where =
    state === "all"
      ? eq(s.tickets.guildId, guildId)
      : and(eq(s.tickets.guildId, guildId), eq(s.tickets.state, state));
  const rows = await db
    .select()
    .from(s.tickets)
    .where(where)
    .orderBy(desc(s.tickets.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.tickets)
    .where(where);
  return { rows: rows.map(toRow), total: count ?? 0, page, pageSize };
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/**
 * Open a ticket, allocating the next number for this guild.
 *
 * The number is assigned under a per-guild advisory lock so two simultaneous
 * opens cannot take the same one. The lock is released when the transaction
 * ends, whatever the outcome.
 */
export async function openTicket(input: {
  guildId: string;
  openerId: string;
  channelId?: string | null;
  subject?: string | null;
}): Promise<TicketRow> {
  const id = randomUUID();
  const at = now();

  if (isDemo()) {
    return demoTransaction((state) => {
      state.tickets ??= {};
      const number =
        Object.values(state.tickets)
          .filter((row) => row.guildId === input.guildId)
          .reduce((max, row) => Math.max(max, row.number), 0) + 1;
      const row: TicketRow = {
        id,
        guildId: input.guildId,
        number,
        channelId: input.channelId ?? null,
        openerId: input.openerId,
        claimerId: null,
        state: "open",
        subject: input.subject?.trim() || null,
        openedAt: at.toISOString(),
        closedAt: null,
        closerId: null,
        closeReason: null,
        lastActivityAt: at.toISOString(),
        transcript: null,
        transcriptTruncated: false,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      };
      state.tickets[id] = row;
      return row;
    });
  }

  const db = database().db;
  return db.transaction(async (tx) => {
    // Serialise number allocation per guild. hashtext is stable within a
    // session and only needs to keep two guilds apart, not be unique.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.guildId}, 0))`
    );
    const [{ next }] = await tx
      .select({
        next: sql<number>`coalesce(max(${s.tickets.number}), 0) + 1`.as("next"),
      })
      .from(s.tickets)
      .where(eq(s.tickets.guildId, input.guildId));
    const [row] = await tx
      .insert(s.tickets)
      .values({
        id,
        guildId: input.guildId,
        number: next ?? 1,
        channelId: input.channelId ?? null,
        openerId: input.openerId,
        subject: input.subject?.trim() || null,
        state: "open",
        openedAt: at,
        lastActivityAt: at,
        updatedAt: at,
      })
      .returning();
    return toRow(row);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function setTicketChannel(
  guildId: string,
  id: string,
  channelId: string | null
): Promise<void> {
  const at = now();
  if (isDemo()) {
    await demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (row && row.guildId === guildId) {
        row.channelId = channelId;
        row.updatedAt = at.toISOString();
      }
    });
    return;
  }
  await database()
    .db.update(s.tickets)
    .set({ channelId, updatedAt: at })
    .where(and(eq(s.tickets.guildId, guildId), eq(s.tickets.id, id)));
}

export async function claimTicket(
  guildId: string,
  id: string,
  claimerId: string
): Promise<TicketRow | null> {
  const at = now();
  if (isDemo()) {
    return demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (!row || row.guildId !== guildId) return null;
      // Only an unclaimed, open ticket can be claimed: claiming twice would
      // silently steal it from whoever already had it.
      if (row.state !== "open" || row.claimerId) return null;
      row.claimerId = claimerId;
      row.state = "claimed";
      row.lastActivityAt = at.toISOString();
      row.updatedAt = at.toISOString();
      return row;
    });
  }
  const db = database().db;
  const [row] = await db
    .update(s.tickets)
    .set({ claimerId, state: "claimed", lastActivityAt: at, updatedAt: at })
    .where(
      and(
        eq(s.tickets.guildId, guildId),
        eq(s.tickets.id, id),
        eq(s.tickets.state, "open"),
        sql`${s.tickets.claimerId} is null`
      )
    )
    .returning();
  return row ? toRow(row) : null;
}

export async function closeTicket(
  guildId: string,
  id: string,
  input: {
    closerId: string;
    reason?: string | null;
    transcript?: string | null;
    truncated?: boolean;
  }
): Promise<TicketRow | null> {
  const at = now();
  if (isDemo()) {
    return demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (!row || row.guildId !== guildId || row.state === "closed")
        return null;
      row.state = "closed";
      row.closedAt = at.toISOString();
      row.closerId = input.closerId;
      row.closeReason = input.reason?.trim() || null;
      row.transcript = input.transcript ?? null;
      row.transcriptTruncated = input.truncated ?? false;
      row.updatedAt = at.toISOString();
      return row;
    });
  }
  const db = database().db;
  const [row] = await db
    .update(s.tickets)
    .set({
      state: "closed",
      closedAt: at,
      closerId: input.closerId,
      closeReason: input.reason?.trim() || null,
      transcript: input.transcript ?? null,
      transcriptTruncated: input.truncated ?? false,
      updatedAt: at,
    })
    .where(
      and(
        eq(s.tickets.guildId, guildId),
        eq(s.tickets.id, id),
        sql`${s.tickets.state} <> 'closed'`
      )
    )
    .returning();
  return row ? toRow(row) : null;
}

export async function reopenTicket(
  guildId: string,
  id: string
): Promise<TicketRow | null> {
  const at = now();
  if (isDemo()) {
    return demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (!row || row.guildId !== guildId || row.state !== "closed")
        return null;
      // Reopening returns to `claimed` when someone had claimed it, so the
      // person who was handling it is still the person handling it.
      row.state = row.claimerId ? "claimed" : "open";
      row.closedAt = null;
      row.closerId = null;
      row.lastActivityAt = at.toISOString();
      row.updatedAt = at.toISOString();
      return row;
    });
  }
  const db = database().db;
  const [row] = await db
    .update(s.tickets)
    .set({
      state: sql`case when ${s.tickets.claimerId} is null then 'open' else 'claimed' end`,
      closedAt: null,
      closerId: null,
      lastActivityAt: at,
      updatedAt: at,
    })
    .where(
      and(
        eq(s.tickets.guildId, guildId),
        eq(s.tickets.id, id),
        eq(s.tickets.state, "closed")
      )
    )
    .returning();
  return row ? toRow(row) : null;
}

/** Any message in the ticket resets the auto-close clock. */
export async function touchTicket(guildId: string, id: string): Promise<void> {
  const at = now();
  if (isDemo()) {
    await demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (row && row.guildId === guildId) {
        row.lastActivityAt = at.toISOString();
        row.updatedAt = at.toISOString();
      }
    });
    return;
  }
  await database()
    .db.update(s.tickets)
    .set({ lastActivityAt: at, updatedAt: at })
    .where(and(eq(s.tickets.guildId, guildId), eq(s.tickets.id, id)));
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/** Open tickets untouched for longer than the window, oldest first. */
export async function listStaleTickets(
  cutoff: Date,
  limit = 50
): Promise<TicketRow[]> {
  if (isDemo()) {
    return Object.values((await demoRead()).tickets ?? {})
      .filter(
        (row) =>
          row.state !== "closed" &&
          Date.parse(row.lastActivityAt) <= cutoff.getTime()
      )
      .sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt))
      .slice(0, limit);
  }
  const rows = await database()
    .db.select()
    .from(s.tickets)
    .where(
      and(
        sql`${s.tickets.state} <> 'closed'`,
        sql`${s.tickets.lastActivityAt} <= ${cutoff}`
      )
    )
    .orderBy(asc(s.tickets.lastActivityAt))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * Open tickets whose channel no longer exists.
 *
 * The caller decides whether the channel is really gone — that needs Discord,
 * which this module never touches.
 */
export async function listOpenTickets(
  guildId: string,
  limit = 200
): Promise<TicketRow[]> {
  if (isDemo()) {
    return Object.values((await demoRead()).tickets ?? {})
      .filter((row) => row.guildId === guildId && row.state !== "closed")
      .sort((a, b) => a.number - b.number)
      .slice(0, limit);
  }
  const rows = await database()
    .db.select()
    .from(s.tickets)
    .where(
      and(eq(s.tickets.guildId, guildId), sql`${s.tickets.state} <> 'closed'`)
    )
    .orderBy(asc(s.tickets.number))
    .limit(limit);
  return rows.map(toRow);
}

/** Closed tickets whose transcript has aged out of its retention window. */
export async function listExpiredTranscripts(
  cutoff: Date,
  limit = 100
): Promise<TicketRow[]> {
  if (isDemo()) {
    return Object.values((await demoRead()).tickets ?? {})
      .filter(
        (row) =>
          row.state === "closed" &&
          !!row.closedAt &&
          Date.parse(row.closedAt) <= cutoff.getTime()
      )
      .slice(0, limit);
  }
  const rows = await database()
    .db.select()
    .from(s.tickets)
    .where(
      and(
        eq(s.tickets.state, "closed"),
        sql`${s.tickets.closedAt} is not null and ${s.tickets.closedAt} <= ${cutoff}`
      )
    )
    .limit(limit);
  return rows.map(toRow);
}

/** Drop a ticket row. Used when the channel is gone and the record is not kept. */
export async function deleteTicket(guildId: string, id: string): Promise<void> {
  if (isDemo()) {
    await demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (row && row.guildId === guildId) delete state.tickets![id];
    });
    return;
  }
  await database()
    .db.delete(s.tickets)
    .where(and(eq(s.tickets.guildId, guildId), eq(s.tickets.id, id)));
}

/** Clear a transcript without removing the ticket's record. */
export async function clearTranscript(
  guildId: string,
  id: string
): Promise<void> {
  if (isDemo()) {
    await demoTransaction((state) => {
      const row = state.tickets?.[id];
      if (row && row.guildId === guildId) {
        row.transcript = null;
        row.transcriptTruncated = false;
      }
    });
    return;
  }
  await database()
    .db.update(s.tickets)
    .set({ transcript: null, transcriptTruncated: false, updatedAt: now() })
    .where(and(eq(s.tickets.guildId, guildId), eq(s.tickets.id, id)));
}

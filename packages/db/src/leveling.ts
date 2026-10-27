import { and, desc, eq, sql } from "drizzle-orm";
import { isDemo } from "@orbit/core/environment";
import { levelFromTotalXp, levelProgress } from "@orbit/core/leveling";
import { database } from "./client";
import { demoRead, demoTransaction } from "./demo";
import * as s from "./schema";

/**
 * Leveling storage.
 *
 * Two properties matter more than anything else here:
 *
 * - **Awards are idempotent.** The unique index on `(guild, user, key)` is the
 *   guarantee. A redelivered gateway event, a retried job or a restart
 *   mid-interval all collide and lose.
 * - **Awards are atomic.** The total is incremented in SQL, never read into
 *   the application, added to, and written back. Two awards landing at once
 *   must both count, and a read-modify-write would silently drop one.
 *
 * XP is guild-scoped and is not currency. Nothing here may be spent, traded
 * or transferred; the economy tables are the only place balances live.
 */

export type XpTotal = {
  guildId: string;
  userId: string;
  total: number;
  messageXp: number;
  voiceXp: number;
  adjustedXp: number;
  lastMessageAt: string | null;
  lastMessageHash: string | null;
  updatedAt: string;
};

export type XpAward = {
  /** Idempotency key, e.g. `message:<id>` or `voice:<channel>:<start>`. */
  key: string;
  kind: "message" | "voice" | "adjust";
  /** May be negative for an admin correction. */
  amount: number;
  at?: Date;
  /**
   * Fingerprint of the message, when the award is for one. Used only to spot
   * the same message being repeated; never the content itself.
   */
  fingerprint?: string | null;
};

export type XpAwardResult = {
  /** False when this key has already been paid; the total is unchanged. */
  applied: boolean;
  total: number;
  level: number;
  previousLevel: number;
  leveledUp: boolean;
  /** Levels crossed by this award — more than one is possible. */
  levelsGained: number;
};

const empty: XpTotal = {
  guildId: "",
  userId: "",
  total: 0,
  messageXp: 0,
  voiceXp: 0,
  adjustedXp: 0,
  lastMessageAt: null,
  lastMessageHash: null,
  updatedAt: new Date(0).toISOString(),
};

const keyOf = (guildId: string, userId: string) => `${guildId}:${userId}`;
const db = () => database().db;

function clamp(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, Math.trunc(amount)));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getXpTotal(
  guildId: string,
  userId: string
): Promise<XpTotal> {
  if (isDemo()) {
    const state = await demoRead();
    const found = state.xp?.totals?.[keyOf(guildId, userId)];
    return found
      ? { ...empty, ...found, guildId, userId }
      : { ...empty, guildId, userId };
  }
  const [row] = await db()
    .select()
    .from(s.xpTotals)
    .where(and(eq(s.xpTotals.guildId, guildId), eq(s.xpTotals.userId, userId)))
    .limit(1);
  if (!row) return { ...empty, guildId, userId };
  return {
    guildId: row.guildId,
    userId: row.userId,
    total: row.total,
    messageXp: row.messageXp,
    voiceXp: row.voiceXp,
    adjustedXp: row.adjustedXp,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessageHash: row.lastMessageHash,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function xpProgressOf(total: XpTotal) {
  return levelProgress(total.total);
}

// ---------------------------------------------------------------------------
// Awarding
// ---------------------------------------------------------------------------

/**
 * Award XP once, exactly once per key.
 *
 * Returns the authoritative total and the level before and after, so the
 * caller can reconcile role rewards without recomputing or guessing.
 */
export async function awardXp(
  guildId: string,
  userId: string,
  award: XpAward
): Promise<XpAwardResult> {
  const amount = clamp(award.amount);
  const hash = award.fingerprint ?? null;
  const before = await getXpTotal(guildId, userId);
  const previousLevel = levelFromTotalXp(before.total);

  if (isDemo()) {
    return demoTransaction((state) => {
      state.xp ??= { totals: {}, events: {} };
      state.xp.events ??= {};
      state.xp.totals ??= {};
      const eventKey = keyOf(keyOf(guildId, userId), award.key);
      if (state.xp.events[eventKey]) {
        const current = state.xp.totals[keyOf(guildId, userId)];
        const total = current?.total ?? 0;
        return {
          applied: false,
          total,
          level: levelFromTotalXp(total),
          previousLevel,
          leveledUp: false,
          levelsGained: 0,
        };
      }
      state.xp.events[eventKey] = {
        amount,
        kind: award.kind,
        at: (award.at ?? new Date()).toISOString(),
      };
      const k = keyOf(guildId, userId);
      const existing = state.xp.totals[k] ?? {
        ...empty,
        guildId,
        userId,
        updatedAt: new Date().toISOString(),
      };
      const fingerprint =
        award.kind === "message"
          ? (hash ?? existing.lastMessageHash)
          : existing.lastMessageHash;
      const next: XpTotal = {
        ...existing,
        total: Math.max(0, existing.total + amount),
        messageXp:
          award.kind === "message"
            ? existing.messageXp + amount
            : existing.messageXp,
        voiceXp:
          award.kind === "voice" ? existing.voiceXp + amount : existing.voiceXp,
        adjustedXp:
          award.kind === "adjust"
            ? existing.adjustedXp + amount
            : existing.adjustedXp,
        lastMessageAt:
          award.kind === "message"
            ? (award.at ?? new Date()).toISOString()
            : existing.lastMessageAt,
        lastMessageHash: fingerprint,
        updatedAt: new Date().toISOString(),
      };
      state.xp.totals[k] = next;
      const level = levelFromTotalXp(next.total);
      return {
        applied: true,
        total: next.total,
        level,
        previousLevel,
        leveledUp: level > previousLevel,
        levelsGained: Math.max(0, level - previousLevel),
      };
    });
  }

  return db().transaction(async (tx) => {
    // The unique index decides. Insert first; a duplicate key means someone
    // already paid this one out.
    const inserted = await tx
      .insert(s.xpEvents)
      .values({
        guildId,
        userId,
        key: award.key,
        kind: award.kind,
        amount,
      })
      .onConflictDoNothing()
      .returning({ key: s.xpEvents.key });

    if (!inserted.length) {
      const total = before.total;
      return {
        applied: false,
        total,
        level: levelFromTotalXp(total),
        previousLevel,
        leveledUp: false,
        levelsGained: 0,
      };
    }

    // Increment in SQL. Reading the row and writing `total + amount` back
    // would lose one of two concurrent awards.
    const [row] = await tx
      .insert(s.xpTotals)
      .values({
        guildId,
        userId,
        total: amount,
        messageXp: award.kind === "message" ? amount : 0,
        voiceXp: award.kind === "voice" ? amount : 0,
        adjustedXp: award.kind === "adjust" ? amount : 0,
        lastMessageAt:
          award.kind === "message" ? (award.at ?? new Date()) : null,
      })
      .onConflictDoUpdate({
        target: [s.xpTotals.guildId, s.xpTotals.userId],
        set: {
          total: sql`greatest(0, ${s.xpTotals.total} + ${amount})`,
          messageXp:
            award.kind === "message"
              ? sql`${s.xpTotals.messageXp} + ${amount}`
              : s.xpTotals.messageXp,
          voiceXp:
            award.kind === "voice"
              ? sql`${s.xpTotals.voiceXp} + ${amount}`
              : s.xpTotals.voiceXp,
          adjustedXp:
            award.kind === "adjust"
              ? sql`${s.xpTotals.adjustedXp} + ${amount}`
              : s.xpTotals.adjustedXp,
          lastMessageAt:
            award.kind === "message"
              ? (award.at ?? new Date())
              : s.xpTotals.lastMessageAt,
          updatedAt: new Date(),
        },
      })
      .returning({ total: s.xpTotals.total });

    // `greatest(0, …)` can floor the total, so read the stored value back
    // rather than assuming the arithmetic landed as written.
    const total = row?.total ?? Math.max(0, before.total + amount);
    const level = levelFromTotalXp(total);
    return {
      applied: true,
      total,
      level,
      previousLevel,
      leveledUp: level > previousLevel,
      levelsGained: Math.max(0, level - previousLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export type XpLeaderRow = XpTotal & {
  level: number;
  /** Into-current-level progress, for the bar. */
  into: number;
  needed: number;
  rank: number;
};

export type XpLeaderboard = {
  rows: XpLeaderRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * The leaderboard, ordered by total XP.
 *
 * Deliberately returns XP rows only. Names come from the synchronized roster,
 * which the caller joins — this function must not fetch identity per row, and
 * inventing one here would let the board show people the roster has never
 * seen.
 */
export async function listXpLeaderboard(
  guildId: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<XpLeaderboard> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(options.pageSize ?? 25))
  );
  const offset = (page - 1) * pageSize;

  if (isDemo()) {
    const state = await demoRead();
    const all = Object.values(state.xp?.totals ?? {})
      .filter((row) => row.guildId === guildId && row.total > 0)
      .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId));
    return {
      rows: all.slice(offset, offset + pageSize).map((row, i) => {
        const p = levelProgress(row.total);
        return {
          ...row,
          lastMessageHash: row.lastMessageHash ?? null,
          level: p.level,
          into: p.into,
          needed: p.needed,
          rank: offset + i + 1,
        };
      }),
      total: all.length,
      page,
      pageSize,
    };
  }

  const rows = await db()
    .select()
    .from(s.xpTotals)
    .where(and(eq(s.xpTotals.guildId, guildId), sql`${s.xpTotals.total} > 0`))
    .orderBy(desc(s.xpTotals.total), s.xpTotals.userId)
    .limit(pageSize)
    .offset(offset);
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.xpTotals)
    .where(and(eq(s.xpTotals.guildId, guildId), sql`${s.xpTotals.total} > 0`));

  return {
    rows: rows.map((row, i) => {
      const p = levelProgress(row.total);
      return {
        guildId: row.guildId,
        userId: row.userId,
        total: row.total,
        messageXp: row.messageXp,
        voiceXp: row.voiceXp,
        adjustedXp: row.adjustedXp,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        lastMessageHash: row.lastMessageHash,
        updatedAt: row.updatedAt.toISOString(),
        level: p.level,
        into: p.into,
        needed: p.needed,
        rank: offset + i + 1,
      };
    }),
    total: count ?? 0,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Voice sessions
// ---------------------------------------------------------------------------

export type VoiceSession = {
  guildId: string;
  userId: string;
  channelId: string;
  startedAt: string;
  lastIntervalAt: string | null;
  intervalsAwarded: number;
  brokenAt: string | null;
};

export async function listVoiceSessions(
  guildId: string
): Promise<VoiceSession[]> {
  if (isDemo()) {
    const state = await demoRead();
    return Object.values(state.xp?.voiceSessions ?? {}).filter(
      (row) => row.guildId === guildId
    );
  }
  const rows = await db()
    .select()
    .from(s.xpVoiceSessions)
    .where(eq(s.xpVoiceSessions.guildId, guildId));
  return rows.map((row) => ({
    guildId: row.guildId,
    userId: row.userId,
    channelId: row.channelId,
    startedAt: row.startedAt.toISOString(),
    lastIntervalAt: row.lastIntervalAt?.toISOString() ?? null,
    intervalsAwarded: row.intervalsAwarded,
    brokenAt: row.brokenAt?.toISOString() ?? null,
  }));
}

export async function openVoiceSession(
  guildId: string,
  userId: string,
  channelId: string,
  at: Date = new Date()
): Promise<void> {
  if (isDemo()) {
    await demoTransaction((state) => {
      state.xp ??= { totals: {}, events: {} };
      state.xp.voiceSessions ??= {};
      state.xp.voiceSessions[keyOf(guildId, userId)] = {
        guildId,
        userId,
        channelId,
        startedAt: at.toISOString(),
        lastIntervalAt: null,
        intervalsAwarded: 0,
        brokenAt: null,
      };
    });
    return;
  }
  await db()
    .insert(s.xpVoiceSessions)
    .values({ guildId, userId, channelId, startedAt: at })
    .onConflictDoUpdate({
      target: [s.xpVoiceSessions.guildId, s.xpVoiceSessions.userId],
      set: {
        channelId,
        startedAt: at,
        lastIntervalAt: null,
        intervalsAwarded: 0,
        brokenAt: null,
        updatedAt: new Date(),
      },
    });
}

export async function closeVoiceSession(
  guildId: string,
  userId: string
): Promise<void> {
  if (isDemo()) {
    await demoTransaction((state) => {
      if (state.xp?.voiceSessions)
        delete state.xp.voiceSessions[keyOf(guildId, userId)];
    });
    return;
  }
  await db()
    .delete(s.xpVoiceSessions)
    .where(
      and(
        eq(s.xpVoiceSessions.guildId, guildId),
        eq(s.xpVoiceSessions.userId, userId)
      )
    );
}

/**
 * Record that an interval was paid and move the session's window on.
 *
 * `brokenAt` is set when the member stopped being eligible, and cleared when
 * they become eligible again. That one column is what makes "eligible for the
 * whole interval" answerable without storing a sample history.
 */
export async function markVoiceInterval(
  guildId: string,
  userId: string,
  update: { intervalStart: Date; broken: boolean | null }
): Promise<void> {
  if (isDemo()) {
    await demoTransaction((state) => {
      const sessions = ((state.xp ??= {
        totals: {},
        events: {},
      }).voiceSessions ??= {});
      const key = keyOf(guildId, userId);
      const row = sessions[key];
      if (!row) return;
      sessions[key] = {
        ...row,
        lastIntervalAt: update.intervalStart.toISOString(),
        intervalsAwarded: row.intervalsAwarded + 1,
        brokenAt:
          update.broken === null
            ? row.brokenAt
            : update.broken
              ? new Date().toISOString()
              : null,
      };
    });
    return;
  }
  await db()
    .update(s.xpVoiceSessions)
    .set({
      lastIntervalAt: update.intervalStart,
      intervalsAwarded: sql`${s.xpVoiceSessions.intervalsAwarded} + 1`,
      brokenAt:
        update.broken === null
          ? s.xpVoiceSessions.brokenAt
          : update.broken
            ? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(s.xpVoiceSessions.guildId, guildId),
        eq(s.xpVoiceSessions.userId, userId)
      )
    );
}

// ---------------------------------------------------------------------------
// Reward grants
// ---------------------------------------------------------------------------

export type RewardGrant = {
  guildId: string;
  userId: string;
  level: number;
  roleId: string;
  grantedAt: string | null;
  error: string | null;
};

export async function listRewardGrants(
  guildId: string,
  userId: string
): Promise<RewardGrant[]> {
  if (isDemo()) {
    const state = await demoRead();
    return Object.values(state.xp?.rewardGrants ?? {}).filter(
      (row) => row.guildId === guildId && row.userId === userId
    );
  }
  const rows = await db()
    .select()
    .from(s.xpRewardGrants)
    .where(
      and(
        eq(s.xpRewardGrants.guildId, guildId),
        eq(s.xpRewardGrants.userId, userId)
      )
    );
  return rows.map((row) => ({
    guildId: row.guildId,
    userId: row.userId,
    level: row.level,
    roleId: row.roleId,
    grantedAt: row.grantedAt?.toISOString() ?? null,
    error: row.error,
  }));
}

/**
 * Record the outcome of trying to give a reward role.
 *
 * A failure is recorded too, with the reason. That is what lets a later
 * reconcile retry it, and what stops an announcement going out twice — the
 * row exists either way, so "already handled" is one question.
 */
export async function recordRewardGrant(
  grant: Omit<RewardGrant, "grantedAt"> & { grantedAt?: string | null }
): Promise<void> {
  const values = {
    guildId: grant.guildId,
    userId: grant.userId,
    level: grant.level,
    roleId: grant.roleId,
    grantedAt: grant.grantedAt ? new Date(grant.grantedAt) : null,
    error: grant.error,
  };
  if (isDemo()) {
    await demoTransaction((state) => {
      state.xp ??= { totals: {}, events: {} };
      state.xp.rewardGrants ??= {};
      state.xp.rewardGrants[
        `${keyOf(grant.guildId, grant.userId)}:${grant.level}:${grant.roleId}`
      ] = {
        guildId: grant.guildId,
        userId: grant.userId,
        level: grant.level,
        roleId: grant.roleId,
        grantedAt: grant.grantedAt ?? null,
        error: grant.error,
      };
    });
    return;
  }
  await db()
    .insert(s.xpRewardGrants)
    .values(values)
    .onConflictDoUpdate({
      target: [
        s.xpRewardGrants.guildId,
        s.xpRewardGrants.userId,
        s.xpRewardGrants.level,
        s.xpRewardGrants.roleId,
      ],
      set: {
        grantedAt: values.grantedAt,
        error: values.error,
        updatedAt: new Date(),
      },
    });
}

export async function deleteRewardGrantsForRole(
  guildId: string,
  roleId: string
): Promise<void> {
  if (isDemo()) {
    await demoTransaction((state) => {
      const grants = state.xp?.rewardGrants;
      if (!grants) return;
      for (const [key, row] of Object.entries(grants))
        if (row.guildId === guildId && row.roleId === roleId)
          delete grants[key];
    });
    return;
  }
  await db()
    .delete(s.xpRewardGrants)
    .where(
      and(
        eq(s.xpRewardGrants.guildId, guildId),
        eq(s.xpRewardGrants.roleId, roleId)
      )
    );
}

// ---------------------------------------------------------------------------

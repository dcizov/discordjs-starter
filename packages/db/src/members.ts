import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { isDemo } from "@orbit/core/environment";
import { displayName, type PersonNames } from "@orbit/core/identity";
import {
  membersQuerySchema,
  type MemberFilter,
  type MembersQuery,
} from "@orbit/core/members-query";
import type { Member, MembersPage, RosterSync } from "@orbit/core";
import { database } from "./client";
import { demoRead, demoTransaction } from "./demo";
import * as s from "./schema";
import { serialize } from "./store";

/** What a sync writes for one member. Identity fields are nullable on purpose. */
export type MemberInput = {
  userId: string;
  username: string | null;
  globalName: string | null;
  nickname: string | null;
  avatar: string | null;
  guildAvatar: string | null;
  bot: boolean;
  joinedAt: Date | string | null;
  roles: string[];
  present?: boolean;
};

function row(input: MemberInput, guildId: string) {
  const names: PersonNames = {
    userId: input.userId,
    username: input.username,
    globalName: input.globalName,
    nickname: input.nickname,
  };
  return {
    guildId,
    userId: input.userId,
    username: input.username,
    globalName: input.globalName,
    nickname: input.nickname,
    displayName: displayName(names, "guild"),
    avatar: input.avatar,
    guildAvatar: input.guildAvatar,
    bot: input.bot,
    joinedAt: input.joinedAt ? new Date(input.joinedAt) : null,
    roles: input.roles,
    // An upsert always describes a member the bot just saw, so they are present.
    present: input.present ?? true,
    departedAt: input.present === false ? new Date() : null,
    syncedAt: new Date(),
  };
}

/** Upsert a batch of members the bot has just observed. */
export async function upsertMembers(guildId: string, inputs: MemberInput[]) {
  if (!inputs.length) return;
  const values = inputs.map((input) => row(input, guildId));
  if (isDemo()) {
    await demoTransaction((data) => {
      data.members ??= [];
      for (const value of values) {
        const index = data.members.findIndex(
          (m) => m.guildId === guildId && m.userId === value.userId
        );
        const stored = {
          ...value,
          joinedAt: value.joinedAt?.toISOString() ?? null,
          departedAt: value.departedAt?.toISOString() ?? null,
          syncedAt: value.syncedAt.toISOString(),
        } as Member;
        if (index >= 0)
          data.members[index] = { ...data.members[index], ...stored };
        else data.members.push(stored);
      }
      return null;
    });
    return;
  }
  const db = database().db;
  // Chunked so one very large roster cannot exceed the driver's parameter limit.
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db
      .insert(s.members)
      .values(batch)
      .onConflictDoUpdate({
        target: [s.members.guildId, s.members.userId],
        set: {
          username: sql`excluded.username`,
          globalName: sql`excluded.global_name`,
          nickname: sql`excluded.nickname`,
          displayName: sql`excluded.display_name`,
          avatar: sql`excluded.avatar`,
          guildAvatar: sql`excluded.guild_avatar`,
          bot: sql`excluded.bot`,
          joinedAt: sql`excluded.joined_at`,
          roles: sql`excluded.roles`,
          present: sql`true`,
          departedAt: sql`null`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }
}

/** A removal event, or a complete sweep that did not see this member. */
export async function markMembersDeparted(guildId: string, userIds: string[]) {
  if (!userIds.length) return;
  if (isDemo()) {
    await demoTransaction((data) => {
      const at = new Date().toISOString();
      for (const m of data.members ?? [])
        if (m.guildId === guildId && userIds.includes(m.userId)) {
          m.present = false;
          m.departedAt = at;
        }
      return null;
    });
    return;
  }
  for (let i = 0; i < userIds.length; i += 500) {
    await database()
      .db.update(s.members)
      .set({ present: false, departedAt: new Date() })
      .where(
        and(
          eq(s.members.guildId, guildId),
          inArray(s.members.userId, userIds.slice(i, i + 500))
        )
      );
  }
}

/**
 * Mark everyone *not* in `seen` as departed.
 *
 * Only called after a sweep that finished, so an interrupted sync can never turn
 * "I did not get that far" into "they left".
 */
export async function markAbsentDeparted(guildId: string, seen: string[]) {
  if (isDemo()) {
    await demoTransaction((data) => {
      const at = new Date().toISOString();
      for (const m of data.members ?? [])
        if (m.guildId === guildId && m.present && !seen.includes(m.userId)) {
          m.present = false;
          m.departedAt = at;
        }
      return null;
    });
    return;
  }
  for (let i = 0; i < seen.length; i += 500) {
    await database()
      .db.update(s.members)
      .set({ present: false, departedAt: new Date() })
      .where(
        and(
          eq(s.members.guildId, guildId),
          eq(s.members.present, true),
          notInArray(s.members.userId, seen.slice(i, i + 500))
        )
      );
  }
}

export async function getRosterSync(guildId: string): Promise<RosterSync> {
  const empty: RosterSync = {
    guildId,
    status: "never",
    startedAt: null,
    completedAt: null,
    lastAttemptAt: null,
    pagesFetched: 0,
    syncedCount: 0,
    expectedCount: 0,
    lastError: null,
  };
  if (isDemo()) {
    const d = await demoRead();
    return d.rosterSync?.[guildId] ?? empty;
  }
  const [stored] = await database()
    .db.select()
    .from(s.rosterSync)
    .where(eq(s.rosterSync.guildId, guildId));
  if (!stored)
    return {
      ...empty,
      syncedCount: await countMembers(guildId),
    };
  return serialize({
    guildId,
    status: stored.status as RosterSync["status"],
    startedAt: stored.startedAt?.toISOString() ?? null,
    completedAt: stored.completedAt?.toISOString() ?? null,
    lastAttemptAt: stored.lastAttemptAt?.toISOString() ?? null,
    pagesFetched: stored.pagesFetched,
    syncedCount: stored.syncedCount,
    expectedCount: stored.expectedCount,
    lastError: stored.lastError,
  }) as RosterSync;
}

export async function saveRosterSync(
  guildId: string,
  patch: Partial<
    Omit<RosterSync, "guildId" | "startedAt" | "completedAt" | "lastAttemptAt">
  > & {
    startedAt?: Date | null;
    completedAt?: Date | null;
    lastAttemptAt?: Date | null;
  }
) {
  if (isDemo()) {
    await demoTransaction((data) => {
      data.rosterSync ??= {};
      const current: RosterSync = data.rosterSync[guildId] ?? {
        guildId,
        status: "never",
        startedAt: null,
        completedAt: null,
        lastAttemptAt: null,
        pagesFetched: 0,
        syncedCount: 0,
        expectedCount: 0,
        lastError: null,
      };
      data.rosterSync[guildId] = {
        ...current,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.pagesFetched !== undefined
          ? { pagesFetched: patch.pagesFetched }
          : {}),
        ...(patch.syncedCount !== undefined
          ? { syncedCount: patch.syncedCount }
          : {}),
        ...(patch.expectedCount !== undefined
          ? { expectedCount: patch.expectedCount }
          : {}),
        ...(patch.lastError !== undefined
          ? { lastError: patch.lastError }
          : {}),
        ...(patch.startedAt !== undefined
          ? { startedAt: patch.startedAt?.toISOString() ?? null }
          : {}),
        ...(patch.completedAt !== undefined
          ? { completedAt: patch.completedAt?.toISOString() ?? null }
          : {}),
        lastAttemptAt: new Date().toISOString(),
      };
      return null;
    });
    return;
  }
  const values = {
    guildId,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.pagesFetched !== undefined
      ? { pagesFetched: patch.pagesFetched }
      : {}),
    ...(patch.syncedCount !== undefined
      ? { syncedCount: patch.syncedCount }
      : {}),
    ...(patch.expectedCount !== undefined
      ? { expectedCount: patch.expectedCount }
      : {}),
    ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
    ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
    ...(patch.completedAt !== undefined
      ? { completedAt: patch.completedAt }
      : {}),
    lastAttemptAt: new Date(),
  };
  await database()
    .db.insert(s.rosterSync)
    .values(values)
    .onConflictDoUpdate({
      target: s.rosterSync.guildId,
      set: {
        status: sql`excluded.status`,
        pagesFetched: sql`excluded.pages_fetched`,
        syncedCount: sql`excluded.synced_count`,
        expectedCount: sql`excluded.expected_count`,
        lastError: sql`excluded.last_error`,
        startedAt: sql`coalesce(excluded.started_at, ${s.rosterSync.startedAt})`,
        completedAt: sql`coalesce(excluded.completed_at, ${s.rosterSync.completedAt})`,
        lastAttemptAt: sql`excluded.last_attempt_at`,
      },
    });
}

async function countMembers(guildId: string) {
  if (isDemo()) {
    const d = await demoRead();
    return (d.members ?? []).filter((m) => m.guildId === guildId && m.present)
      .length;
  }
  const [row] = await database()
    .db.select({ n: sql<number>`count(*)::int` })
    .from(s.members)
    .where(and(eq(s.members.guildId, guildId), eq(s.members.present, true)));
  return row?.n ?? 0;
}

function filterClause(filter: MemberFilter) {
  if (filter === "humans") return eq(s.members.present, true);
  if (filter === "bots") return eq(s.members.present, true);
  if (filter === "departed") return eq(s.members.present, false);
  return undefined;
}

/** Server-side paged, searched and sorted roster for the members screen. */
export async function listMembers(
  guildId: string,
  input: Partial<MembersQuery>
): Promise<MembersPage> {
  const query = membersQuerySchema.parse({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 25,
    query: input.query ?? "",
    filter: input.filter ?? "all",
    sort: input.sort ?? "displayName",
    dir: input.dir ?? "asc",
  });
  const offset = (query.page - 1) * query.pageSize;
  const sync = await getRosterSync(guildId);

  if (isDemo()) {
    const d = await demoRead();
    const all = (d.members ?? []).filter((m) => m.guildId === guildId);
    const matching = all
      .filter((m) => {
        if (query.filter === "humans") return m.present && !m.bot;
        if (query.filter === "bots") return m.present && m.bot;
        if (query.filter === "departed") return !m.present;
        return true;
      })
      .filter((m) => {
        const term = query.query.trim().toLowerCase();
        if (!term) return true;
        return [m.displayName, m.username, m.nickname, m.globalName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const dir = query.dir === "asc" ? 1 : -1;
        if (query.sort === "joinedAt")
          return (
            dir *
            String(a.joinedAt ?? "").localeCompare(String(b.joinedAt ?? ""))
          );
        if (query.sort === "username")
          return dir * (a.username ?? "").localeCompare(b.username ?? "");
        return dir * a.displayName.localeCompare(b.displayName);
      });
    return {
      rows: matching.slice(offset, offset + query.pageSize),
      total: matching.length,
      page: query.page,
      pageSize: query.pageSize,
      sync: {
        ...sync,
        syncedCount: all.filter((m) => m.present).length,
      },
      counts: {
        guildMemberCount:
          d.guilds.find((g) => g.id === guildId)?.memberCount ?? 0,
        syncedMembers: all.filter((m) => m.present).length,
        economyAccounts: d.accounts.filter((a) => a.guildId === guildId).length,
        bots: all.filter((m) => m.present && m.bot).length,
        departed: all.filter((m) => !m.present).length,
      },
    };
  }

  const db = database().db;
  const term = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`;
  const conditions = [
    eq(s.members.guildId, guildId),
    filterClause(query.filter) as never,
    query.filter === "humans" ? eq(s.members.bot, false) : undefined,
    query.filter === "bots" ? eq(s.members.bot, true) : undefined,
    query.query
      ? or(
          ilike(s.members.displayName, term),
          ilike(s.members.username, term),
          ilike(s.members.nickname, term),
          ilike(s.members.globalName, term)
        )
      : undefined,
  ].filter(Boolean) as never[];
  const where = and(...conditions);
  const column =
    query.sort === "joinedAt"
      ? s.members.joinedAt
      : query.sort === "username"
        ? s.members.username
        : s.members.displayName;
  const primary = query.dir === "asc" ? asc(column) : desc(column);
  const [rows, total, guild, accounts, bots, departed] = await Promise.all([
    db
      .select()
      .from(s.members)
      .where(where)
      .orderBy(primary, desc(s.members.userId))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ n: count() }).from(s.members).where(where),
    db
      .select({ n: s.guilds.memberCount })
      .from(s.guilds)
      .where(eq(s.guilds.id, guildId)),
    db
      .select({ n: count() })
      .from(s.accounts)
      .where(eq(s.accounts.guildId, guildId)),
    db
      .select({ n: count() })
      .from(s.members)
      .where(
        and(
          eq(s.members.guildId, guildId),
          eq(s.members.bot, true),
          eq(s.members.present, true)
        )
      ),
    db
      .select({ n: count() })
      .from(s.members)
      .where(and(eq(s.members.guildId, guildId), eq(s.members.present, false))),
  ]);
  return serialize({
    rows: rows.map((r) => ({
      ...r,
      joinedAt: r.joinedAt ? r.joinedAt.toISOString() : null,
      departedAt: r.departedAt ? r.departedAt.toISOString() : null,
      syncedAt: r.syncedAt.toISOString(),
    })),
    total: Number(total[0]?.n ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    sync: {
      ...sync,
      syncedCount: sync.syncedCount || (await countMembers(guildId)),
    },
    counts: {
      guildMemberCount: guild[0]?.n ?? 0,
      syncedMembers: await countMembers(guildId),
      economyAccounts: Number(accounts[0]?.n ?? 0),
      bots: Number(bots[0]?.n ?? 0),
      departed: Number(departed[0]?.n ?? 0),
    },
  }) as MembersPage;
}

/**
 * Refresh the identity columns of existing economy accounts from the roster.
 *
 * Current-identity surfaces (leaderboard, ledger counterparties, the member
 * picker, the active music requester) must not wait for a member's next economy
 * interaction to learn a new nickname or avatar. Only rows that already exist are
 * touched: the roster never creates economy accounts, because a member is not an
 * account and inventing a balance row for one would corrupt the economy.
 */
export async function refreshAccountIdentity(
  guildId: string,
  inputs: MemberInput[]
) {
  if (!inputs.length) return;
  if (isDemo()) {
    await demoTransaction((data) => {
      for (const input of inputs) {
        const account = data.accounts.find(
          (a) => a.guildId === guildId && a.userId === input.userId
        );
        if (!account) continue;
        account.name = displayName(
          {
            username: input.username,
            globalName: input.globalName,
            nickname: input.nickname,
          },
          "guild"
        );
        account.username = input.username;
        account.globalName = input.globalName;
        account.avatar = input.avatar;
        account.guildAvatar = input.guildAvatar;
      }
      return null;
    });
    return;
  }
  for (const input of inputs) {
    await database()
      .db.update(s.accounts)
      .set({
        name: displayName(
          {
            username: input.username,
            globalName: input.globalName,
            nickname: input.nickname,
          },
          "guild"
        ),
        username: input.username,
        globalName: input.globalName,
        avatar: input.avatar,
        guildAvatar: input.guildAvatar,
      })
      .where(
        and(
          eq(s.accounts.guildId, guildId),
          eq(s.accounts.userId, input.userId)
        )
      );
  }
}

/**
 * The roster's current identity for a set of users, for surfaces that are about
 * people *now* (leaderboard, ledger, music queue, account menu).
 *
 * This is a single batched read of rows the bot already synchronized. It never
 * calls Discord, so displaying a name never depends on the reader waiting for a
 * member to interact with the bot again. Departed members are included on
 * purpose: their last synchronized identity is still the best available answer
 * for an economy row, and this function makes no claim about presence — that is
 * `listMembers`' job.
 */
export type MemberIdentity = {
  userId: string;
  username: string | null;
  globalName: string | null;
  nickname: string | null;
  avatar: string | null;
  guildAvatar: string | null;
  present: boolean;
};

export async function getMemberIdentities(
  guildId: string,
  userIds: string[]
): Promise<MemberIdentity[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  if (isDemo()) {
    const d = await demoRead();
    return (d.members ?? [])
      .filter((m) => m.guildId === guildId && ids.includes(m.userId))
      .map((m) => ({
        userId: m.userId,
        username: m.username ?? null,
        globalName: m.globalName ?? null,
        nickname: m.nickname ?? null,
        avatar: m.avatar ?? null,
        guildAvatar: m.guildAvatar ?? null,
        present: m.present !== false,
      }));
  }
  const out: MemberIdentity[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await database()
      .db.select({
        userId: s.members.userId,
        username: s.members.username,
        globalName: s.members.globalName,
        nickname: s.members.nickname,
        avatar: s.members.avatar,
        guildAvatar: s.members.guildAvatar,
        present: s.members.present,
      })
      .from(s.members)
      .where(
        and(
          eq(s.members.guildId, guildId),
          inArray(s.members.userId, ids.slice(i, i + 500))
        )
      );
    out.push(...rows);
  }
  return out;
}

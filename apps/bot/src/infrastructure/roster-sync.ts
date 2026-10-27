import { logger } from "@orbit/core/logger";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import {
  getRosterSync,
  markMembersDeparted,
  markAbsentDeparted,
  refreshAccountIdentity,
  saveRosterSync,
  upsertMembers,
  type MemberInput,
} from "@orbit/db";
import type { Guild, GuildMember, PartialGuildMember } from "discord.js";

/**
 * Bot-owned roster synchronization.
 *
 * Orbit does not ask Discord to list members per dashboard request, and the
 * dashboard never guesses membership from economy accounts. Instead the bot keeps
 * a copy of the guild roster it is already authorized to read (`GuildMembers`
 * intent, no Presence intent) and the dashboard pages that copy.
 *
 * The guarantees this module is written to keep:
 *
 * - **Bounded.** A sweep reads at most `ROSTER_MAX_PAGES × ROSTER_PAGE_SIZE`
 *   members, then stops and reports `partial`. No unbounded loop can be triggered
 *   from the dashboard.
 * - **Honest.** `roster_sync.status` is `complete` only when Discord said there
 *   was nothing left to read. A failure records `failed` and keeps every row it
 *   already had; it never turns "I did not get that far" into "they left".
 * - **Non-destructive.** Rows are only marked departed by a removal event or by a
 *   sweep that finished. A partial or failed sweep leaves `present` untouched.
 * - **Rate-limit aware.** Discord's REST client queues and backs off; this module
 *   issues one bounded page at a time rather than one request per member.
 */
export const ROSTER_PAGE_SIZE = 1000;
export const ROSTER_MAX_PAGES = 20;
/** A complete copy is refreshed at most this often by reconciliation. */
export const ROSTER_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** How many guilds one reconciliation pass may sweep. */
export const ROSTER_RECONCILE_BUDGET = 5;

/** The identity fields this module is allowed to collect, and nothing else. */
export function memberInput(member: GuildMember): MemberInput {
  return {
    userId: member.id,
    username: member.user.username ?? null,
    globalName: member.user.globalName ?? null,
    nickname: member.nickname ?? null,
    avatar: member.user.avatar ?? null,
    guildAvatar: member.avatar ?? null,
    bot: !!member.user.bot,
    joinedAt: member.joinedAt ?? null,
    roles: [...member.roles.cache.keys()].filter(
      (id) => id !== member.guild.id
    ),
    present: true,
  };
}

export type RosterSyncResult = {
  status: "complete" | "partial" | "failed";
  seen: number;
  pages: number;
  error?: string;
};

/**
 * Read the whole roster, one bounded page at a time.
 *
 * Safe to call concurrently with itself in the sense that it only ever upserts:
 * two overlapping sweeps converge on the same rows instead of corrupting them.
 */
export async function syncRoster(
  guild: Guild,
  reason: "startup" | "reconcile" | "manual" | "installed" = "manual",
  options: { maxPages?: number } = {}
): Promise<RosterSyncResult> {
  const maxPages = options.maxPages ?? ROSTER_MAX_PAGES;
  const startedAt = new Date();
  const expectedCount = guild.memberCount ?? 0;
  await saveRosterSync(guild.id, {
    status: "running",
    startedAt,
    completedAt: null,
    pagesFetched: 0,
    syncedCount: 0,
    expectedCount,
    lastError: null,
  });
  const seen: string[] = [];
  let pages = 0;
  try {
    let after = "0";
    let complete = false;
    while (pages < maxPages) {
      const batch = await guild.members.list({
        limit: ROSTER_PAGE_SIZE,
        after,
      });
      if (!batch.size) {
        complete = true;
        break;
      }
      const inputs = [...batch.values()].map(memberInput);
      await upsertMembers(guild.id, inputs);
      // Current-identity surfaces must not wait for each member's next economy
      // interaction to learn a new nickname or avatar.
      await refreshAccountIdentity(guild.id, inputs);
      seen.push(...inputs.map((input) => input.userId));
      pages += 1;
      after = [...batch.keys()].pop()!;
      await saveRosterSync(guild.id, {
        pagesFetched: pages,
        syncedCount: seen.length,
      });
      if (batch.size < ROSTER_PAGE_SIZE) {
        complete = true;
        break;
      }
    }
    if (complete && seen.length) await markAbsentDeparted(guild.id, seen);
    const syncedCount = seen.length;
    await saveRosterSync(guild.id, {
      status: complete ? "complete" : "partial",
      completedAt: new Date(),
      syncedCount,
      pagesFetched: pages,
      expectedCount: guild.memberCount ?? expectedCount,
      lastError: complete
        ? null
        : `Stopped after ${pages} page(s) (${ROSTER_PAGE_SIZE} members each) to stay within the sync budget. The roster is incomplete; run a full sync again.`,
    });
    logger.info(
      { guildId: guild.id, pages, syncedCount, complete, reason },
      complete ? "Roster synchronized" : "Roster partially synchronized"
    );
    return {
      status: complete ? "complete" : "partial",
      seen: syncedCount,
      pages,
    };
  } catch (error) {
    // Keep every row already written; only the status changes. `present` is never
    // touched here, so a failed refresh cannot look like a mass departure.
    const diagnostic = errorDiagnostic(error);
    await saveRosterSync(guild.id, {
      status: "failed",
      completedAt: new Date(),
      syncedCount: seen.length,
      pagesFetched: pages,
      expectedCount: guild.memberCount ?? expectedCount,
      lastError: diagnostic,
    });
    logger.warn(
      { guildId: guild.id, pages, seen: seen.length, error: diagnostic },
      "Roster synchronization failed; keeping the previous rows"
    );
    return {
      status: "failed",
      seen: seen.length,
      pages,
      error: diagnostic,
    };
  }
}

/** A join, or any change to a member the bot can already see. */
export async function recordMember(member: GuildMember) {
  const input = memberInput(member);
  await upsertMembers(member.guild.id, [input]);
  await refreshAccountIdentity(member.guild.id, [input]);
}

/**
 * A removal event is the only single-member signal that is trustworthy.
 *
 * Discord sends a partial member here (the user has already left the guild, so
 * roles and joinedAt are gone); only the id is needed and only the id is used.
 */
export async function recordDeparture(
  member: GuildMember | PartialGuildMember
) {
  await markMembersDeparted(member.guild.id, [member.id]);
}

/**
 * Bounded reconciliation for missed events and restarts.
 *
 * Only guilds whose copy is not complete, or whose complete copy is stale, are
 * swept, and only `budget` of them per pass. A boot after a long outage therefore
 * does not issue dozens of full roster reads at once.
 */
export async function reconcileRosters(
  guilds: Iterable<Guild>,
  options: { budget?: number; now?: number } = {}
) {
  const budget = options.budget ?? ROSTER_RECONCILE_BUDGET;
  const now = options.now ?? Date.now();
  let swept = 0;
  for (const guild of guilds) {
    if (swept >= budget) break;
    let state;
    try {
      state = await getRosterSync(guild.id);
    } catch (error) {
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Could not read roster state"
      );
      continue;
    }
    const stale =
      state.status !== "complete" ||
      !state.completedAt ||
      now - new Date(state.completedAt).getTime() > ROSTER_MAX_AGE_MS;
    if (!stale) continue;
    swept += 1;
    await syncRoster(guild, "reconcile");
  }
  return swept;
}

import { describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  save: vi.fn(),
  upsert: vi.fn(),
  refresh: vi.fn(),
  absent: vi.fn(),
  departed: vi.fn(),
  state: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@orbit/db", () => ({
  saveRosterSync: f.save,
  upsertMembers: f.upsert,
  refreshAccountIdentity: f.refresh,
  markAbsentDeparted: f.absent,
  markMembersDeparted: f.departed,
  getRosterSync: f.state,
}));
vi.mock("@orbit/core/logger", () => ({
  logger: { info: f.info, warn: f.warn },
}));
import {
  ROSTER_MAX_AGE_MS,
  ROSTER_MAX_PAGES,
  ROSTER_PAGE_SIZE,
  memberInput,
  reconcileRosters,
  recordDeparture,
  syncRoster,
} from "../apps/bot/src/infrastructure/roster-sync";

type FakeMember = {
  id: string;
  nickname: string | null;
  avatar: string | null;
  joinedAt: Date;
  guild: { id: string };
  user: {
    username: string;
    globalName: string | null;
    avatar: string | null;
    bot: boolean;
  };
  roles: { cache: Map<string, unknown> };
};

function member(id: string, overrides: Partial<FakeMember> = {}): FakeMember {
  return {
    id,
    nickname: null,
    avatar: null,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    guild: { id: "guild-1" },
    user: {
      username: `user${id}`,
      globalName: null,
      avatar: null,
      bot: false,
    },
    roles: { cache: new Map([["everyone", {}]]) },
    ...overrides,
  };
}

function page(ids: string[]) {
  return new Map(ids.map((id) => [id, member(id)]));
}

function guild(pages: Map<string, FakeMember>[], memberCount = 1234) {
  let call = 0;
  const list = vi.fn(async () => {
    const next = pages[call] ?? new Map();
    call += 1;
    return next;
  });
  return {
    guild: {
      id: "guild-1",
      memberCount,
      members: { list },
    } as unknown as import("discord.js").Guild,
    list,
  };
}

const ids = (count: number, prefix = "u") =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);

function reset() {
  vi.clearAllMocks();
  for (const mock of [f.save, f.upsert, f.refresh, f.absent, f.departed])
    mock.mockResolvedValue(undefined);
  f.state.mockResolvedValue({
    guildId: "guild-1",
    status: "never",
    startedAt: null,
    completedAt: null,
    lastAttemptAt: null,
    pagesFetched: 0,
    syncedCount: 0,
    expectedCount: 0,
    lastError: null,
  });
}

describe("roster synchronization", () => {
  it("reports complete only once Discord says there is nothing left", async () => {
    reset();
    const full = page(ids(ROSTER_PAGE_SIZE));
    const short = page(["tail-1", "tail-2"]);
    const { guild: g, list } = guild([full, short]);
    const result = await syncRoster(g, "startup");
    expect(result).toMatchObject({ status: "complete", pages: 2 });
    expect(result.seen).toBe(ROSTER_PAGE_SIZE + 2);
    // One request per page, never one per member.
    expect(list).toHaveBeenCalledTimes(2);
    expect(f.upsert).toHaveBeenCalledTimes(2);
    expect(f.absent).toHaveBeenCalledOnce();
    expect(f.absent.mock.calls[0][1]).toHaveLength(ROSTER_PAGE_SIZE + 2);
    expect(f.departed).not.toHaveBeenCalled();
    const final = f.save.mock.calls.at(-1)![1];
    expect(final).toMatchObject({
      status: "complete",
      syncedCount: ROSTER_PAGE_SIZE + 2,
      expectedCount: 1234,
      lastError: null,
    });
  });

  it("stops at the page budget, reports partial, and marks nobody as departed", async () => {
    reset();
    const pages = Array.from({ length: ROSTER_MAX_PAGES }, () =>
      page(ids(ROSTER_PAGE_SIZE))
    );
    const { guild: g, list } = guild(pages);
    const result = await syncRoster(g, "reconcile", { maxPages: 3 });
    expect(result.status).toBe("partial");
    expect(list).toHaveBeenCalledTimes(3);
    // An interrupted sweep is not evidence that anyone left.
    expect(f.absent).not.toHaveBeenCalled();
    const final = f.save.mock.calls.at(-1)![1];
    expect(final.status).toBe("partial");
    expect(final.lastError).toContain("sync budget");
  });

  it("keeps the previous rows when a page fails, and never converts a failure into departures", async () => {
    reset();
    let call = 0;
    const list = vi.fn(async () => {
      call += 1;
      if (call === 1) return page(ids(ROSTER_PAGE_SIZE));
      throw new Error("Discord 500: upstream error");
    });
    const g = {
      id: "guild-1",
      memberCount: 900,
      members: { list },
    } as unknown as import("discord.js").Guild;
    const result = await syncRoster(g, "manual");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("upstream error");
    // The successful page was stored; the failed one touched nothing.
    expect(f.upsert).toHaveBeenCalledOnce();
    expect(f.absent).not.toHaveBeenCalled();
    expect(f.departed).not.toHaveBeenCalled();
    const final = f.save.mock.calls.at(-1)![1];
    expect(final).toMatchObject({
      status: "failed",
      syncedCount: ROSTER_PAGE_SIZE,
    });
    expect(final.lastError).toContain("upstream error");
  });

  it("treats a removal event as the only single-member departure signal", async () => {
    reset();
    await recordDeparture({
      id: "u-gone",
      guild: { id: "guild-1" },
    } as unknown as import("discord.js").PartialGuildMember);
    expect(f.departed).toHaveBeenCalledWith("guild-1", ["u-gone"]);
  });

  it("collects identity fields only, and never presence", () => {
    const input = memberInput(
      member("u1", {
        nickname: "Guild name",
        avatar: "guildhash",
        user: {
          username: "handle",
          globalName: "Global",
          avatar: "globalhash",
          bot: true,
        },
        roles: {
          cache: new Map([
            ["guild-1", {}],
            ["role-a", {}],
            ["role-b", {}],
          ]),
        },
      }) as unknown as import("discord.js").GuildMember
    );
    expect(input).toEqual({
      userId: "u1",
      username: "handle",
      globalName: "Global",
      nickname: "Guild name",
      avatar: "globalhash",
      guildAvatar: "guildhash",
      bot: true,
      joinedAt: new Date("2026-01-01T00:00:00Z"),
      roles: ["role-a", "role-b"],
      present: true,
    });
    expect(Object.keys(input)).not.toContain("presence");
    expect(Object.keys(input)).not.toContain("status");
  });

  it("reconciles only guilds whose copy is missing or stale, within a budget", async () => {
    reset();
    const fresh = {
      id: "fresh",
      memberCount: 1,
      members: { list: vi.fn(async () => new Map()) },
    } as unknown as import("discord.js").Guild;
    const missing = {
      id: "missing",
      memberCount: 1,
      members: { list: vi.fn(async () => new Map()) },
    } as unknown as import("discord.js").Guild;
    const stale = {
      id: "stale",
      memberCount: 1,
      members: { list: vi.fn(async () => new Map()) },
    } as unknown as import("discord.js").Guild;
    f.state.mockImplementation(async (guildId: string) => ({
      guildId,
      status: guildId === "fresh" ? "complete" : "complete",
      startedAt: null,
      completedAt:
        guildId === "fresh"
          ? new Date().toISOString()
          : new Date(Date.now() - ROSTER_MAX_AGE_MS - 1000).toISOString(),
      lastAttemptAt: null,
      pagesFetched: 1,
      syncedCount: 1,
      expectedCount: 1,
      lastError: null,
    }));
    const swept = await reconcileRosters([fresh, missing, stale], {
      budget: 1,
    });
    expect(swept).toBe(1);
    // A guild with no copy at all is never skipped by the budget logic.
    f.state.mockResolvedValue({
      guildId: "missing",
      status: "never",
      startedAt: null,
      completedAt: null,
      lastAttemptAt: null,
      pagesFetched: 0,
      syncedCount: 0,
      expectedCount: 0,
      lastError: null,
    });
    expect(await reconcileRosters([missing], { budget: 5 })).toBe(1);
    expect(f.save).toHaveBeenCalled();
  });
});

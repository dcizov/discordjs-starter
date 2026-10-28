/**
 * The member directory's avatars, through the real route handler.
 *
 * On a real 61-member server every row rendered initials — including the bot —
 * while the XP leaderboard on the same server rendered a real picture. The
 * hashes were in the database the whole time; nothing needed re-syncing. The
 * directory simply never derived a URL from them:
 *
 * - `apps/web/app/api/[...path]/route.ts` returned `listMembers()` unchanged;
 * - `listMembers` returns the `avatar` / `guildAvatar` **hashes** and no URL;
 * - `Member.avatarUrl` is *optional*, so the missing field type-checked and
 *   `IdentityCell` fell back to initials without a word.
 *
 * These tests run the actual exported handler with a fake store that returns
 * hashes, and assert on the JSON the browser would receive. They are the
 * reason the fix is a required `avatarUrl` on the wire type rather than a
 * comment: a response that forgets the derivation cannot compile, and this
 * file fails if it somehow does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  limit: vi.fn(),
  listMembers: vi.fn(),
  getRosterSync: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authorize: deps.authorize,
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  },
}));
// The route derives URLs through `@/lib/member-wire`, which is left real:
// that derivation is the thing under test.
vi.mock("@/lib/security", () => ({
  assertOrigin: vi.fn(),
  rateLimit: deps.limit,
  body: (req: Request) => req.json(),
}));
vi.mock("@/lib/dashboard", () => ({
  loadDashboard: vi.fn(),
  withAuditAvatarUrl: (row: unknown) => row,
}));
vi.mock("@orbit/db", () => ({
  listMembers: deps.listMembers,
  getRosterSync: deps.getRosterSync,
  getOwnEconomyHistory: vi.fn(),
}));
vi.mock("@orbit/db/src/news-preview", () => ({ previewNewsRouting: vi.fn() }));
vi.mock("@orbit/db/src/community-demo", () => ({
  simulateCommunityAction: vi.fn(),
}));
vi.mock("@orbit/core/queue", () => ({
  enqueueAction: vi.fn(),
  createQueue: vi.fn(),
}));

import { GET } from "../apps/web/app/api/[...path]/route";

const GUILD = "120000000000000001";
const USER = "120000000000000099";

/** A 32-hex Discord avatar hash, as the gateway delivers it. */
const HASH = "a".repeat(32);
/** A guild-specific avatar hash — a different URL shape entirely. */
const GUILD_HASH = "b".repeat(32);

function member(overrides: Record<string, unknown> = {}) {
  return {
    guildId: GUILD,
    userId: USER,
    username: "jamie.davis",
    globalName: "Jamie Davis",
    nickname: "Jamie",
    displayName: "Jamie",
    avatar: null,
    guildAvatar: null,
    bot: false,
    joinedAt: "2025-01-01T00:00:00.000Z",
    roles: [],
    present: true,
    syncedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(rows: unknown[]) {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 25,
    sync: {
      guildId: GUILD,
      status: "complete",
      startedAt: null,
      completedAt: null,
      lastAttemptAt: null,
      pagesFetched: 1,
      syncedCount: rows.length,
      expectedCount: rows.length,
      lastError: null,
    },
    counts: {
      guildMemberCount: rows.length,
      syncedMembers: rows.length,
      present: rows.length,
      departed: 0,
      humans: rows.length,
      bots: 0,
    },
  };
}

async function fetchRoster(rows: unknown[]) {
  deps.listMembers.mockResolvedValue(page(rows));
  const response = await GET(
    new Request(`http://localhost:3000/api/guilds/${GUILD}/members`, {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    }),
    { params: Promise.resolve({ path: ["guilds", GUILD, "members"] }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    rows: { userId: string; avatarUrl: string | null }[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Live mode: the demo illustration short-circuit must not be in play.
  vi.stubEnv("DEMO_MODE", "false");
  deps.authorize.mockResolvedValue({
    user: { id: USER, name: "Manager" },
    guild: { installed: true },
  });
  deps.limit.mockResolvedValue(undefined);
  deps.getRosterSync.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /guilds/:id/members derives avatar URLs", () => {
  it("turns a global avatar hash into a CDN URL", async () => {
    const body = await fetchRoster([member({ avatar: HASH })]);
    expect(body.rows[0].avatarUrl).toBe(
      `https://cdn.discordapp.com/avatars/${USER}/${HASH}.webp?size=128`
    );
  });

  it("prefers the guild avatar, which lives at a different path", async () => {
    const body = await fetchRoster([
      member({ avatar: HASH, guildAvatar: GUILD_HASH }),
    ]);
    // Passing a guild-avatar hash to the global builder produces a 404, so
    // the precedence has to be right, not just present.
    expect(body.rows[0].avatarUrl).toBe(
      `https://cdn.discordapp.com/guilds/${GUILD}/users/${USER}/avatars/${GUILD_HASH}.webp?size=128`
    );
  });

  it("sends null for a member with no avatar, rather than omitting the field", async () => {
    const body = await fetchRoster([member({ avatar: null })]);
    expect(body.rows[0].avatarUrl).toBeNull();
    // Required on the wire: the key must exist even when the value is null,
    // or the client cannot tell "no avatar" from "never derived".
    expect("avatarUrl" in body.rows[0]).toBe(true);
  });

  it("rejects a hash that is not a Discord hash instead of building a junk URL", async () => {
    const body = await fetchRoster([member({ avatar: "not-a-hash" })]);
    expect(body.rows[0].avatarUrl).toBeNull();
  });

  it("gives every row a URL, including bots", async () => {
    // The reported symptom was that all 61 rows fell back to initials, the
    // bot included.
    const body = await fetchRoster([
      member({ userId: "120000000000000401", avatar: HASH }),
      member({
        userId: "120000000000000411",
        avatar: GUILD_HASH,
        guildAvatar: GUILD_HASH,
        bot: true,
        username: "orbit",
        globalName: "Orbit",
        nickname: null,
        displayName: "Orbit",
      }),
      member({ userId: "120000000000000402", avatar: null }),
    ]);
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0].avatarUrl).toContain(`/avatars/120000000000000401/`);
    expect(body.rows[1].avatarUrl).toContain(`/avatars/${GUILD_HASH}`);
    // The row with no avatar is honestly null, and still carries the key.
    expect(body.rows[2].avatarUrl).toBeNull();
    expect("avatarUrl" in body.rows[2]).toBe(true);
  });
});

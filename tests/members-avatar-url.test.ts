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
import { defaultAvatarUrl } from "../apps/web/lib/discord-images";

const GUILD = "120000000000000001";
const USER = "120000000000000099";

/** A 32-hex Discord avatar hash, as the gateway delivers it. */
const HASH = "a".repeat(32);
/** A guild-specific avatar hash — a different URL shape entirely. */
const GUILD_HASH = "b".repeat(32);

/**
 * Discord's default-avatar index for a snowflake, computed here so the
 * expectation is independent of the implementation.
 *
 * `Number(BigInt(id) >> 22n) % 6` is what `@discordjs/rest`'s
 * `calculateUserDefaultAvatarIndex` does, which is what discord.js's
 * `User#defaultAvatarURL` calls. Deliberately restated rather than imported,
 * so a change in the app's copy of the arithmetic fails the test instead of
 * silently agreeing with itself.
 */
const defaultIndex = (userId: string) => Number(BigInt(userId) >> 22n) % 6;

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

  it("falls back to Discord's default avatar when no hash is recorded", async () => {
    // The half that shipped as null: most of a real server has never uploaded
    // an avatar, and each of those members was drawn as two initials.
    const body = await fetchRoster([member({ avatar: null })]);
    expect(body.rows[0].avatarUrl).toBe(
      `https://cdn.discordapp.com/embed/avatars/${defaultIndex(USER)}.png`
    );
    // Required on the wire: the key must exist, or the client cannot tell
    // "no avatar" from "never derived".
    expect("avatarUrl" in body.rows[0]).toBe(true);
  });

  it("derives the default index from the snowflake, exactly as discord.js does", async () => {
    // One id per index. If the arithmetic were wrong in a way that happened
    // to produce 0, a single-id test would not notice.
    const ids = [
      "120000000000000000",
      "120000000004194304",
      "120000000008388608",
      "120000000012582912",
      "120000000016777216",
      "120000000020971520",
    ];
    const body = await fetchRoster(
      ids.map((userId) => member({ userId, avatar: null }))
    );
    expect(body.rows.map((r) => r.avatarUrl)).toEqual(
      ids.map(
        (userId) =>
          `https://cdn.discordapp.com/embed/avatars/${defaultIndex(userId)}.png`
      )
    );
    // And the indices really are all six, in order.
    expect(ids.map(defaultIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  /*
   * The legacy branch, tested against the helper rather than the route.
   *
   * The roster stores no discriminator — Discord retired them for new
   * accounts — so the route can only ever reach the snowflake branch. The
   * `discriminator % 5` rule still has to be right for an old account whose
   * discriminator we do hold, which is why it is implemented and tested here
   * rather than deleted as unreachable.
   */
  it("uses the discriminator for a legacy account instead", () => {
    // 1234 % 5 === 4, and the snowflake branch would have given 0.
    expect(defaultAvatarUrl("120000000000000401", "1234")).toBe(
      "https://cdn.discordapp.com/embed/avatars/4.png"
    );
    // "0" and "0000" mean "no discriminator", so they fall back to the id.
    expect(defaultAvatarUrl("120000000000000401", "0")).toBe(
      defaultAvatarUrl("120000000000000401")
    );
    // Anything that is not a 1-4 digit number is not a discriminator.
    expect(defaultAvatarUrl("120000000000000401", "wat")).toBe(
      defaultAvatarUrl("120000000000000401")
    );
  });

  it("rejects a hash that is not a Discord hash instead of building a junk URL", async () => {
    const body = await fetchRoster([member({ avatar: "not-a-hash" })]);
    // Not turned into `/avatars/<id>/not-a-hash.webp`, which would 404. It
    // falls through to the default, which always resolves.
    expect(body.rows[0].avatarUrl).toBe(
      `https://cdn.discordapp.com/embed/avatars/${defaultIndex(USER)}.png`
    );
  });

  it("gives every row a URL, including the bot", async () => {
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
    // The bot with no recorded hash gets its default, not initials.
    expect(body.rows[2].avatarUrl).toBe(
      `https://cdn.discordapp.com/embed/avatars/${defaultIndex("120000000000000402")}.png`
    );
    // Not one row is null.
    expect(body.rows.every((r) => typeof r.avatarUrl === "string")).toBe(true);
  });

  it("leaves null only for an id that is not a snowflake", async () => {
    const body = await fetchRoster([member({ userId: "not-a-snowflake" })]);
    expect(body.rows[0].avatarUrl).toBeNull();
    expect("avatarUrl" in body.rows[0]).toBe(true);
  });
});

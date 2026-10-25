import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@orbit/core";
import type { Guild, MusicState } from "@orbit/core";
const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  dashboard: vi.fn(),
  account: vi.fn(),
  activity: vi.fn(),
  posts: vi.fn(),
  history: vi.fn(),
}));
vi.mock("server-only", () => ({}));
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
vi.mock("@orbit/db", () => ({
  getDashboardData: deps.dashboard,
  getAccount: deps.account,
  activityCounts: deps.activity,
  listCommunityPosts: deps.posts,
  getOwnEconomyHistory: deps.history,
  emptyMusic: () => music,
}));
import { loadDashboard } from "../apps/web/lib/dashboard";
import { HttpError } from "../apps/web/lib/auth";
const gid = "120000000000000001";
const uid = "120000000000000099";
const avatar = "a_0123456789abcdef0123456789abcdef";
const icon = "fedcba9876543210fedcba9876543210";
const music: MusicState = {
  current: null,
  tracks: [],
  paused: false,
  volume: 65,
  repeat: "off",
  position: 0,
  updatedAt: "2026-10-25T00:00:00Z",
};
const guild: Guild = {
  id: gid,
  name: "Current community",
  icon,
  installed: true,
  memberCount: 3,
  config: defaultConfig,
  roles: [],
  channels: [],
  botRolePosition: 0,
  updatedAt: "2026-10-25T00:00:00Z",
};
function authorization(): Awaited<
  ReturnType<typeof import("../apps/web/lib/auth").authorize>
> {
  return {
    user: {
      id: uid,
      name: "Global display name",
      avatar,
      accessToken: "test-only-access-token",
      sessionId: "test-only-session",
    },
    guild: { id: gid, name: guild.name, icon, installed: true },
    guilds: [{ id: gid, name: guild.name, icon, installed: true }],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.authorize.mockResolvedValue(authorization());
  deps.dashboard.mockResolvedValue({
    guild,
    resources: [],
    audit: [],
    ledger: [],
    accounts: [],
    deliveries: [],
    music,
    health: [],
    demo: false,
  });
  deps.account.mockResolvedValue(null);
  deps.activity.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
describe("dashboard identity projection and tenant boundary", () => {
  it("retains upstream icon/avatar metadata but never serializes session/token fields", async () => {
    const result = await loadDashboard(gid);
    expect(result.user).toMatchObject({
      id: uid,
      name: "Global display name",
      avatar,
    });
    expect(result.guild.icon).toBe(icon);
    expect(result.guilds[0].icon).toBe(icon);
    expect(result.guild.iconUrl).toBe(
      `https://cdn.discordapp.com/icons/${gid}/${icon}.webp?size=128`
    );
    expect(result.user.avatarUrl).toBe(
      `https://cdn.discordapp.com/avatars/${uid}/${avatar}.webp?size=128`
    );
    expect(result.guilds[0].iconUrl).toBe(result.guild.iconUrl);
    expect(Object.keys(result.user)).not.toContain("accessToken");
    expect(JSON.stringify(result)).not.toContain("test-only-access-token");
    expect(JSON.stringify(result)).not.toContain("test-only-session");
    expect(deps.account).toHaveBeenCalledWith(gid, uid);
  });
  it("keeps legitimate absent images null", async () => {
    const auth = authorization();
    auth.user.avatar = null;
    auth.guild.icon = null;
    auth.guilds[0].icon = null;
    deps.authorize.mockResolvedValue(auth);
    deps.dashboard.mockResolvedValue({
      guild: { ...guild, icon: null },
      resources: [],
      audit: [],
      ledger: [],
      accounts: [],
      deliveries: [],
      music,
      health: [],
      demo: false,
    });
    const result = await loadDashboard(gid);
    expect(result.user.avatar).toBeNull();
    expect(result.user.avatarUrl).toBeNull();
    expect(result.guild.iconUrl).toBeNull();
    expect(result.guild.icon).toBeNull();
    expect(result.guilds[0].icon).toBeNull();
  });
  it("denies foreign access before loading any tenant data", async () => {
    deps.authorize.mockRejectedValue(new HttpError(403, "Forbidden"));
    await expect(loadDashboard("990000000000000999")).rejects.toMatchObject({
      status: 403,
    });
    expect(deps.dashboard).not.toHaveBeenCalled();
    expect(deps.account).not.toHaveBeenCalled();
  });
  it("rejects a mismatched preauthorized guild rather than trusting its metadata", async () => {
    await expect(
      loadDashboard("990000000000000999", authorization())
    ).rejects.toMatchObject({ status: 403 });
    expect(deps.dashboard).not.toHaveBeenCalled();
  });
  it("loads an invite-only server without querying its private stored data", async () => {
    const auth = authorization();
    auth.guild.installed = false;
    auth.guilds[0].installed = false;
    deps.authorize.mockResolvedValue(auth);
    const result = await loadDashboard(gid);
    expect(result.guild.installed).toBe(false);
    expect(result.health).toEqual([]);
    expect(deps.dashboard).not.toHaveBeenCalled();
    expect(deps.account).not.toHaveBeenCalled();
  });
});

it("refreshes the selected name/icon from authorized OAuth metadata instead of a stale bot snapshot", async () => {
  const auth = authorization();
  auth.guild.name = "Renamed community";
  auth.guild.icon = null;
  auth.guilds[0] = auth.guild;
  deps.authorize.mockResolvedValue(auth);
  const result = await loadDashboard(gid);
  expect(result.guild).toMatchObject({
    name: "Renamed community",
    icon: null,
    iconUrl: null,
  });
  expect(result.guilds[0]).toMatchObject({
    name: "Renamed community",
    icon: null,
    iconUrl: null,
  });
  expect(result.guild.memberCount).toBe(guild.memberCount);
  expect(result.guild.config).toEqual(guild.config);
});

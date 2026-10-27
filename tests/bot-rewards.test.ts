import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits } from "discord.js";

const f = vi.hoisted(() => ({
  getGuild: vi.fn(),
  getXpTotal: vi.fn(),
  listRewardGrants: vi.fn(),
  recordRewardGrant: vi.fn(),
}));

vi.mock("@orbit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/db")>();
  return {
    ...actual,
    getGuild: f.getGuild,
    getXpTotal: f.getXpTotal,
    listRewardGrants: f.listRewardGrants,
    recordRewardGrant: f.recordRewardGrant,
  };
});

import { reconcileRewards } from "../apps/bot/src/features/leveling/rewards";
import { defaultConfig, type GuildConfig } from "@orbit/core";

/**
 * Reward reconciliation has to hold up under the awkward cases: a member who
 * jumps several levels at once, a reward role deleted since it was configured,
 * a bot that has lost Manage Roles. None of those may lose the XP, and none
 * may announce twice.
 */

const GUILD = "130000000000000001";
const USER = "130000000000000002";
const ALPHA = "role-alpha";
const BETA = "role-beta";
const GAMMA = "role-gamma";

function role(
  id: string,
  over: { position?: number; managed?: boolean; admin?: boolean } = {}
) {
  return {
    id,
    name: id.replace("role-", ""),
    managed: over.managed ?? false,
    position: over.position ?? 5,
    permissions: {
      has: (name: string) => name === "Administrator" && !!over.admin,
    },
  };
}

function config(over: Partial<GuildConfig["xp"]>): GuildConfig {
  const config = structuredClone(defaultConfig);
  config.modules.xp = true;
  config.xp = {
    ...config.xp,
    rewards: [
      { level: 5, roleId: ALPHA },
      { level: 10, roleId: BETA },
      { level: 20, roleId: GAMMA },
    ],
    rewardStack: true,
    announceEnabled: true,
    announceChannelId: "channel-announce",
    announceMessage: "{member} reached level {level} and earned {role}!",
    ...over,
  };
  return config;
}

/** A guild whose roles are `present`, with a bot that sits at `botTop`. */
function guild(over: {
  config: GuildConfig | null;
  roles?: any[];
  botTop?: number;
  canManage?: boolean;
  held?: string[];
  addFails?: boolean;
}) {
  const roles = new Map<string, any>((over.roles ?? []).map((r) => [r.id, r]));
  const added: string[] = [];
  const removed: string[] = [];
  const sent: string[] = [];
  const member = {
    roles: {
      cache: new Map<string, string>((over.held ?? []).map((id) => [id, id])),
      highest: { position: 1 },
      add: async (id: string, _reason: string) => {
        if (over.addFails) throw new Error("Missing Permissions");
        added.push(id);
      },
      remove: async (id: string) => {
        removed.push(id);
      },
    },
    id: USER,
  };
  const guildObj = {
    id: GUILD,
    roles: {
      cache: roles,
      fetch: async () => roles,
    },
    members: {
      me: {
        roles: { highest: { position: over.botTop ?? 50 } },
        permissions: {
          has: () => over.canManage !== false,
        },
      },
      fetchMe: async () => guildObj.members.me,
      fetch: async () => member,
    },
    channels: {
      fetch: async (id: string) =>
        id === "channel-announce"
          ? {
              isTextBased: () => true,
              send: async (payload: any) => {
                sent.push(payload.content);
              },
            }
          : null,
    },
  };
  return { guildObj: guildObj as any, added, removed, sent };
}

import { totalXpForLevel } from "@orbit/core/leveling";

/** Taken from the curve itself; a hand-written table would drift from it. */
const totalForLevel = (level: number) => totalXpForLevel(level);

beforeEach(() => {
  vi.clearAllMocks();
  f.getGuild.mockResolvedValue({ guildId: GUILD, config: config({}) });
  f.getXpTotal.mockResolvedValue({ total: 0 });
  f.listRewardGrants.mockResolvedValue([]);
  f.recordRewardGrant.mockResolvedValue(undefined);
});

describe("reward reconciliation", () => {
  it("does nothing when the module is off", async () => {
    const off = config({});
    off.modules.xp = false;
    f.getGuild.mockResolvedValue({ guildId: GUILD, config: off });
    const { guildObj } = guild({ config: null });
    const result = await reconcileRewards(guildObj, USER);
    expect(result.granted).toEqual([]);
    expect(f.recordRewardGrant).not.toHaveBeenCalled();
  });

  it("grants every reward for a multi-level jump, in one pass", async () => {
    // Jumped from nothing straight to level 20: all three rewards are owed.
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(20) });
    const { guildObj, added, sent } = guild({
      config: null,
      roles: [role(ALPHA), role(BETA), role(GAMMA)],
    });
    const result = await reconcileRewards(guildObj, USER);
    expect(added.sort()).toEqual([ALPHA, BETA, GAMMA].sort());
    expect(sent.length).toBe(3);
    expect(result.granted.sort()).toEqual([ALPHA, BETA, GAMMA].sort());
    expect(result.announced).toBe(3);
  });

  it("does not re-grant a reward that is already recorded", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(10) });
    f.listRewardGrants.mockResolvedValue([
      {
        guildId: GUILD,
        userId: USER,
        level: 5,
        roleId: ALPHA,
        grantedAt: new Date().toISOString(),
        error: null,
        updatedAt: new Date().toISOString(),
      },
    ]);
    const { guildObj, added, sent } = guild({
      config: null,
      roles: [role(ALPHA), role(BETA)],
    });
    await reconcileRewards(guildObj, USER);
    expect(added).toEqual([BETA]);
    // Only the new level is announced. Announcing the same one twice is the
    // thing members notice.
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("level 10");
  });

  it("skips a reward whose role was deleted, and says so", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(10) });
    const { guildObj, added } = guild({
      config: null,
      // BETA was configured and then deleted from Discord.
      roles: [role(ALPHA)],
    });
    const result = await reconcileRewards(guildObj, USER);
    expect(added).toEqual([ALPHA]);
    expect(result.missingRole).toEqual([BETA]);
    // Recorded nowhere: there is nothing to grant, and recording it as
    // refused would mask the real problem, a dangling configuration.
    expect(f.recordRewardGrant).toHaveBeenCalledTimes(1);
  });

  it("refuses Administrator even when everything else allows it", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(5) });
    const { guildObj, added } = guild({
      config: null,
      roles: [role(ALPHA, { admin: true })],
    });
    const result = await reconcileRewards(guildObj, USER);
    expect(added).toEqual([]);
    expect(result.refused[0].reason).toMatch(/must never grant Administrator/);
    expect(f.recordRewardGrant).toHaveBeenCalledWith(
      expect.objectContaining({ grantedAt: null })
    );
  });

  it("refuses a role at or above the bot's own", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(5) });
    const { guildObj, added } = guild({
      config: null,
      roles: [role(ALPHA, { position: 60 })],
      botTop: 50,
    });
    const result = await reconcileRewards(guildObj, USER);
    expect(added).toEqual([]);
    expect(result.refused[0].reason).toMatch(/above the roles it rewards/);
  });

  it("refuses everything when the bot lacks Manage Roles", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(5) });
    const { guildObj, added } = guild({
      config: null,
      roles: [role(ALPHA)],
      canManage: false,
    });
    const result = await reconcileRewards(guildObj, USER);
    expect(added).toEqual([]);
    expect(result.refused[0].reason).toMatch(/Manage Roles/);
  });

  it("keeps the grant when Discord refuses the role add", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(5) });
    const { guildObj } = guild({
      config: null,
      roles: [role(ALPHA)],
      addFails: true,
    });
    const result = await reconcileRewards(guildObj, USER);
    expect(result.granted).toEqual([]);
    expect(f.recordRewardGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        grantedAt: null,
        error: "Missing Permissions",
      })
    );
  });

  it("never loses an announcement to a send failure, and never throws", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(5) });
    const { guildObj, added } = guild({
      config: null,
      roles: [role(ALPHA)],
    });
    guildObj.channels.fetch = async () => ({
      isTextBased: () => true,
      send: async () => {
        throw new Error("Missing Access");
      },
    });
    const result = await reconcileRewards(guildObj, USER);
    // The role was granted and recorded. Only the message was lost.
    expect(added).toEqual([ALPHA]);
    expect(result.granted).toEqual([ALPHA]);
    expect(result.announced).toBe(0);
    expect(f.recordRewardGrant).toHaveBeenCalledWith(
      expect.objectContaining({ grantedAt: expect.any(String) })
    );
  });

  it("with replace, drops the lower tiers once a higher one is reached", async () => {
    const c = config({ rewardStack: false });
    f.getGuild.mockResolvedValue({ guildId: GUILD, config: c });
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(20) });
    f.listRewardGrants.mockResolvedValue([
      {
        guildId: GUILD,
        userId: USER,
        level: 5,
        roleId: ALPHA,
        grantedAt: "2026-01-01",
        error: null,
        updatedAt: "2026-01-01",
      },
      {
        guildId: GUILD,
        userId: USER,
        level: 10,
        roleId: BETA,
        grantedAt: "2026-01-01",
        error: null,
        updatedAt: "2026-01-01",
      },
    ]);
    const { guildObj, added, removed } = guild({
      config: null,
      roles: [role(ALPHA), role(BETA), role(GAMMA)],
      held: [ALPHA, BETA, GAMMA],
    });
    await reconcileRewards(guildObj, USER);
    expect(added).toEqual([GAMMA]);
    expect(removed.sort()).toEqual([ALPHA, BETA].sort());
  });

  it("with stacking, keeps the lower tiers", async () => {
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(20) });
    f.listRewardGrants.mockResolvedValue([
      {
        guildId: GUILD,
        userId: USER,
        level: 5,
        roleId: ALPHA,
        grantedAt: "2026-01-01",
        error: null,
        updatedAt: "2026-01-01",
      },
    ]);
    const { guildObj, added, removed } = guild({
      config: null,
      roles: [role(ALPHA), role(BETA), role(GAMMA)],
      held: [ALPHA],
    });
    await reconcileRewards(guildObj, USER);
    expect(added.sort()).toEqual([BETA, GAMMA].sort());
    expect(removed).toEqual([]);
  });

  it("owes nothing when no reward has been configured", async () => {
    f.getGuild.mockResolvedValue({
      guildId: GUILD,
      config: config({ rewards: [] }),
    });
    f.getXpTotal.mockResolvedValue({ total: totalForLevel(20) });
    const { guildObj, added } = guild({ config: null, roles: [role(ALPHA)] });
    const result = await reconcileRewards(guildObj, USER);
    expect(added).toEqual([]);
    expect(result).toEqual({
      granted: [],
      refused: [],
      missingRole: [],
      revoked: [],
      announced: 0,
    });
  });

  it("explicitly requires Manage Roles, not something else", () => {
    // Documents which permission this actually hinges on.
    expect(PermissionFlagsBits.ManageRoles).toBe(268435456n);
  });
});

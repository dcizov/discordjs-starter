import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import type { CommandContext } from "../apps/bot/src/commands/context";

const f = vi.hoisted(() => ({
  awardXp: vi.fn(),
  getXpTotal: vi.fn(),
  listXpLeaderboard: vi.fn(),
  audit: vi.fn(),
}));

// The db package re-exports leveling from its index, so one mock covers both.
vi.mock("@orbit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/db")>();
  return {
    ...actual,
    awardXp: f.awardXp,
    getXpTotal: f.getXpTotal,
    listXpLeaderboard: f.listXpLeaderboard,
    audit: f.audit,
  };
});

import { levelingCommand } from "../apps/bot/src/commands/leveling";
import { defaultConfig } from "@orbit/core";

/**
 * The interesting thing about `/xp` is that it changes a member's standing, so
 * the authorization has to be re-checked server-side. Discord's
 * `defaultMemberPermissions` only hides a command in the client; it does not
 * stop a hand-crafted interaction from arriving.
 */

const GUILD = "120000000000000001";
const ACTOR = "120000000000000002";
const TARGET = "120000000000000003";

function context(over: {
  name: string;
  options?: Record<string, any>;
  permissions?: bigint;
  xpModule?: boolean;
}) {
  const reply = vi.fn(async () => undefined);
  const config = structuredClone(defaultConfig);
  config.modules.xp = over.xpModule !== false;
  const member = {
    id: ACTOR,
    displayName: "Ada",
    user: { username: "ada", avatar: null },
    avatar: null,
    permissions: { has: (bit: bigint) => (over.permissions ?? 0n) === bit },
  };
  const ctx = {
    i: {
      id: "interaction-1",
      commandName: over.name,
      user: { id: ACTOR, bot: false },
      options: {
        getUser: (key: string, required?: boolean) =>
          over.options?.[key] ??
          (required ? undefined : { id: ACTOR, bot: false }),
        getInteger: (key: string) => over.options?.[key] ?? null,
        getSubcommand: () => over.options?._sub,
      },
    },
    guild: {
      id: GUILD,
      members: { cache: new Map() },
    },
    member,
    config,
    reply,
  } as unknown as CommandContext;
  return { ctx, reply };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.getXpTotal.mockResolvedValue({
    guildId: GUILD,
    userId: TARGET,
    total: 0,
    messageXp: 0,
    voiceXp: 0,
    adjustedXp: 0,
    lastMessageAt: null,
    lastMessageHash: null,
    updatedAt: new Date().toISOString(),
  });
});

describe("/rank", () => {
  it("shows the level, the progress and the two different XP numbers", async () => {
    f.getXpTotal.mockResolvedValue({
      guildId: GUILD,
      userId: TARGET,
      total: 177,
      messageXp: 120,
      voiceXp: 57,
      adjustedXp: 0,
      lastMessageAt: null,
      lastMessageHash: null,
      updatedAt: new Date().toISOString(),
    });
    const { ctx, reply } = context({ name: "rank" });
    await levelingCommand(ctx);
    const card = (reply.mock.calls as any[][])[0][0] as any;
    expect(card.title).toContain("level 1");
    // The two numbers everyone confuses: total to arrive here, and the cost of
    // the next level. Both are shown, and they are different.
    expect(card.description).toContain("has cost 100 XP in total");
    expect(card.description).toContain("next level costs 155");
    expect(card.description).toContain("from messages");
  });

  it("refuses when the module is off", async () => {
    const { ctx } = context({ name: "rank", xpModule: false });
    await expect(levelingCommand(ctx)).rejects.toThrow(/paused/);
  });
});

describe("/levels", () => {
  it("says something useful when nobody has earned anything", async () => {
    f.listXpLeaderboard.mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const { ctx, reply } = context({ name: "levels" });
    await levelingCommand(ctx);
    const card = (reply.mock.calls as any[][])[0][0] as any;
    expect(card.description).toMatch(/Nobody has earned XP/);
  });

  it("asks the storage for the page it was given", async () => {
    f.listXpLeaderboard.mockResolvedValue({
      rows: [
        {
          guildId: GUILD,
          userId: TARGET,
          total: 500,
          messageXp: 0,
          voiceXp: 0,
          adjustedXp: 0,
          lastMessageAt: null,
          lastMessageHash: null,
          updatedAt: new Date().toISOString(),
          level: 2,
          into: 0,
          needed: 220,
          rank: 1,
        },
      ],
      total: 1,
      page: 3,
      pageSize: 10,
    });
    const { ctx, reply } = context({ name: "levels", options: { page: 3 } });
    await levelingCommand(ctx);
    expect(f.listXpLeaderboard).toHaveBeenCalledWith(GUILD, {
      page: 3,
      pageSize: 10,
    });
    expect(((reply.mock.calls as any[][])[0][0] as any).title).toContain(
      "page 3 of 1"
    );
  });
});

describe("/xp authorization", () => {
  const adjust = (over: Record<string, any>) =>
    context({
      name: "xp",
      permissions: PermissionFlagsBits.ManageGuild,
      options: { member: { id: TARGET, bot: false }, ...over },
    });

  it("refuses an actor without Manage Server", async () => {
    // Discord's defaultMemberPermissions is only a client hint; the bot
    // re-checks. A hand-crafted interaction must not get through.
    const { ctx, reply } = context({
      name: "xp",
      permissions: 0n,
      options: { member: { id: TARGET, bot: false }, _sub: "give", amount: 50 },
    });
    await expect(levelingCommand(ctx)).rejects.toThrow(/Manage Server/);
    expect(reply).not.toHaveBeenCalled();
    expect(f.awardXp).not.toHaveBeenCalled();
  });

  it("refuses to adjust a bot", async () => {
    const { ctx } = context({
      name: "xp",
      permissions: PermissionFlagsBits.ManageGuild,
      options: { member: { id: TARGET, bot: true }, _sub: "give", amount: 50 },
    });
    await expect(levelingCommand(ctx)).rejects.toThrow(/Bots do not take part/);
    expect(f.awardXp).not.toHaveBeenCalled();
  });

  it("adds XP and audits who did it", async () => {
    f.awardXp.mockResolvedValue({
      applied: true,
      total: 50,
      level: 0,
      previousLevel: 0,
      leveledUp: false,
      levelsGained: 0,
    });
    const { ctx, reply } = adjust({ _sub: "give", amount: 50 });
    await levelingCommand(ctx);
    expect(f.awardXp).toHaveBeenCalledWith(
      GUILD,
      TARGET,
      expect.objectContaining({ kind: "adjust", amount: 50 })
    );
    expect(f.audit).toHaveBeenCalledOnce();
    // The audit names the actor, the target and the change.
    const detail = (f.audit.mock.calls as any[][])[0][4] as string;
    expect(detail).toContain("+50 XP");
    expect(detail).toContain(TARGET);
    expect(reply).toHaveBeenCalled();
  });

  it("removes XP as a negative adjustment", async () => {
    f.awardXp.mockResolvedValue({
      applied: true,
      total: 20,
      level: 0,
      previousLevel: 0,
      leveledUp: false,
      levelsGained: 0,
    });
    const { ctx } = adjust({ _sub: "take", amount: 30 });
    await levelingCommand(ctx);
    expect(f.awardXp).toHaveBeenCalledWith(
      GUILD,
      TARGET,
      expect.objectContaining({ amount: -30 })
    );
  });

  it("treats `set` as the difference to the current total", async () => {
    f.getXpTotal.mockResolvedValue({
      guildId: GUILD,
      userId: TARGET,
      total: 400,
      messageXp: 400,
      voiceXp: 0,
      adjustedXp: 0,
      lastMessageAt: null,
      lastMessageHash: null,
      updatedAt: new Date().toISOString(),
    });
    f.awardXp.mockResolvedValue({
      applied: true,
      total: 1000,
      level: 3,
      previousLevel: 1,
      leveledUp: true,
      levelsGained: 2,
    });
    const { ctx, reply } = adjust({ _sub: "set", total: 1000 });
    await levelingCommand(ctx);
    // Setting 1000 when the member has 400 is a +600 adjustment, not an
    // assignment of 1000 on top.
    expect(f.awardXp).toHaveBeenCalledWith(
      GUILD,
      TARGET,
      expect.objectContaining({ amount: 600 })
    );
    expect(((reply.mock.calls as any[][])[0][0] as any).description).toContain(
      "crossed 2 levels"
    );
  });

  it("keys the adjustment on the interaction so a retry cannot double it", async () => {
    f.awardXp.mockResolvedValue({
      applied: true,
      total: 50,
      level: 0,
      previousLevel: 0,
      leveledUp: false,
      levelsGained: 0,
    });
    const { ctx } = adjust({ _sub: "give", amount: 50 });
    await levelingCommand(ctx);
    const call = ((f.awardXp.mock.calls as any[][])[0] as any[])[2];
    expect(call.key).toBe("adjust:interaction-1");
  });

  it("does nothing when the adjustment would change nothing", async () => {
    f.getXpTotal.mockResolvedValue({
      guildId: GUILD,
      userId: TARGET,
      total: 500,
      messageXp: 0,
      voiceXp: 0,
      adjustedXp: 0,
      lastMessageAt: null,
      lastMessageHash: null,
      updatedAt: new Date().toISOString(),
    });
    const { ctx, reply } = adjust({ _sub: "set", total: 500 });
    await levelingCommand(ctx);
    expect(f.awardXp).not.toHaveBeenCalled();
    expect(((reply.mock.calls as any[][])[0][0] as any).title).toBe(
      "No change"
    );
  });
});

import type { Client, Interaction } from "discord.js";
import {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  PermissionFlagsBits,
} from "discord.js";
import { dealGameSelection } from "../apps/bot/src/deal-game-selection";
import { deal } from "./fixtures/deals";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicService } from "../apps/bot/src/music";

const db = vi.hoisted(() => ({
  audit: vi.fn(),
  database: vi.fn(),
  economyTransaction: vi.fn(),
  getDashboardData: vi.fn(),
  getGuild: vi.fn(),
  getAccount: vi.fn(),
  listResources: vi.fn(),
  recordCase: vi.fn(),
  saveResource: vi.fn(),
  schema: {},
}));
vi.mock("@orbit/db", () => db);
vi.mock("@orbit/core/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../apps/bot/src/moderation", () => ({
  moderate: vi.fn(),
  logCase: vi.fn(),
}));
vi.mock("../apps/bot/src/roles", () => ({
  handleRoleInteraction: vi.fn(),
  publishPanel: vi.fn(),
}));
vi.mock("../apps/bot/src/shop", () => ({ claimShopRole: vi.fn() }));
import { onInteraction } from "../apps/bot/src/interactions";

const guildId = "120000000000000001";
const memberId = "120000000000000099";
function interaction(commandName: string) {
  const i = {
    id: "120000000000000100",
    type: 2,
    guildId,
    commandName,
    guild: {
      id: guildId,
      members: {
        fetch: vi.fn(async () => ({ id: memberId, displayName: "Member" })),
      },
    },
    user: { id: memberId, displayName: "Member" },
    isButton: () => false,
    isStringSelectMenu: () => false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isRepliable: () => true,
    deferred: false,
    replied: false,
    deferReply: vi.fn(async (_options: unknown) => {
      i.deferred = true;
    }),
    editReply: vi.fn(async (_options: any) => undefined),
    reply: vi.fn(async (_options: any) => undefined),
    options: {
      getString: vi.fn(() => null),
      getInteger: vi.fn(() => null),
      getUser: vi.fn(() => null),
    },
  };
  return i;
}
const music = {
  action: vi.fn(),
  state: vi.fn(() => ({
    tracks: [],
    current: null,
    paused: false,
    volume: 50,
    repeat: "off",
    position: 0,
    updatedAt: "2026-10-24T00:00:00Z",
  })),
};
const dispatch = (i: ReturnType<typeof interaction>) =>
  onInteraction(
    {} as Client,
    music as unknown as MusicService,
    i as unknown as Interaction
  );
const result = (i: ReturnType<typeof interaction>) =>
  EmbedBuilder.from(i.editReply.mock.calls[0][0].embeds[0]).toJSON();

beforeEach(() => {
  vi.clearAllMocks();
  db.getGuild.mockResolvedValue({
    config: {
      modules: { economy: true, music: true },
      economy: { symbol: "✦", currency: "Stardust" },
    },
  });
  db.economyTransaction.mockResolvedValue({ amount: 250, balance: 250 });
  db.getDashboardData.mockResolvedValue({
    accounts: [{ name: "Member", balance: 250 }],
  });
  db.audit.mockResolvedValue(undefined);
  music.action.mockResolvedValue({ queued: 0 });
});

describe("deal title autocomplete routing (no provider calls)", () => {
  function autocomplete(sub = "info", manager = true) {
    const base = interaction("deals");
    return {
      ...base,
      isAutocomplete: () => true,
      isChatInputCommand: () => false,
      memberPermissions: new PermissionsBitField(
        manager ? PermissionFlagsBits.ManageGuild : 0n
      ),
      options: {
        ...base.options,
        getFocused: () => ({ name: "game", value: "popular" }),
        getSubcommand: () => sub,
      },
      respond: vi.fn(async (_choices: unknown) => undefined),
    };
  }
  it("returns the user's scoped recent game titles, not panel/resource IDs", async () => {
    db.getGuild.mockResolvedValueOnce({ config: { modules: { deals: true } } });
    dealGameSelection.remember(guildId, memberId, [deal()]);
    const i = autocomplete();
    await dispatch(i);
    expect(i.respond).toHaveBeenCalledWith([
      { name: `${deal().game.title} (2020)`, value: deal().game.id },
    ]);
    expect(db.listResources).not.toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.guild.members.fetch).not.toHaveBeenCalled();
  });
  it("hides suggestions when deals are paused", async () => {
    db.getGuild.mockResolvedValueOnce({
      config: { modules: { deals: false } },
    });
    dealGameSelection.remember(guildId, memberId, [deal()]);
    const i = autocomplete();
    await dispatch(i);
    expect(i.respond).toHaveBeenCalledWith([]);
  });
  it("does not offer a manager-only watch action to members without Manage Server", async () => {
    db.getGuild.mockResolvedValueOnce({ config: { modules: { deals: true } } });
    dealGameSelection.remember(guildId, memberId, [deal()]);
    const i = autocomplete("watch", false);
    await dispatch(i);
    expect(i.respond).toHaveBeenCalledWith([]);
  });
  it("does not expose someone else's title history in the same guild", async () => {
    db.getGuild.mockResolvedValueOnce({ config: { modules: { deals: true } } });
    dealGameSelection.remember(guildId, memberId, [deal()]);
    const i = autocomplete();
    i.user = { id: "120000000000000098", displayName: "Someone else" };
    await dispatch(i);
    expect(i.respond).toHaveBeenCalledWith([]);
  });
});

describe("interaction reply wiring (no Discord login)", () => {
  it("sends an ephemeral daily embed after the existing scoped/idempotent economy transaction", async () => {
    const i = interaction("daily");
    await dispatch(i);
    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(db.economyTransaction).toHaveBeenCalledWith({
      guildId,
      userId: memberId,
      userName: "Member",
      type: "daily",
      key: `interaction-${i.id}`,
    });
    expect(result(i).title).toBe("✦ Daily reward claimed");
    expect(i.editReply.mock.calls[0][0]).toMatchObject({
      content: "",
      allowedMentions: { parse: [] },
    });
  });
  it.each(["play", "leaderboard"])(
    "acknowledges /%s before any slow member/database/backend lookup",
    async (command) => {
      const i = interaction(command);
      let release!: (value: any) => void;
      i.guild.members.fetch.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        })
      );
      const pending = dispatch(i);
      await Promise.resolve();
      expect(i.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(db.getGuild).not.toHaveBeenCalled();
      expect(music.action).not.toHaveBeenCalled();
      release({ id: memberId, displayName: "Member" });
      await pending;
      expect(i.editReply).toHaveBeenCalled();
    }
  );

  it("uses the new leaderboard/queue cards in the real handler", async () => {
    const board = interaction("leaderboard");
    await dispatch(board);
    expect(db.getDashboardData).toHaveBeenCalledWith(guildId);
    expect(result(board).description).toContain("🥇 Member");
    const queue = interaction("queue");
    await dispatch(queue);
    expect(music.state).toHaveBeenCalledWith(guildId);
    expect(result(queue).title).toBe("Listening room · queue");
  });
  it("does not execute economy mutations when the module is paused", async () => {
    db.getGuild.mockResolvedValueOnce({
      config: { modules: { economy: false } },
    });
    const i = interaction("daily");
    await dispatch(i);
    expect(db.economyTransaction).not.toHaveBeenCalled();
    expect(result(i).title).toBe("Could not complete /daily");
    expect(result(i).description).toContain("economy is paused");
  });
  it("audits the full sanitized music error, independently of the shorter fenced embed", async () => {
    music.action.mockRejectedValueOnce(
      new Error(
        `SoundCloud track lookup failed.\nBackend: Lavalink 4.2.2\n${"actual Java cause\n".repeat(350)}`
      )
    );
    const i = interaction("play");
    await dispatch(i);
    const stored = db.audit.mock.calls[0][4] as string;
    expect(stored).toContain("actual Java cause\nactual Java cause");
    expect(stored.length).toBeGreaterThan(5000);
    expect(db.audit.mock.calls[0].slice(0, 4)).toEqual([
      guildId,
      { id: memberId, name: "Member" },
      "failed",
      "music /play",
    ]);
    expect(result(i).description).toMatch(/```text\n[\s\S]*\n```$/);
    expect(result(i).description!.length).toBeLessThan(stored.length);
    expect(i.editReply.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });
  it("keeps the initial-error fallback ephemeral when deferring itself fails", async () => {
    const i = interaction("daily");
    i.deferReply.mockRejectedValueOnce(
      new Error("Unable to defer this request")
    );
    await dispatch(i);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.reply.mock.calls[0][0]).toMatchObject({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(
      EmbedBuilder.from(i.reply.mock.calls[0][0].embeds[0]).toJSON().title
    ).toBe("Could not complete /daily");
  });
});

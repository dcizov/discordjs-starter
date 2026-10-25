import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { dealSchema } from "../packages/core/src/config";
import { deal, gameId, policy } from "./fixtures/deals";
const db = vi.hoisted(() => ({
  getGuild: vi.fn(),
  listResources: vi.fn(),
  saveResource: vi.fn(),
}));
const api = vi.hoisted(() => ({
  searchGameDeals: vi.fn(),
  gameDealInfo: vi.fn(),
  pollDeals: vi.fn(),
}));
vi.mock("@orbit/db", () => db);
vi.mock("@orbit/core/deals", () => ({
  ...api,
  dealCountryCurrencies: { DE: "EUR", US: "USD" },
}));
import { handleDeals } from "../apps/bot/src/features/deals/commands";
const guildId = "120000000000000001",
  channelId = "120000000000000010",
  actorId = "120000000000000099";
function setup(sub: string, values: Record<string, any> = {}) {
  const channel = {
    id: channelId,
    name: "game-deals",
    type: ChannelType.GuildText,
    guild: { id: guildId },
    permissionsFor: () => ({ has: () => true }),
  };
  const member = {
    id: actorId,
    displayName: "Manager",
    permissions: { has: vi.fn(() => true) },
    guild: {
      id: guildId,
      channels: { fetch: vi.fn(async () => channel) },
      members: { fetchMe: vi.fn(async () => ({})) },
    },
  };
  const i = {
    options: {
      getSubcommand: () => sub,
      getString: (key: string) => values[key] ?? null,
      getInteger: (key: string) => values[key] ?? null,
      getNumber: (key: string) => values[key] ?? null,
      getChannel: () => ({ id: channelId }),
    },
    editReply: vi.fn(async (_input: unknown) => undefined),
  };
  return {
    i,
    member,
    channel,
    run: () =>
      handleDeals(
        i as unknown as ChatInputCommandInteraction,
        member as unknown as GuildMember
      ),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  db.getGuild.mockResolvedValue({ config: { modules: { deals: true } } });
  db.listResources.mockResolvedValue([]);
  db.saveResource.mockImplementation(
    async (_guild, _kind, data, _actor, id) => ({
      id: id ?? "new-feed",
      ...dealSchema.parse(data),
    })
  );
  api.searchGameDeals.mockResolvedValue([deal()]);
  api.gameDealInfo.mockResolvedValue(deal());
  api.pollDeals.mockResolvedValue([]);
});

describe("implemented deals command dispatch (no live Discord/ITAD)", () => {
  it("replaces the bare ID wall with real rich-card fields and purchase links", async () => {
    const t = setup("search", { query: "Test title" });
    await t.run();
    expect(api.searchGameDeals).toHaveBeenCalledWith("Test title", "DE", 3);
    const reply = t.i.editReply.mock.calls[0][0] as any;
    expect(reply.embeds[0].image.url).toBe(deal().game.image);
    expect(reply.embeds[0].thumbnail).toBeUndefined();
    expect(reply.embeds[0].author).toBeUndefined();
    expect(reply.components).toEqual([]);
    expect(
      reply.embeds[0].fields.find(
        (field: any) => field.name === "Current offer"
      ).value
    ).toContain(deal().offer!.url);
    expect(db.saveResource).not.toHaveBeenCalled();
  });
  it("uses a single shop button for detailed info; the title is already the comparison link", async () => {
    const t = setup("info", { game: gameId });
    await t.run();
    const reply = t.i.editReply.mock.calls[0][0] as any;
    expect(reply.embeds).toHaveLength(1);
    expect(reply.embeds[0].image.url).toBe(deal().game.image);
    expect(reply.embeds[0].url).toBe(deal().game.url);
    expect(reply.components).toHaveLength(1);
    expect(reply.components[0].components).toHaveLength(1);
    expect(reply.components[0].components[0].url).toBe(deal().offer!.url);
  });

  it("resolves a recently searched title for info and watch without making the user copy an ID", async () => {
    await setup("search", { query: "Fictional" }).run();
    await setup("info", { game: deal().game.title }).run();
    expect(api.gameDealInfo).toHaveBeenLastCalledWith(gameId, "DE");
    await setup("watch", { game: deal().game.title }).run();
    expect(api.gameDealInfo).toHaveBeenLastCalledWith(gameId, "DE");
    expect(db.saveResource).toHaveBeenCalledWith(
      guildId,
      "deal",
      expect.objectContaining({ data: expect.objectContaining({ gameId }) }),
      expect.anything()
    );
  });
  it("rejects an unselected/unknown title before calling the provider or changing a watch", async () => {
    await expect(
      setup("info", { game: "a never-searched unknown title" }).run()
    ).rejects.toThrow("Run /deals search first");
    expect(api.gameDealInfo).not.toHaveBeenCalled();
    expect(db.saveResource).not.toHaveBeenCalled();
  });

  it.each(["feed", "pause", "watch"])(
    "enforces Manage Server before %s can mutate/post",
    async (sub) => {
      const t = setup(sub, { game: gameId });
      t.member.permissions.has.mockReturnValue(false);
      await expect(t.run()).rejects.toThrow("Manage Server");
      expect(db.saveResource).not.toHaveBeenCalled();
      expect(api.gameDealInfo).not.toHaveBeenCalled();
    }
  );
  it("creates a guild-scoped automatic feed with conservative defaults, not an immediate channel message", async () => {
    const t = setup("feed", { "min-reviews": 20000, "max-posts": 2 });
    await t.run();
    expect(db.saveResource).toHaveBeenCalledWith(
      guildId,
      "deal",
      expect.objectContaining({
        enabled: true,
        data: expect.objectContaining({
          gameId: "",
          channelId,
          minReviews: 20000,
          maxPostsPerCheck: 2,
          region: "DE",
          currency: "EUR",
        }),
      }),
      { id: actorId, name: "Manager" },
      undefined
    );
    expect(JSON.stringify(t.i.editReply.mock.calls)).toContain(
      "No immediate channel post is claimed"
    );
    expect(api.pollDeals).not.toHaveBeenCalled();
  });
  it("updates the existing feed for that channel instead of making duplicates", async () => {
    db.listResources.mockResolvedValue([
      {
        id: "existing-feed",
        guildId,
        name: "Existing",
        enabled: true,
        data: { ...policy, channelId },
      },
    ]);
    const t = setup("feed");
    await t.run();
    expect(db.saveResource.mock.calls[0][4]).toBe("existing-feed");
    expect(db.saveResource).toHaveBeenCalledTimes(1);
  });
  it("rejects a channel outside this guild even if an interaction payload were forged", async () => {
    const t = setup("feed");
    t.channel.guild.id = "120000000000000002";
    await expect(t.run()).rejects.toThrow("in this server");
    expect(db.saveResource).not.toHaveBeenCalled();
  });
  it("pauses without deleting the configuration/history and does not alter another channel", async () => {
    db.listResources.mockResolvedValue([
      {
        id: "ours",
        guildId,
        name: "Our feed",
        enabled: true,
        data: { ...policy, channelId },
      },
      {
        id: "other",
        guildId,
        name: "Other feed",
        enabled: true,
        data: { ...policy, channelId: "120000000000000011" },
      },
    ]);
    await setup("pause").run();
    expect(db.saveResource).toHaveBeenCalledTimes(1);
    expect(db.saveResource.mock.calls[0]).toMatchObject([
      guildId,
      "deal",
      { enabled: false },
      { id: actorId },
      "ours",
    ]);
  });
  it("keeps /deals now ephemeral and read-only when nothing qualifies", async () => {
    const t = setup("now");
    await t.run();
    expect(db.saveResource).not.toHaveBeenCalled();
    expect(JSON.stringify(t.i.editReply.mock.calls)).toContain(
      "No lesser-known fallback or channel message was sent"
    );
  });
  it("rejects all deal paths while the guild module is paused", async () => {
    db.getGuild.mockResolvedValueOnce({
      config: { modules: { deals: false } },
    });
    await expect(setup("search", { query: "Title" }).run()).rejects.toThrow(
      "paused"
    );
    expect(api.searchGameDeals).not.toHaveBeenCalled();
  });
});

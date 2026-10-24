import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type Guild,
} from "discord.js";
const saved = vi.hoisted(() => ({ values: vi.fn() }));
vi.mock("@orbit/db", () => ({
  schema: { guilds: { id: "id" } },
  database: () => ({
    db: {
      insert: () => ({
        values: (value: unknown) => {
          saved.values(value);
          return { onConflictDoUpdate: async () => undefined };
        },
      }),
    },
  }),
}));
import { syncGuild } from "../apps/bot/src/sync";
beforeEach(() => vi.clearAllMocks());
function guild() {
  const roles = new Collection(
    [
      ...([
        ["guild", "Everyone", 0, P.ViewChannel],
        ["bot", "Orbit", 10, P.ManageRoles],
        ["admin", "Unrelated admin", 20, P.Administrator],
      ] as const),
    ].map(([id, name, position, bits]) => [
      id,
      {
        id,
        name,
        position,
        hexColor: "#abc",
        permissions: new PermissionsBitField(bits),
        managed: id === "bot",
      },
    ])
  );
  const text = P.ViewChannel | P.SendMessages | P.EmbedLinks;
  const voice = P.Connect | P.Speak;
  const channels = new Collection(
    [
      ["text", ChannelType.GuildText, text],
      ["announcements", ChannelType.GuildAnnouncement, text],
      ["denied", ChannelType.GuildText, P.ViewChannel],
      ["voice", ChannelType.GuildVoice, voice | P.ViewChannel],
      ["hidden-voice", ChannelType.GuildVoice, voice],
      ["stage", ChannelType.GuildStageVoice, voice | P.ViewChannel],
      ["forum", ChannelType.GuildForum, text],
      ["category", ChannelType.GuildCategory, text],
      ["thread", ChannelType.PublicThread, text],
    ].map(([id, type, bits]) => [
      String(id),
      {
        id: String(id),
        name: String(id),
        type,
        isThread: () => type === ChannelType.PublicThread,
        permissionsFor: () => new PermissionsBitField(bits as bigint),
      },
    ])
  );
  return {
    id: "guild",
    name: "Test guild",
    icon: null,
    memberCount: 5,
    members: {
      fetchMe: async () => ({
        roles: {
          highest: { position: 10 },
          cache: new Collection([
            ["guild", roles.get("guild")],
            ["bot", roles.get("bot")],
          ]),
        },
      }),
    },
    roles: { cache: roles, fetch: vi.fn() },
    channels: { cache: channels, fetch: vi.fn() },
  } as unknown as Guild;
}
describe("synced effective permission metadata", () => {
  it("saves effective bitfields/timestamps, bot-role membership and explicit unsupported channel types without a migration", async () => {
    const g = guild();
    await syncGuild(g);
    const row = saved.values.mock.calls[0][0];
    expect(
      row.channels.find((channel: any) => channel.id === "voice")
    ).toMatchObject({
      type: "voice",
      canSend: true,
      permissionBits: (P.ViewChannel | P.Connect | P.Speak).toString(),
    });
    expect(
      row.channels.find((channel: any) => channel.id === "hidden-voice").canSend
    ).toBe(false);
    expect(
      row.channels.find((channel: any) => channel.id === "stage")
    ).toMatchObject({ type: "stage", canSend: false });
    expect(
      row.channels.find((channel: any) => channel.id === "forum")
    ).toMatchObject({ type: "forum", canSend: false });
    expect(
      row.channels.find((channel: any) => channel.id === "category").canSend
    ).toBe(false);
    expect(
      row.channels.find((channel: any) => channel.id === "announcements")
        .canSend
    ).toBe(true);
    expect(row.channels.some((channel: any) => channel.id === "thread")).toBe(
      false
    );
    expect(
      row.channels.every((channel: any) =>
        Number.isFinite(Date.parse(channel.permissionsSyncedAt))
      )
    ).toBe(true);
    expect(row.roles.find((role: any) => role.id === "bot").assignedToBot).toBe(
      true
    );
    expect(
      row.roles.find((role: any) => role.id === "admin").assignedToBot
    ).toBe(false);
    expect(g.roles.fetch).toHaveBeenCalledTimes(1);
    expect(g.channels.fetch).toHaveBeenCalledTimes(1);
  });
});

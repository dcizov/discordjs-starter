import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Events, type Client, type Guild, type REST } from "discord.js";
import type { MusicService } from "../apps/bot/src/features/music/service";
const f = vi.hoisted(() => ({
  sync: vi.fn(),
  remove: vi.fn(),
  message: vi.fn(),
  reaction: vi.fn(),
  interaction: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../apps/bot/src/infrastructure/guild-sync", () => ({
  syncGuild: f.sync,
  removeGuild: f.remove,
}));
vi.mock("../apps/bot/src/features/moderation/messages", () => ({
  onMessage: f.message,
}));
vi.mock("../apps/bot/src/features/roles/panels", () => ({
  handleReaction: f.reaction,
}));
vi.mock("../apps/bot/src/interactions/dispatch", () => ({
  onInteraction: f.interaction,
}));
vi.mock("@orbit/core/logger", () => ({
  logger: { warn: f.warn, error: f.warn },
}));
import { attachGatewayEvents } from "../apps/bot/src/events/gateway";
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [f.sync, f.remove, f.message, f.reaction, f.interaction])
    mock.mockResolvedValue(undefined);
});
function setup() {
  const emitter = Object.assign(new EventEmitter(), { user: { id: "bot" } });
  const client = emitter as unknown as Client;
  const stop = attachGatewayEvents(client, {} as MusicService, {} as REST);
  return { emitter, stop };
}
describe("owned, explicitly typed gateway listeners", () => {
  it("syncs the new role/channel/guild instance and ignores DM channels", () => {
    const { emitter, stop } = setup();
    const old = { id: "old" } as Guild,
      fresh = { id: "fresh" } as Guild;
    emitter.emit(Events.GuildUpdate, old, fresh);
    emitter.emit(Events.GuildRoleUpdate, { guild: old }, { guild: fresh });
    emitter.emit(Events.ChannelUpdate, { guild: old }, { guild: fresh });
    emitter.emit(Events.ChannelCreate, { id: "dm" });
    expect(f.sync.mock.calls).toEqual([[fresh], [fresh], [fresh]]);
    stop();
  });
  it("syncs bot role membership only, not every member update", () => {
    const { emitter, stop } = setup(),
      guild = { id: "guild" };
    emitter.emit(Events.GuildMemberUpdate, {}, { id: "member", guild });
    emitter.emit(Events.GuildMemberUpdate, {}, { id: "bot", guild });
    expect(f.sync).toHaveBeenCalledExactlyOnceWith(guild);
    stop();
  });
  it("routes message, interaction, reaction add/remove and guild removal", () => {
    const { emitter, stop } = setup(),
      reaction = {},
      user = {},
      message = {},
      interaction = {};
    emitter.emit(Events.MessageCreate, message);
    emitter.emit(Events.InteractionCreate, interaction);
    emitter.emit(Events.MessageReactionAdd, reaction, user);
    emitter.emit(Events.MessageReactionRemove, reaction, user);
    emitter.emit(Events.GuildDelete, { id: "guild" });
    expect(f.message).toHaveBeenCalledWith(message);
    expect(f.interaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      interaction,
      expect.anything()
    );
    expect(f.reaction.mock.calls).toEqual([
      [reaction, user, true],
      [reaction, user, false],
    ]);
    expect(f.remove).toHaveBeenCalledWith("guild");
    stop();
  });
  it("disposes idempotently without detaching somebody else's listener", () => {
    const { emitter, stop } = setup(),
      foreign = vi.fn();
    emitter.on(Events.GuildCreate, foreign);
    stop();
    stop();
    emitter.emit(Events.GuildCreate, { id: "guild" });
    expect(f.sync).not.toHaveBeenCalled();
    expect(foreign).toHaveBeenCalledOnce();
    expect(emitter.listeners(Events.GuildCreate)).toEqual([foreign]);
  });
  it("handles asynchronous event failures without raw credentials or rejected promises", async () => {
    f.sync.mockRejectedValueOnce(
      new Error("sync failed password=private-value")
    );
    const { emitter, stop } = setup();
    emitter.emit(Events.GuildCreate, { id: "guild" });
    await vi.waitFor(() => expect(f.warn).toHaveBeenCalled());
    expect(JSON.stringify(f.warn.mock.calls)).not.toContain("private-value");
    stop();
  });
});

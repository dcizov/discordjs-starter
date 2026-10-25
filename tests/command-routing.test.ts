import { describe, expect, it, vi, beforeEach } from "vitest";
import { commandDefinitions } from "@orbit/core/commands";
import type { Client } from "discord.js";
import type { MusicService } from "../apps/bot/src/features/music/service";
import type { CommandContext } from "../apps/bot/src/commands/context";
const f = vi.hoisted(() => ({
  community: vi.fn(),
  economy: vi.fn(),
  moderation: vi.fn(),
  roles: vi.fn(),
  music: vi.fn(),
  news: vi.fn(),
  deals: vi.fn(),
}));
vi.mock("../apps/bot/src/commands/community", () => ({
  communityCommand: f.community,
}));
vi.mock("../apps/bot/src/commands/economy", () => ({
  economyCommand: f.economy,
}));
vi.mock("../apps/bot/src/commands/moderation", () => ({
  moderationCommand: f.moderation,
}));
vi.mock("../apps/bot/src/commands/roles", () => ({ rolesCommand: f.roles }));
vi.mock("../apps/bot/src/commands/music", () => ({ musicCommand: f.music }));
vi.mock("../apps/bot/src/commands/news", () => ({ newsCommand: f.news }));
vi.mock("../apps/bot/src/features/deals/commands", () => ({
  handleDeals: f.deals,
}));
import { dispatchCommand } from "../apps/bot/src/commands/dispatch";
import { registerCommands } from "../apps/bot/src/commands/registration";
beforeEach(() => vi.clearAllMocks());
function request(name: string) {
  const reply = vi.fn(async () => undefined);
  return {
    context: { i: { commandName: name }, reply } as unknown as CommandContext,
    reply,
  };
}
describe("fixed command set registration and dispatch", () => {
  it.each(commandDefinitions.map((command) => [command.name]))(
    "routes registered /%s rather than falling through to unavailable",
    async (name) => {
      const { context, reply } = request(name);
      await dispatchCommand(
        context,
        { ws: { ping: 42 } } as Client,
        {} as MusicService
      );
      if (name === "ping")
        expect(reply).toHaveBeenCalledWith(
          expect.stringContaining("Gateway: 42ms")
        );
      else {
        expect(reply).not.toHaveBeenCalled();
        expect(
          Object.values(f).reduce(
            (sum, handler) => sum + handler.mock.calls.length,
            0
          )
        ).toBe(1);
      }
    }
  );
  it("keeps a graceful response for obsolete/unknown commands", async () => {
    const { context, reply } = request("obsolete-command");
    await dispatchCommand(context, {} as Client, {} as MusicService);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("not available")
    );
    for (const handler of Object.values(f))
      expect(handler).not.toHaveBeenCalled();
  });
  it("registers exactly the shared JSON in the selected guild only", async () => {
    const put = vi.fn(async () => undefined);
    expect(
      await registerCommands(
        { put },
        "120000000000000099",
        "120000000000000001"
      )
    ).toBe(commandDefinitions.length);
    expect(put).toHaveBeenCalledExactlyOnceWith(
      "/applications/120000000000000099/guilds/120000000000000001/commands",
      { body: commandDefinitions.map((command) => command.toJSON()) }
    );
  });
});

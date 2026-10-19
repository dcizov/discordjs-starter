import type { ChatInputCommandInteraction } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateGuild } from "../db/queries";
import { guild } from "./guild";

vi.mock("../db", () => ({ getDb: () => ({ db: {} }), closeDb: vi.fn() }));
vi.mock("../db/queries", () => ({ getOrCreateGuild: vi.fn() }));

const getOrCreate = vi.mocked(getOrCreateGuild);

beforeEach(() => {
  getOrCreate.mockReset();
});

describe("/guild", () => {
  it("replies with the stored settings", async () => {
    getOrCreate.mockResolvedValue({
      guildId: "123",
      locale: "de",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const interaction = {
      inGuild: () => true,
      guildId: "123",
      reply: vi.fn(),
    };

    await guild.execute(interaction as unknown as ChatInputCommandInteraction);

    expect(getOrCreate).toHaveBeenCalledWith(expect.anything(), "123");
    expect(interaction.reply).toHaveBeenCalledWith(
      "Locale: de\nFirst seen: 2026-01-01T00:00:00.000Z"
    );
  });

  it("refuses to run outside a server", async () => {
    const interaction = { inGuild: () => false, reply: vi.fn() };

    await guild.execute(interaction as unknown as ChatInputCommandInteraction);

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This command only works in a server.",
      flags: 64,
    });
  });
});

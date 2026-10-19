import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { ping } from "./ping";

function interactionWith(wsPing: number) {
  return {
    createdTimestamp: 1_000,
    client: { ws: { ping: wsPing } },
    reply: vi.fn(),
    editReply: vi.fn(),
  };
}

describe("/ping", () => {
  it("replies first, then edits in the measured latency", async () => {
    const interaction = interactionWith(42);

    await ping.execute(interaction as unknown as ChatInputCommandInteraction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Pinging...",
    });
    expect(interaction.editReply).toHaveBeenCalledTimes(1);

    const [message] = interaction.editReply.mock.calls[0] as [string];
    expect(message).toContain("Pong!");
    expect(message).toContain("Round-trip:");
    expect(message).toContain("WebSocket heartbeat: 42ms");
  });
});

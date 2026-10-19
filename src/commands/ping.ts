import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/command";

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with the bot latency"),

  async execute(interaction) {
    const startedAt = Date.now();
    await interaction.reply({ content: "Pinging..." });
    const roundTrip = Date.now() - startedAt;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply(
      `Pong! 🏓\nRound-trip: ${roundTrip}ms\nWebSocket heartbeat: ${apiLatency}ms`
    );
  },
};

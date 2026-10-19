import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/command";

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with the bot latency"),

  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply(
      `Pong! 🏓\nLatency: ${latency}ms\nAPI Latency: ${apiLatency}ms`
    );
  },
};

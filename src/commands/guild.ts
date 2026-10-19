import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getDb } from "../db";
import { getOrCreateGuild } from "../db/queries";
import type { Command } from "../types/command";

export const guild: Command = {
  data: new SlashCommandBuilder()
    .setName("guild")
    .setDescription("Shows the settings stored for this server"),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "This command only works in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { db } = getDb();
    const record = await getOrCreateGuild(db, interaction.guildId);

    await interaction.reply(
      `Locale: ${record.locale}\nFirst seen: ${record.createdAt.toISOString()}`
    );
  },
};

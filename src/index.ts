import type { InteractionReplyOptions, MessagePayload } from "discord.js";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands } from "./commands";
import { config } from "./config";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Discord bot is ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands[interaction.commandName];
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);

    const replyMethod =
      interaction.replied || interaction.deferred
        ? (options: string | InteractionReplyOptions | MessagePayload) =>
            interaction.followUp(options)
        : (options: string | InteractionReplyOptions | MessagePayload) =>
            interaction.reply(options);

    await replyMethod({
      content: "There was an error executing this command!",
      ephemeral: true,
    });
  }
});

client.login(config.DISCORD_TOKEN).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});

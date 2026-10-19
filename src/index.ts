import type { InteractionReplyOptions, MessagePayload } from "discord.js";
import {
  Client,
  Events,
  GatewayCloseCodes,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from "discord.js";
import { commands } from "./commands";
import { config } from "./config";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Discord bot is ready! Logged in as ${readyClient.user.tag}`);
});

const DISALLOWED_INTENTS: number = GatewayCloseCodes.DisallowedIntents;

client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
  if (closeEvent.code !== DISALLOWED_INTENTS) return;

  console.error(
    `❌ Shard ${shardId} disconnected: disallowed intents (4014).\n` +
      "   A privileged intent is requested but not enabled. Turn it on in\n" +
      "   Developer Portal → your application → Bot → Privileged Gateway Intents."
  );
  process.exit(1);
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

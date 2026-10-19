import { REST, Routes } from "discord.js";
import { commands } from "./commands";
import { config } from "./config";

const commandsData = Object.values(commands).map((command) =>
  command.data.toJSON()
);

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

async function deployCommands() {
  try {
    console.log("🚀 Started refreshing application (/) commands...");

    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
      body: commandsData,
    });

    console.log("✅ Successfully reloaded application (/) commands!");
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
    process.exit(1);
  }
}

deployCommands().catch((error) => {
  console.error("Failed to deploy commands:", error);
  process.exit(1);
});

import { REST, Routes } from "discord.js";
import { commands } from "./commands";
import { parseEnv } from "./config";

const config = parseEnv();

const commandsData = Object.values(commands).map((command) =>
  command.data.toJSON()
);

if (commandsData.length === 0) {
  console.error("❌ No commands to deploy. Add them to src/commands/index.ts.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

const guildId = config.DISCORD_GUILD_ID;
const where = guildId ? `guild ${guildId}` : "globally";

async function deployCommands() {
  try {
    console.log(
      `🚀 Started refreshing application (/) commands ${where}: ` +
        `${Object.keys(commands).join(", ")}`
    );

    await rest.put(
      guildId
        ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId)
        : Routes.applicationCommands(config.DISCORD_CLIENT_ID),
      { body: commandsData }
    );

    console.log(
      `✅ Successfully reloaded ${commandsData.length} command(s) ${where}!`
    );
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
    process.exit(1);
  }
}

deployCommands().catch((error) => {
  console.error("Failed to deploy commands:", error);
  process.exit(1);
});

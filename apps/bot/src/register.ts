import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { REST, Routes } from "discord.js";
import "dotenv/config";
import { commandDefinitions } from "./commands";
async function main() {
  if (isDemo()) {
    console.log("Demo mode: slash-command registration is disabled.");
    return;
  }
  validateEnvironment("register");
  const id = required("DISCORD_CLIENT_ID"),
    guild = process.env.DISCORD_GUILD_ID;
  const rest = new REST({ version: "10" }).setToken(required("DISCORD_TOKEN"));
  const data = commandDefinitions.map((c) => c.toJSON());
  await rest.put(
    guild
      ? Routes.applicationGuildCommands(id, guild)
      : Routes.applicationCommands(id),
    { body: data }
  );
  console.log(
    `Registered ${data.length} commands ${guild ? `in guild ${guild}` : "globally"}.`
  );
}
main().catch((e) => {
  console.error("Command registration failed:", e.message);
  process.exitCode = 1;
});

import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { REST } from "discord.js";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import "dotenv/config";
import { registerCommands } from "./registration";
async function main() {
  if (isDemo()) {
    console.log("Demo mode: slash-command registration is disabled.");
    return;
  }
  validateEnvironment("register");
  const id = required("DISCORD_CLIENT_ID"),
    guild = process.env.DISCORD_GUILD_ID;
  const rest = new REST({ version: "10" }).setToken(required("DISCORD_TOKEN"));
  let count: number;
  try {
    count = await registerCommands(rest, id, guild);
  } finally {
    rest.clearHashSweeper();
    rest.clearHandlerSweeper();
  }
  console.log(
    `Registered ${count} commands ${guild ? `in guild ${guild}` : "globally"}.`
  );
}
main().catch((error: unknown) => {
  console.error("Command registration failed:", errorDiagnostic(error));
  process.exitCode = 1;
});

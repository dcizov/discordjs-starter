import { commandDefinitions } from "@orbit/core/commands";
import { Routes, type REST } from "discord.js";

/** Same builders drive registration and the dashboard catalog; no gateway login. */
export async function registerCommands(
  rest: Pick<REST, "put">,
  clientId: string,
  guildId?: string
) {
  const commands = commandDefinitions.map((command) => command.toJSON());
  await rest.put(
    guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId),
    { body: commands }
  );
  return commands.length;
}

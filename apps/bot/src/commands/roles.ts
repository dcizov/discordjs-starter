import type { CommandContext } from "./context";
import type { Client } from "discord.js";
import { listResources } from "@orbit/db";
import { publishPanel } from "../features/roles/panels";
export async function rolesCommand(context: CommandContext, client: Client) {
  const { i, guild, member, config, reply } = context;

  switch (i.commandName) {
    case "roles": {
      if (!config.modules.roles) throw new Error("Self roles are paused.");
      const panels = (await listResources(guild.id, "panel")).filter(
        (r) => r.enabled
      );
      await reply(
        panels.length
          ? panels
              .map(
                (p) =>
                  `${p.name} — ${p.data.messageId ? `https://discord.com/channels/${guild.id}/${p.data.channelId}/${p.data.messageId}` : "Not published yet"}`
              )
              .join("\n")
          : "No role panels are published yet. Ask an administrator to create one in the dashboard."
      );
      break;
    }
    case "role-panel": {
      const result = await publishPanel(
        client,
        guild.id,
        i.options.getString("panel", true),
        member.id
      );
      await reply(
        `Your role panel is ready: https://discord.com/channels/${guild.id}/${result.channelId}/${result.messageId}`
      );
      break;
    }
  }
}

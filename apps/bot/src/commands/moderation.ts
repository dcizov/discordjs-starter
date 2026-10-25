import type { CommandContext } from "./context";
import { PermissionFlagsBits } from "discord.js";
import { listResources, recordCase } from "@orbit/db";
import { safeText } from "@orbit/core";
import { logCase, moderate } from "../features/moderation/actions";
export async function moderationCommand(context: CommandContext) {
  const { i, guild, member, config, reply } = context;
  const actor = { id: member.id, name: member.displayName };
  if (["warn", "timeout", "kick", "ban"].includes(i.commandName)) {
    const user = i.options.getUser("member", true);
    const target = await guild.members
      .fetch({ user: user.id, force: true })
      .catch(() => null);
    if (!target)
      throw new Error("That user is not currently a member of this server.");
    const record = await moderate({
      guild,
      actor: member,
      target,
      type: i.commandName as "warn" | "timeout" | "kick" | "ban",
      reason: i.options.getString("reason", true),
      minutes: i.options.getInteger("minutes") ?? undefined,
    });
    await reply(
      `${i.commandName} recorded for ${target.displayName}. Case ${record.id}.`
    );
    return;
  }

  switch (i.commandName) {
    case "purge": {
      if (!config.modules.moderation) throw new Error("Moderation is paused.");
      const me = await guild.members.fetchMe();
      if (
        !i.channel ||
        !("bulkDelete" in i.channel) ||
        !member
          .permissionsIn(i.channel)
          .has(PermissionFlagsBits.ManageMessages) ||
        !me.permissionsIn(i.channel).has(PermissionFlagsBits.ManageMessages)
      )
        throw new Error(
          "Both you and Orbit need Manage Messages in a server text channel."
        );
      const count = i.options.getInteger("amount", true);
      const deleted = await i.channel.bulkDelete(count, true);
      if (!deleted.size) {
        await reply(
          "No eligible recent messages were found. Messages older than 14 days are skipped."
        );
        break;
      }
      const record = await recordCase(
        guild.id,
        {
          name: `Purge · ${deleted.size} messages`,
          enabled: true,
          data: {
            targetId: member.id,
            type: "purge",
            reason: `Purged ${deleted.size} recent messages from #${"name" in i.channel ? i.channel.name : "channel"}`,
            moderatorId: member.id,
            messageCount: deleted.size,
          },
        },
        actor
      );
      await logCase(guild, {
        id: record.id,
        type: "purge",
        targetId: member.id,
        moderator: member.displayName,
        reason: `Removed ${deleted.size} messages`,
      });
      await reply(
        `Removed ${deleted.size} recent messages. Messages older than 14 days are skipped.`
      );
      break;
    }
    case "cases": {
      if (!member.permissions.has(PermissionFlagsBits.ModerateMembers))
        throw new Error("Moderate Members is required.");
      const target = i.options.getUser("member");
      const cases = (await listResources(guild.id, "case"))
        .filter((r) => !target || r.data.targetId === target.id)
        .slice(0, 10);
      await reply(
        cases.length
          ? cases
              .map(
                (c) =>
                  `${c.name} · ${c.data.type} · ${c.data.targetId}\n${safeText(c.data.reason, 100)} · ${new Date(c.createdAt).toLocaleDateString()}\nID: ${c.id}`
              )
              .join("\n\n")
          : "No matching moderation cases. A quiet, happy corner."
      );
      break;
    }
  }
}

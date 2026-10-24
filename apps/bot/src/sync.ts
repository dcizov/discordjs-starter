import { defaultConfig } from "@orbit/core";
import { database, schema } from "@orbit/db";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import { eq } from "drizzle-orm";
import { roleView } from "./roles";
export async function syncGuild(guild: Guild) {
  const me = await guild.members.fetchMe();
  await guild.roles.fetch();
  await guild.channels.fetch();
  const channels = guild.channels.cache
    .map((c) => {
      const type =
        c.type === ChannelType.GuildVoice ||
        c.type === ChannelType.GuildStageVoice
          ? ("voice" as const)
          : c.type === ChannelType.GuildCategory
            ? ("category" as const)
            : ("text" as const);
      const perms = c.permissionsFor(me);
      return {
        id: c.id,
        name: c.name,
        type,
        canSend: !!perms?.has(
          type === "voice"
            ? [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
            : [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
              ]
        ),
      };
    })
    .filter((c) => !guild.channels.cache.get(c.id)?.isThread());
  const metadata = {
    name: guild.name,
    icon: guild.icon,
    installed: true,
    memberCount: guild.memberCount,
    roles: roleView(guild),
    channels,
    botRolePosition: me.roles.highest.position,
    updatedAt: new Date(),
  };
  await database()
    .db.insert(schema.guilds)
    .values({
      id: guild.id,
      config: structuredClone(defaultConfig),
      ...metadata,
    })
    .onConflictDoUpdate({ target: schema.guilds.id, set: metadata });
}
export async function removeGuild(id: string) {
  await database()
    .db.update(schema.guilds)
    .set({ installed: false, updatedAt: new Date() })
    .where(eq(schema.guilds.id, id));
}

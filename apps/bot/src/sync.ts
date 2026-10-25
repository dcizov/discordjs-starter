import { defaultConfig, type GuildChannel } from "@orbit/core";
import { database, schema } from "@orbit/db";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import { eq } from "drizzle-orm";
import { roleView } from "./roles";
export async function syncGuild(guild: Guild) {
  const me = await guild.members.fetchMe();
  await guild.roles.fetch();
  await guild.channels.fetch();
  const syncedAt = new Date().toISOString();
  const channels: GuildChannel[] = guild.channels.cache
    .filter((channel) => !channel.isThread())
    .map((channel) => {
      const type: GuildChannel["type"] =
        channel.type === ChannelType.GuildVoice
          ? "voice"
          : channel.type === ChannelType.GuildStageVoice
            ? "stage"
            : channel.type === ChannelType.GuildCategory
              ? "category"
              : channel.type === ChannelType.GuildForum
                ? "forum"
                : channel.type === ChannelType.GuildMedia
                  ? "media"
                  : [
                        ChannelType.GuildText,
                        ChannelType.GuildAnnouncement,
                      ].includes(channel.type)
                    ? "text"
                    : "other";
      const perms = channel.permissionsFor(me);
      return {
        id: channel.id,
        name: channel.name,
        type,
        canSend:
          type === "voice"
            ? !!perms?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
              ])
            : type === "text" &&
              !!perms?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
              ]),
        supportsCommunityPosts: channel.type === ChannelType.GuildText,
        permissionBits: perms?.bitfield.toString(),
        permissionsSyncedAt: syncedAt,
      };
    });
  const metadata = {
    name: guild.name,
    icon: guild.icon,
    installed: true,
    memberCount: guild.memberCount,
    roles: roleView(guild).map((role) => ({
      ...role,
      assignedToBot: me.roles.cache.has(role.id),
    })),
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

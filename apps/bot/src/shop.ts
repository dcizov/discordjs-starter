import { assertAssignableRole } from "@orbit/core";
import { database, getResource, schema } from "@orbit/db";
import type { GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { and, eq } from "drizzle-orm";
import { memberLock, roleView } from "./roles";
export async function claimShopRole(member: GuildMember, itemId: string) {
  const item = await getResource(member.guild.id, itemId);
  if (!item || item.kind !== "shop" || item.data.type !== "role")
    throw new Error("This is not an available role entitlement.");
  const [owned] = await database()
    .db.select()
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.guildId, member.guild.id),
        eq(schema.inventory.userId, member.id),
        eq(schema.inventory.resourceId, itemId)
      )
    );
  if (!owned)
    throw new Error("You do not own this role. Buy it from the shop first.");
  return memberLock(member.guild.id, member.id, async () => {
    await member.guild.roles.fetch();
    const me = await member.guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
      throw new Error("Orbit needs Manage Roles to deliver this reward.");
    assertAssignableRole(
      roleView(member.guild).find((r) => r.id === item.data.roleId),
      me.roles.highest.position,
      member.guild.id
    );
    await member.roles.add(
      item.data.roleId,
      "Claimed purchased shop entitlement"
    );
    return item.name;
  });
}

import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { guilds } from "./schema";

export async function getOrCreateGuild(db: Database, guildId: string) {
  const [inserted] = await db
    .insert(guilds)
    .values({ guildId })
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(guilds)
    .where(eq(guilds.guildId, guildId))
    .limit(1);

  if (!existing) {
    throw new Error(`Guild ${guildId} could not be read after inserting it`);
  }

  return existing;
}

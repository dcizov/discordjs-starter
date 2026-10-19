import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const guilds = pgTable("guilds", {
  guildId: text("guild_id").primaryKey(),
  locale: text("locale").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

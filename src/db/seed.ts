import { closeDb, getDb } from "./index";
import { guilds } from "./schema";

async function main(): Promise<void> {
  const { db } = getDb();
  const rows = [
    { guildId: "111111111111111111", locale: "de" },
    { guildId: "222222222222222222", locale: "en" },
  ];

  await db.insert(guilds).values(rows).onConflictDoNothing();
  console.log(`✅ Seeded ${rows.length} guilds`);
}

main()
  .catch((error: unknown) => {
    console.error("❌ Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });

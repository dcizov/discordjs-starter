import "dotenv/config";
import { createDb } from "./client";
import { guilds } from "./schema";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("❌ Seeding failed: DATABASE_URL is not set");
  process.exit(1);
}

const { db, pool } = createDb(url);

async function main(): Promise<void> {
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
    await pool.end();
  });

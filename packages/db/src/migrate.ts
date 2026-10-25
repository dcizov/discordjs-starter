import "dotenv/config";
import { validateEnvironment } from "@orbit/core/environment";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, database } from "./client";
async function main() {
  validateEnvironment("migrate");
  await migrate(database().db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

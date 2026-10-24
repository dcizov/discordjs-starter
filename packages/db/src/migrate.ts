import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, database } from "./client";
async function main() {
  await migrate(database().db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

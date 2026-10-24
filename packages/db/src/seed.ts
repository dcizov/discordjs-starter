import "dotenv/config";
import { closeDb, database } from "./client";
import { createDemo } from "./demo-seed";
import * as s from "./schema";
async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true")
    throw new Error(
      "Set ALLOW_DEMO_SEED=true only for a disposable development database. This is not needed for demo mode."
    );
  const d = createDemo(),
    db = database().db;
  await db.transaction(async (tx) => {
    for (const g of d.guilds)
      await tx
        .insert(s.guilds)
        .values({ ...g, updatedAt: new Date(g.updatedAt) })
        .onConflictDoNothing();
    for (const r of d.resources)
      await tx
        .insert(s.resources)
        .values({
          ...r,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        })
        .onConflictDoNothing();
    for (const a of d.accounts)
      await tx
        .insert(s.accounts)
        .values({ ...a, lastDaily: null })
        .onConflictDoNothing();
  });
  console.log("Seeded development data.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

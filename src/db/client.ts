import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): {
  db: Database;
  pool: Pool;
} {
  const pool = new Pool({ connectionString });

  return { db: drizzle(pool, { schema }), pool };
}

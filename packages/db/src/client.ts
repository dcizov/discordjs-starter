import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
let cached: ReturnType<typeof connect> | undefined;
function connect() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required outside demo mode");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
export function database() {
  return (cached ??= connect());
}
export async function closeDb() {
  if (cached) {
    await cached.pool.end();
    cached = undefined;
  }
}

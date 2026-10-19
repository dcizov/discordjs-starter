import { parseEnv } from "../config";
import { createDb, type Database } from "./client";
import type { Pool } from "pg";

let instance: { db: Database; pool: Pool } | undefined;

export function getDb(): { db: Database; pool: Pool } {
  instance ??= createDb(parseEnv().DATABASE_URL);

  return instance;
}

export async function closeDb(): Promise<void> {
  if (!instance) return;

  await instance.pool.end();
  instance = undefined;
}

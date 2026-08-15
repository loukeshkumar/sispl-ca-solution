import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../../db/schema";
import { readPostgresConfig } from "../config";

type Environment = Record<string, string | undefined>;

declare global {
  var __sisplPostgresPool: Pool | undefined;
}

export function getPostgresPool(env: Environment = process.env) {
  if (globalThis.__sisplPostgresPool) return globalThis.__sisplPostgresPool;

  const config = readPostgresConfig(env);
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.max,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    application_name: "sispl-ca-solution",
  });
  globalThis.__sisplPostgresPool = pool;
  return pool;
}

export function getDatabase(env: Environment = process.env): NodePgDatabase<typeof schema> {
  return drizzle(getPostgresPool(env), { schema });
}

export async function closePostgresPool() {
  const pool = globalThis.__sisplPostgresPool;
  globalThis.__sisplPostgresPool = undefined;
  if (pool) await pool.end();
}

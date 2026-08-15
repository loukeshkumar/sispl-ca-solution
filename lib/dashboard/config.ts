import type { DataSource } from "./types";

type Environment = Record<string, string | undefined>;

export type PostgresConfig = {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  host: string;
  port: number;
  database: string;
};

export function resolveDataSource(env: Environment): DataSource {
  const source = env.SISPL_DATA_SOURCE?.trim().toLowerCase();
  if (!source || source === "demo") return "demo";
  if (source === "postgres") return "postgres";
  throw new Error("SISPL_DATA_SOURCE must be either demo or postgres.");
}

function readPositiveInteger(value: string | null, fallback: number, name: string) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function readPostgresConfig(env: Environment): PostgresConfig {
  const rawUrl = env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required when SISPL_DATA_SOURCE=postgres.");

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgresql protocol.");
  }

  const max = readPositiveInteger(parsed.searchParams.get("connection_limit"), 10, "connection_limit");
  const timeoutSeconds = readPositiveInteger(parsed.searchParams.get("pool_timeout"), 30, "pool_timeout");
  parsed.searchParams.delete("connection_limit");
  parsed.searchParams.delete("pool_timeout");

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database name.");

  return {
    connectionString: parsed.toString(),
    max,
    connectionTimeoutMillis: timeoutSeconds * 1_000,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
  };
}

import { resolveTestDatabaseUrl } from "../../lib/dashboard/postgres/test-config";

process.env.DATABASE_URL = resolveTestDatabaseUrl(process.env);

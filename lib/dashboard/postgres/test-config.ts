export function resolveTestDatabaseUrl(env: Record<string, string | undefined>) {
  const source = env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required to derive the isolated test database.");
  const sourceUrl = new URL(source);
  const sourceName = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ""));
  const targetUrl = env.DATABASE_URL_TEST ? new URL(env.DATABASE_URL_TEST) : new URL(source);
  if (!env.DATABASE_URL_TEST) targetUrl.pathname = `/${encodeURIComponent(`${sourceName}_test`)}`;
  const targetName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));
  if (!targetName.toLowerCase().endsWith("_test") || targetName === sourceName) {
    throw new Error("Integration tests require a separate database whose name ends with _test.");
  }
  return targetUrl.toString();
}

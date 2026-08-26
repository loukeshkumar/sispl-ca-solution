const FALLBACK_PATH = "/";

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return FALLBACK_PATH;

  try {
    const url = new URL(value, "https://sispl.local");
    if (url.origin !== "https://sispl.local") return FALLBACK_PATH;
    if (url.pathname === "/login" || url.pathname === "/forbidden") return FALLBACK_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK_PATH;
  }
}

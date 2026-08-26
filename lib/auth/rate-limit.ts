import { createHash } from "node:crypto";

export type LoginRateLimit = { keyHash: string; maximumAttempts: number };

const hashKey = (value: string) => createHash("sha256").update(value).digest("hex");

function trustedClientAddress(requestHeaders: Headers, trustProxyHeaders: boolean) {
  if (!trustProxyHeaders) return "direct";
  const candidate = requestHeaders.get("x-real-ip")
    ?? requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return /^[0-9a-f:.]{3,64}$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

export function getLoginRateLimits(requestHeaders: Headers, env: Record<string, string | undefined>): LoginRateLimit[] {
  const address = trustedClientAddress(requestHeaders, env.AUTH_TRUST_PROXY_HEADERS === "true");
  return [
    { keyHash: hashKey("login:global"), maximumAttempts: 200 },
    { keyHash: hashKey(`login:network:${address}`), maximumAttempts: 30 },
  ];
}

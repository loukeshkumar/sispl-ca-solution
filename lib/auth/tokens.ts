import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function isSessionToken(value: string) {
  return TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

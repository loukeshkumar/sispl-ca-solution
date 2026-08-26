"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDatabase } from "../lib/dashboard/postgres/pool";
import { safeReturnPath } from "../lib/auth/redirects";
import {
  clearFailedLogins,
  consumeLoginRateLimit,
  createSessionRecord,
  findLoginIdentity,
  recordFailedLogin,
  revokeSessionByTokenHash,
} from "../lib/auth/repository";
import { getLoginRateLimits } from "../lib/auth/rate-limit";
import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  setSessionCookie,
} from "../lib/auth/server";
import { verifyPassword } from "../lib/auth/password";
import { createSessionToken, hashSessionToken, isSessionToken } from "../lib/auth/tokens";

export type LoginState = { error: string };

const INVALID_LOGIN = "The email, password, or firm ID is incorrect, or the account is temporarily locked.";

function textField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function rawTextField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = textField(formData, "email").toLowerCase();
  const password = rawTextField(formData, "password");
  const tenantSlug = textField(formData, "tenantSlug").toLowerCase();
  const returnTo = safeReturnPath(textField(formData, "returnTo"));

  const database = getDatabase();
  let token = "";
  let expiresAt = new Date();

  try {
    const now = new Date();
    const rateLimits = getLoginRateLimits(await headers(), process.env);
    const decisions = await Promise.all(rateLimits.map((limit) => consumeLoginRateLimit(
      database,
      limit.keyHash,
      now,
      limit.maximumAttempts,
    )));
    if (decisions.some((allowed) => !allowed)) {
      await verifyPassword(password, "invalid");
      return { error: INVALID_LOGIN };
    }

    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || password.length > 128 || !/^[a-z0-9-]{2,80}$/.test(tenantSlug)) {
      await verifyPassword(password, "invalid");
      return { error: INVALID_LOGIN };
    }

    const identity = await findLoginIdentity(database, email, tenantSlug);
    const locked = Boolean(identity?.lockedUntil && identity.lockedUntil > now);
    const validPassword = await verifyPassword(password, identity?.passwordHash ?? "invalid");

    if (!identity || locked || !validPassword) {
      if (identity && !locked) await recordFailedLogin(database, identity, now);
      return { error: INVALID_LOGIN };
    }

    await clearFailedLogins(database, identity.userId);
    token = createSessionToken();
    expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await createSessionRecord(database, {
      membershipId: identity.membershipId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
  } catch {
    return { error: "Sign-in is temporarily unavailable. Verify the local database and try again." };
  }

  await setSessionCookie(token, expiresAt);
  redirect(returnTo);
}

export async function logoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "";
  if (isSessionToken(token)) {
    try {
      await revokeSessionByTokenHash(getDatabase(), hashSessionToken(token));
    } catch {
      // The local cookie is still cleared when PostgreSQL is unavailable.
    }
  }
  await clearSessionCookie();
  redirect("/login");
}

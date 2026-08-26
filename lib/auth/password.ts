import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 32 * 1024 * 1024;
const DUMMY_SALT = Buffer.from("sispl-auth-dummy-salt", "utf8");

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function validateNewPassword(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters.";
  if (password.length > 128) return "Password must contain no more than 128 characters.";
  return null;
}

export async function hashPassword(password: string) {
  const validationError = validateNewPassword(password);
  if (validationError) throw new Error(validationError);

  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string) {
  const parts = encodedHash.split("$");
  const validFormat = parts.length === 6
    && parts[0] === ALGORITHM
    && Number(parts[1]) === COST
    && Number(parts[2]) === BLOCK_SIZE
    && Number(parts[3]) === PARALLELIZATION;

  if (!validFormat || password.length > 128) {
    await deriveKey(password.slice(0, 128), DUMMY_SALT);
    return false;
  }

  try {
    const salt = Buffer.from(parts[4] ?? "", "base64url");
    const storedKey = Buffer.from(parts[5] ?? "", "base64url");
    if (salt.length !== 16 || storedKey.length !== KEY_LENGTH) {
      await deriveKey(password, DUMMY_SALT);
      return false;
    }
    const candidateKey = await deriveKey(password, salt);
    return timingSafeEqual(candidateKey, storedKey);
  } catch {
    await deriveKey(password.slice(0, 128), DUMMY_SALT);
    return false;
  }
}

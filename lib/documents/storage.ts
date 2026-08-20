import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { deleteObject, getObject, objectKey, putObject } from "./s3-driver";
import { readObjectStorageConfig, resolveDocumentStorageMode, type ObjectStorageConfig } from "./storage-config";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertReference(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`Invalid ${label} storage reference.`);
}

function tenantDirectory(tenantId: string) {
  assertReference(tenantId, "tenant");
  return path.join(process.cwd(), ".data", "documents", tenantId);
}

function storedPath(tenantId: string, storageName: string) {
  assertReference(storageName, "document");
  return path.join(tenantDirectory(tenantId), storageName);
}

function stagedPath(tenantId: string, storageName: string) {
  assertReference(storageName, "document");
  return path.join(tenantDirectory(tenantId), ".staging", storageName);
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

let cachedConfig: ObjectStorageConfig | undefined;

function objectStorageConfig() {
  cachedConfig ??= readObjectStorageConfig(process.env);
  return cachedConfig;
}

function objectStorageEnabled() {
  return resolveDocumentStorageMode(process.env) === "s3";
}


/** Test seam: clears the memoised object-storage configuration. */
export function resetDocumentStorageConfig() {
  cachedConfig = undefined;
}

export async function storeDocumentFile(tenantId: string, bytes: Uint8Array) {
  if (!bytes.byteLength) throw new Error("Cannot store an empty document.");
  const storageName = randomUUID();
  if (objectStorageEnabled()) {
    assertReference(tenantId, "tenant");
    await putObject(objectStorageConfig(), objectKey(objectStorageConfig(), tenantId, storageName, false), bytes);
    return { storageName, sha256: digest(bytes) };
  }
  await mkdir(tenantDirectory(tenantId), { recursive: true, mode: 0o700 });
  await writeFile(storedPath(tenantId, storageName), bytes, { flag: "wx", mode: 0o600 });
  return { storageName, sha256: digest(bytes) };
}

export async function stageDocumentFile(tenantId: string, bytes: Uint8Array) {
  if (!bytes.byteLength) throw new Error("Cannot stage an empty document.");
  const storageName = randomUUID();
  if (objectStorageEnabled()) {
    assertReference(tenantId, "tenant");
    await putObject(objectStorageConfig(), objectKey(objectStorageConfig(), tenantId, storageName, true), bytes);
    return { storageName, sha256: digest(bytes) };
  }
  await mkdir(path.join(tenantDirectory(tenantId), ".staging"), { recursive: true, mode: 0o700 });
  await writeFile(stagedPath(tenantId, storageName), bytes, { flag: "wx", mode: 0o600 });
  return { storageName, sha256: digest(bytes) };
}

export async function commitStagedDocument(tenantId: string, storageName: string) {
  if (objectStorageEnabled()) {
    assertReference(tenantId, "tenant");
    assertReference(storageName, "document");
    const config = objectStorageConfig();
    const stagedKey = objectKey(config, tenantId, storageName, true);
    const bytes = await getObject(config, stagedKey);
    await putObject(config, objectKey(config, tenantId, storageName, false), bytes);
    await deleteObject(config, stagedKey);
    return;
  }
  await mkdir(tenantDirectory(tenantId), { recursive: true, mode: 0o700 });
  await rename(stagedPath(tenantId, storageName), storedPath(tenantId, storageName));
}

export async function removeStagedDocument(tenantId: string, storageName: string) {
  if (objectStorageEnabled()) {
    assertReference(tenantId, "tenant");
    assertReference(storageName, "document");
    await deleteObject(objectStorageConfig(), objectKey(objectStorageConfig(), tenantId, storageName, true));
    return;
  }
  try {
    await unlink(stagedPath(tenantId, storageName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function readDocumentFile(tenantId: string, storageName: string) {
  if (objectStorageEnabled()) {
    assertReference(tenantId, "tenant");
    assertReference(storageName, "document");
    return getObject(objectStorageConfig(), objectKey(objectStorageConfig(), tenantId, storageName, false));
  }
  return readFile(storedPath(tenantId, storageName));
}

export async function removeDocumentFile(tenantId: string, storageName: string) {
  if (objectStorageEnabled()) {
    assertReference(tenantId, "tenant");
    assertReference(storageName, "document");
    await deleteObject(objectStorageConfig(), objectKey(objectStorageConfig(), tenantId, storageName, false));
    return;
  }
  try {
    await unlink(storedPath(tenantId, storageName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

import { createHash, createHmac } from "node:crypto";

import type { ObjectStorageConfig } from "./storage-config";

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

function sha256Hex(payload: Uint8Array | string) {
  return createHash("sha256").update(payload).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function encodeKeySegments(key: string) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function amazonTimestamps(now: Date) {
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function signingKey(secretAccessKey: string, dateStamp: string, region: string, service = SERVICE) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), "aws4_request");
}

export type SignedRequest = { url: string; headers: Record<string, string> };

export function signObjectRequest(input: {
  config: ObjectStorageConfig;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  key: string;
  payload: Uint8Array | string;
  now: Date;
}): SignedRequest {
  const { config, method, key, payload, now } = input;
  const { amzDate, dateStamp } = amazonTimestamps(now);
  const host = new URL(config.endpoint).host;
  const canonicalUri = config.forcePathStyle
    ? `/${config.bucket}/${encodeKeySegments(key)}`
    : `/${encodeKeySegments(key)}`;
  const url = config.forcePathStyle
    ? `${config.endpoint}${canonicalUri}`
    : `${new URL(config.endpoint).protocol}//${config.bucket}.${host}${canonicalUri}`;
  const requestHost = config.forcePathStyle ? host : `${config.bucket}.${host}`;
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: requestHost,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = `${signedHeaderNames.map((name) => `${name}:${headers[name]}`).join("\n")}\n`;
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region)).update(stringToSign).digest("hex");
  return {
    url,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export function objectKey(config: ObjectStorageConfig, tenantId: string, storageName: string, staged: boolean) {
  const segments = [config.prefix, "documents", tenantId, staged ? "staging" : "stored", storageName].filter(Boolean);
  return segments.join("/");
}

async function send(config: ObjectStorageConfig, method: "GET" | "PUT" | "DELETE", key: string, body?: Uint8Array) {
  const payload = body ?? "";
  const signed = signObjectRequest({ config, method, key, payload, now: new Date() });
  const response = await fetch(signed.url, {
    method,
    headers: body ? { ...signed.headers, "Content-Length": String(body.byteLength) } : signed.headers,
    body: body ? Buffer.from(body) : undefined,
  });
  return response;
}

export class ObjectStorageError extends Error {
  constructor(public readonly status: number, operation: string) {
    super(`Object storage ${operation} failed with status ${status}.`);
    this.name = "ObjectStorageError";
  }
}

export async function putObject(config: ObjectStorageConfig, key: string, bytes: Uint8Array) {
  const response = await send(config, "PUT", key, bytes);
  if (!response.ok) throw new ObjectStorageError(response.status, "upload");
}

export async function getObject(config: ObjectStorageConfig, key: string) {
  const response = await send(config, "GET", key);
  if (!response.ok) throw new ObjectStorageError(response.status, "download");
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(config: ObjectStorageConfig, key: string) {
  const response = await send(config, "DELETE", key);
  if (!response.ok && response.status !== 404) throw new ObjectStorageError(response.status, "delete");
}

export async function copyObject(config: ObjectStorageConfig, sourceKey: string, targetKey: string) {
  const bytes = await getObject(config, sourceKey);
  await putObject(config, targetKey, bytes);
}

import assert from "node:assert/strict";
import test from "node:test";

import { objectKey, signObjectRequest, signingKey } from "../lib/documents/s3-driver";
import { readObjectStorageConfig, resolveDocumentStorageMode } from "../lib/documents/storage-config";

const EXAMPLE_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OBJECT = "22222222-2222-4222-8222-222222222222";

const s3Environment = {
  SISPL_DOCUMENT_STORAGE: "s3",
  SISPL_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  SISPL_S3_BUCKET: "sispl-documents",
  SISPL_S3_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  SISPL_S3_SECRET_ACCESS_KEY: EXAMPLE_SECRET,
};

test("document storage mode defaults to local and rejects unknown modes", () => {
  assert.equal(resolveDocumentStorageMode({}), "local");
  assert.equal(resolveDocumentStorageMode({ SISPL_DOCUMENT_STORAGE: "  LOCAL " }), "local");
  assert.equal(resolveDocumentStorageMode({ SISPL_DOCUMENT_STORAGE: "s3" }), "s3");
  assert.throws(() => resolveDocumentStorageMode({ SISPL_DOCUMENT_STORAGE: "dropbox" }), /must be either local or s3/);
});

test("object storage configuration requires every credential and never defaults them", () => {
  for (const missing of ["SISPL_S3_ENDPOINT", "SISPL_S3_BUCKET", "SISPL_S3_ACCESS_KEY_ID", "SISPL_S3_SECRET_ACCESS_KEY"]) {
    const environment = { ...s3Environment, [missing]: "" };
    assert.throws(() => readObjectStorageConfig(environment), new RegExp(missing));
  }
  const config = readObjectStorageConfig(s3Environment);
  assert.equal(config.endpoint, "https://account.r2.cloudflarestorage.com");
  assert.equal(config.region, "auto");
  assert.equal(config.forcePathStyle, true);
  assert.equal(config.prefix, "");
});

test("object storage configuration rejects plaintext http except on a local endpoint", () => {
  assert.throws(() => readObjectStorageConfig({ ...s3Environment, SISPL_S3_ENDPOINT: "http://storage.example.com" }), /only use http for a local endpoint/);
  assert.doesNotThrow(() => readObjectStorageConfig({ ...s3Environment, SISPL_S3_ENDPOINT: "http://localhost:9000" }));
  assert.throws(() => readObjectStorageConfig({ ...s3Environment, SISPL_S3_ENDPOINT: "not a url" }), /valid URL/);
  assert.throws(() => readObjectStorageConfig({ ...s3Environment, SISPL_S3_BUCKET: "Invalid_Bucket" }), /valid bucket name/);
  assert.throws(() => readObjectStorageConfig({ ...s3Environment, SISPL_S3_PREFIX: "../escape" }), /may only contain/);
});

test("signing key derivation matches the published AWS Signature Version 4 test vector", () => {
  const derived = signingKey(EXAMPLE_SECRET, "20120215", "us-east-1", "iam").toString("hex");
  assert.equal(derived, "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
});

test("object keys separate staged and stored objects per tenant and honour the prefix", () => {
  const config = readObjectStorageConfig(s3Environment);
  assert.equal(objectKey(config, TENANT, OBJECT, false), `documents/${TENANT}/stored/${OBJECT}`);
  assert.equal(objectKey(config, TENANT, OBJECT, true), `documents/${TENANT}/staging/${OBJECT}`);
  const prefixed = readObjectStorageConfig({ ...s3Environment, SISPL_S3_PREFIX: "/firm-a/" });
  assert.equal(objectKey(prefixed, TENANT, OBJECT, false), `firm-a/documents/${TENANT}/stored/${OBJECT}`);
});

test("signed requests carry the payload hash, scoped credential, and sorted signed headers", () => {
  const config = readObjectStorageConfig(s3Environment);
  const signed = signObjectRequest({
    config,
    method: "PUT",
    key: objectKey(config, TENANT, OBJECT, false),
    payload: new Uint8Array([1, 2, 3]),
    now: new Date("2026-08-17T09:30:00Z"),
  });
  assert.equal(signed.url, `https://account.r2.cloudflarestorage.com/sispl-documents/documents/${TENANT}/stored/${OBJECT}`);
  assert.equal(signed.headers["x-amz-date"], "20260817T093000Z");
  assert.equal(signed.headers["x-amz-content-sha256"], "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  assert.match(signed.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260817\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.ok(!signed.headers.Authorization.includes(EXAMPLE_SECRET));
});

test("virtual-host style addressing moves the bucket into the request host", () => {
  const config = readObjectStorageConfig({ ...s3Environment, SISPL_S3_FORCE_PATH_STYLE: "false" });
  const signed = signObjectRequest({ config, method: "GET", key: "documents/a/stored/b", payload: "", now: new Date("2026-08-17T09:30:00Z") });
  assert.equal(signed.url, "https://sispl-documents.account.r2.cloudflarestorage.com/documents/a/stored/b");
  assert.equal(signed.headers.host, "sispl-documents.account.r2.cloudflarestorage.com");
});

test("identical requests sign deterministically and diverge when any input changes", () => {
  const config = readObjectStorageConfig(s3Environment);
  const at = new Date("2026-08-17T09:30:00Z");
  const request = { config, method: "GET" as const, key: "documents/a/stored/b", payload: "", now: at };
  assert.equal(signObjectRequest(request).headers.Authorization, signObjectRequest(request).headers.Authorization);
  assert.notEqual(
    signObjectRequest(request).headers.Authorization,
    signObjectRequest({ ...request, key: "documents/a/stored/c" }).headers.Authorization,
  );
  assert.notEqual(
    signObjectRequest(request).headers.Authorization,
    signObjectRequest({ ...request, now: new Date("2026-08-18T09:30:00Z") }).headers.Authorization,
  );
});

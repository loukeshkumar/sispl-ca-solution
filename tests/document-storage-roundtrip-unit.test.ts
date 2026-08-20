import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

const TENANT = randomUUID();
const objects = new Map<string, Buffer>();
const requests: Array<{ method: string; url: string; authorization: string }> = [];
let server: Server;
let storage: typeof import("../lib/documents/storage");

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const key = decodeURIComponent(request.url ?? "");
      requests.push({ method: request.method ?? "", url: key, authorization: request.headers.authorization ?? "" });
      if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") || !request.headers["x-amz-content-sha256"]) {
        response.writeHead(403).end();
        return;
      }
      if (request.method === "PUT") {
        objects.set(key, Buffer.concat(chunks));
        response.writeHead(200).end();
      } else if (request.method === "GET") {
        const stored = objects.get(key);
        if (!stored) response.writeHead(404).end();
        else response.writeHead(200, { "Content-Length": String(stored.byteLength) }).end(stored);
      } else if (request.method === "DELETE") {
        objects.delete(key);
        response.writeHead(204).end();
      } else {
        response.writeHead(405).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.SISPL_DOCUMENT_STORAGE = "s3";
  process.env.SISPL_S3_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.SISPL_S3_BUCKET = "sispl-documents";
  process.env.SISPL_S3_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
  process.env.SISPL_S3_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
  storage = await import("../lib/documents/storage");
  storage.resetDocumentStorageConfig();
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  for (const key of ["SISPL_DOCUMENT_STORAGE", "SISPL_S3_ENDPOINT", "SISPL_S3_BUCKET", "SISPL_S3_ACCESS_KEY_ID", "SISPL_S3_SECRET_ACCESS_KEY"]) {
    delete process.env[key];
  }
  storage.resetDocumentStorageConfig();
});

test("object storage completes the staged upload lifecycle and every request is signed", async () => {
  const bytes = Buffer.from("SISPL confidential working paper");
  const staged = await storage.stageDocumentFile(TENANT, bytes);
  assert.match(staged.sha256, /^[0-9a-f]{64}$/);
  assert.ok(objects.has(`/sispl-documents/documents/${TENANT}/staging/${staged.storageName}`));

  await storage.commitStagedDocument(TENANT, staged.storageName);
  assert.ok(objects.has(`/sispl-documents/documents/${TENANT}/stored/${staged.storageName}`));
  assert.ok(!objects.has(`/sispl-documents/documents/${TENANT}/staging/${staged.storageName}`), "committing must remove the staged object");

  const readBack = await storage.readDocumentFile(TENANT, staged.storageName);
  assert.deepEqual(Buffer.from(readBack), bytes);

  await storage.removeDocumentFile(TENANT, staged.storageName);
  assert.equal(objects.size, 0);
  assert.ok(requests.length >= 5);
  assert.ok(requests.every((entry) => entry.authorization.startsWith("AWS4-HMAC-SHA256 ")), "every object request must be signed");
});

test("discarding a staged upload removes it without promoting it", async () => {
  const staged = await storage.stageDocumentFile(TENANT, Buffer.from("abandoned upload"));
  await storage.removeStagedDocument(TENANT, staged.storageName);
  assert.equal(objects.size, 0);
});

test("object storage rejects malformed tenant and document references before any request", async () => {
  const before = requests.length;
  await assert.rejects(() => storage.readDocumentFile("../etc", "22222222-2222-4222-8222-222222222222"), /Invalid tenant storage reference/);
  await assert.rejects(() => storage.readDocumentFile(TENANT, "../../secret"), /Invalid document storage reference/);
  assert.equal(requests.length, before, "invalid references must never reach the network");
});

test("missing objects surface as a storage error rather than an empty download", async () => {
  await assert.rejects(() => storage.readDocumentFile(TENANT, randomUUID()), /status 404/);
});

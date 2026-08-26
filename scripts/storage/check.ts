import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { readObjectStorageConfig, resolveDocumentStorageMode } from "../../lib/documents/storage-config";
import { commitStagedDocument, readDocumentFile, removeDocumentFile, stageDocumentFile } from "../../lib/documents/storage";

export async function checkDocumentStorage() {
  const mode = resolveDocumentStorageMode(process.env);
  if (mode === "local") {
    console.log("Document storage: local filesystem (.data/documents)");
    console.log("Set SISPL_DOCUMENT_STORAGE=s3 to use private object storage.");
    return;
  }
  const config = readObjectStorageConfig(process.env);
  console.log(`Document storage: s3 at ${new URL(config.endpoint).host}`);
  console.log(`Bucket: ${config.bucket} · region: ${config.region} · path style: ${config.forcePathStyle}`);
  const tenantId = randomUUID();
  const probe = Buffer.from(`sispl-storage-check-${Date.now()}`);
  const staged = await stageDocumentFile(tenantId, probe);
  await commitStagedDocument(tenantId, staged.storageName);
  const readBack = await readDocumentFile(tenantId, staged.storageName);
  const identical = Buffer.from(readBack).equals(probe);
  await removeDocumentFile(tenantId, staged.storageName);
  console.log(identical ? "Round trip: stage, commit, read, delete all succeeded." : "Round trip FAILED: the stored bytes did not match.");
  if (!identical) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkDocumentStorage().catch((error) => {
    console.error("Document storage check failed.", { errorType: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "" });
    process.exitCode = 1;
  });
}

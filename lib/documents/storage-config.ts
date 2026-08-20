type Environment = Record<string, string | undefined>;

export type DocumentStorageMode = "local" | "s3";

export type ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
};

export function resolveDocumentStorageMode(env: Environment): DocumentStorageMode {
  const mode = env.SISPL_DOCUMENT_STORAGE?.trim().toLowerCase();
  if (!mode || mode === "local") return "local";
  if (mode === "s3") return "s3";
  throw new Error("SISPL_DOCUMENT_STORAGE must be either local or s3.");
}

function required(env: Environment, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when SISPL_DOCUMENT_STORAGE=s3.`);
  return value;
}

export function readObjectStorageConfig(env: Environment): ObjectStorageConfig {
  const rawEndpoint = required(env, "SISPL_S3_ENDPOINT");
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("SISPL_S3_ENDPOINT must be a valid URL.");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("SISPL_S3_ENDPOINT must use the http or https protocol.");
  }
  if (endpoint.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(endpoint.hostname)) {
    throw new Error("SISPL_S3_ENDPOINT may only use http for a local endpoint.");
  }
  const bucket = required(env, "SISPL_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("SISPL_S3_BUCKET must be a valid bucket name.");
  }
  const prefix = env.SISPL_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (prefix && (!/^[A-Za-z0-9._\-/]{1,120}$/.test(prefix) || prefix.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))) {
    throw new Error("SISPL_S3_PREFIX may only contain letters, digits, dot, dash, underscore, and slash, and cannot contain relative segments.");
  }
  return {
    endpoint: `${endpoint.protocol}//${endpoint.host}`,
    bucket,
    region: env.SISPL_S3_REGION?.trim() || "auto",
    accessKeyId: required(env, "SISPL_S3_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "SISPL_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: (env.SISPL_S3_FORCE_PATH_STYLE?.trim().toLowerCase() ?? "true") !== "false",
    prefix,
  };
}

const DEFAULT_MAX_MODEL_BYTES = 250 * 1024 * 1024;
const DEFAULT_USER_HEADER = "x-forwarded-user";
const DEFAULT_USER_ID = "local";
const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const S3_ENV_NAMES = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] as const;

export type BackendEnv = {
  databaseUrl: string;
  s3: S3Env | null;
  maxModelBytes: number;
};

export type S3Env = {
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
};

export type KnowledgeEnv = {
  openAiApiKey: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chatModel: string;
};

const DISABLED_S3_VALUES = new Set(["disabled", "false", "none", "off"]);

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function readRequiredEnv(name: string) {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }

  return value;
}

function readPositiveIntegerEnv(name: string, defaultValue: number) {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

export function getBackendEnv(): BackendEnv {
  return {
    databaseUrl: getDatabaseUrl(),
    s3: getOptionalS3Env(),
    maxModelBytes: readPositiveIntegerEnv("COREY_MAX_MODEL_BYTES", DEFAULT_MAX_MODEL_BYTES),
  };
}

export function getDatabaseUrl() {
  return readRequiredEnv("DATABASE_URL");
}

export function getOptionalKnowledgeEnv(): KnowledgeEnv | null {
  const openAiApiKey = readOptionalEnv("OPENAI_API_KEY");
  if (!openAiApiKey) return null;
  return {
    openAiApiKey,
    embeddingModel: readOptionalEnv("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    embeddingDimensions: readPositiveIntegerEnv("OPENAI_EMBEDDING_DIMENSIONS", 1536),
    chatModel: readOptionalEnv("OPENAI_CHAT_MODEL") ?? "gpt-5.4-mini",
  };
}

export function getKnowledgeEnv(): KnowledgeEnv {
  const env = getOptionalKnowledgeEnv();
  if (!env) throw new Error("OPENAI_API_KEY is not set. See .env.example.");
  if (env.embeddingDimensions !== 1536) {
    throw new Error("OPENAI_EMBEDDING_DIMENSIONS must be 1536 for the current pgvector schema.");
  }
  return env;
}

export function getS3Env(): S3Env {
  const env = getOptionalS3Env();
  if (!env) {
    throw new Error(
      "S3 storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET to enable server-backed model files.",
    );
  }

  return env;
}

export function getOptionalS3Env(): S3Env | null {
  const s3Endpoint = readOptionalEnv("S3_ENDPOINT");
  if (!s3Endpoint || isDisabledS3Value(s3Endpoint)) {
    return null;
  }

  const values = {
    S3_ENDPOINT: s3Endpoint,
    S3_ACCESS_KEY: readOptionalEnv("S3_ACCESS_KEY"),
    S3_SECRET_KEY: readOptionalEnv("S3_SECRET_KEY"),
    S3_BUCKET: readOptionalEnv("S3_BUCKET"),
  };

  if (Object.values(values).some((value) => value !== null && isDisabledS3Value(value))) {
    return null;
  }

  const missing = S3_ENV_NAMES.filter((name) => values[name] === null);
  if (missing.length > 0) {
    throw new Error(`S3 storage configuration is incomplete. Missing: ${missing.join(", ")}.`);
  }

  return {
    s3Endpoint: values.S3_ENDPOINT!,
    s3Region: readOptionalEnv("S3_REGION") ?? "ap-southeast-1",
    s3AccessKey: values.S3_ACCESS_KEY!,
    s3SecretKey: values.S3_SECRET_KEY!,
    s3Bucket: values.S3_BUCKET!,
  };
}

function isDisabledS3Value(value: string) {
  const normalized = value.trim().toLowerCase();
  return DISABLED_S3_VALUES.has(normalized) || normalized.includes("disabled.invalid");
}

export function isS3StorageConfigured(env: S3Env | null | undefined): boolean {
  if (!env) {
    return false;
  }

  return ![
    env.s3Endpoint,
    env.s3AccessKey,
    env.s3SecretKey,
    env.s3Bucket,
  ].some(isDisabledS3Value);
}

export function getMaxModelBytes() {
  return readPositiveIntegerEnv("COREY_MAX_MODEL_BYTES", DEFAULT_MAX_MODEL_BYTES);
}

// Lower-cased name of the request header a trusted reverse proxy injects to
// identify the user. The proxy MUST strip any client-supplied value and set its
// own, or the identity is spoofable.
export function getUserHeaderName() {
  const raw = process.env.COREY_USER_HEADER;
  const value = raw?.trim().toLowerCase();
  return value && value.length > 0 ? value : DEFAULT_USER_HEADER;
}

// User id assumed when the identity header is absent — keeps single-tenant /
// local-dev (no proxy) working as one implicit user.
export function getDefaultUserId() {
  const raw = process.env.COREY_DEFAULT_USER;
  const value = raw?.trim();
  return value && value.length > 0 ? value : DEFAULT_USER_ID;
}

export function getMcpAdminUserIds() {
  const configured = process.env.COREY_MCP_ADMIN_USERS;
  return (configured?.split(",") ?? [getDefaultUserId()])
    .map((value) => value.trim().toLowerCase().replace(/[^a-z0-9._@-]/g, "").slice(0, 200))
    .filter(Boolean);
}

// When true, requests without an identity header are rejected (401) instead of
// falling back to the default user.
export function isUserRequired() {
  const raw = process.env.COREY_REQUIRE_USER;
  return raw ? TRUTHY_VALUES.has(raw.trim().toLowerCase()) : false;
}

// Externally hosted documentation site. When set, /docs requests redirect here
// instead of serving the bundled docs (e.g. https://coreyifc.com/docs). The
// trailing slash is trimmed so callers can append a path suffix. Returns null
// when unset, leaving the bundled docs in place.
export function getDocsExternalUrl() {
  const value = process.env.DOCS_EXTERNAL_URL?.trim().replace(/\/+$/, "");
  return value && value.length > 0 ? value : null;
}

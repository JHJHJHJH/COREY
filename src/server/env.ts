const DEFAULT_MAX_MODEL_BYTES = 250 * 1024 * 1024;

export type BackendEnv = {
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  maxModelBytes: number;
};

export type S3Env = Pick<
  BackendEnv,
  "s3Endpoint" | "s3Region" | "s3AccessKey" | "s3SecretKey" | "s3Bucket"
>;

const DISABLED_S3_VALUES = new Set(["disabled", "false", "none", "off"]);

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
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
    ...getS3Env(),
    maxModelBytes: readPositiveIntegerEnv("COREY_MAX_MODEL_BYTES", DEFAULT_MAX_MODEL_BYTES),
  };
}

export function getDatabaseUrl() {
  return readRequiredEnv("DATABASE_URL");
}

export function getS3Env(): S3Env {
  return {
    s3Endpoint: readRequiredEnv("S3_ENDPOINT"),
    s3Region: process.env.S3_REGION || "ap-southeast-1",
    s3AccessKey: readRequiredEnv("S3_ACCESS_KEY"),
    s3SecretKey: readRequiredEnv("S3_SECRET_KEY"),
    s3Bucket: readRequiredEnv("S3_BUCKET"),
  };
}

function isDisabledS3Value(value: string) {
  const normalized = value.trim().toLowerCase();
  return DISABLED_S3_VALUES.has(normalized) || normalized.includes("disabled.invalid");
}

export function isS3StorageConfigured(env: S3Env): boolean {
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

import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config();

function asNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function asBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readMediaKey() {
  const configured = process.env.MEDIA_ENCRYPTION_KEY_BASE64;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length === 32) return key;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("MEDIA_ENCRYPTION_KEY_BASE64 must be a base64-encoded 32-byte key in production");
  }

  return crypto.createHash("sha256").update("development-media-key").digest();
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  appName: process.env.APP_NAME || "SELF-HOST-SIGNAL-MESSENGER",
  publicAppUrl: process.env.PUBLIC_APP_URL || "http://localhost:3000",
  port: asNumber("API_PORT", 4000),
  trustProxy: asBoolean("TRUST_PROXY", false),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL || "postgres://self_host_signal:change-this-database-password@localhost:5432/self_host_signal_messenger",
  bcryptCost: asNumber("BCRYPT_COST", 12),
  sessionTtlHours: asNumber("SESSION_TTL_HOURS", 168),
  loginRateLimitMax: asNumber("LOGIN_RATE_LIMIT_MAX", 8),
  registerRateLimitMax: asNumber("REGISTER_RATE_LIMIT_MAX", 8),
  messageRateLimitMax: asNumber("MESSAGE_RATE_LIMIT_MAX", 120),
  mediaRoot: process.env.MEDIA_ROOT || "./media",
  mediaSigningSecret: process.env.MEDIA_SIGNING_SECRET || "development-media-signing-secret",
  mediaEncryptionKey: readMediaKey(),
  maxUploadBytes: asNumber("MAX_UPLOAD_BYTES", 52_428_800),
  signedMediaUrlTtlSeconds: asNumber("SIGNED_MEDIA_URL_TTL_SECONDS", 300),
  videoCompressionCrf: asNumber("VIDEO_COMPRESSION_CRF", 28),
  allowTrustedMediaProcessing: asBoolean("ALLOW_TRUSTED_MEDIA_PROCESSING", false),
  cleanupIntervalSeconds: asNumber("CLEANUP_INTERVAL_SECONDS", 300),
  orphanMediaRetentionHours: asNumber("ORPHAN_MEDIA_RETENTION_HOURS", 24),
  httpsOnly: asBoolean("HTTPS_ONLY", false)
};

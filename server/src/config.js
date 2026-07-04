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

function readFirst(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function splitCsv(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  appName: process.env.APP_NAME || "Chat X",
  version: process.env.APP_VERSION || process.env.npm_package_version || "0.1.0",
  publicAppUrl: readFirst(["APP_PUBLIC_URL", "PUBLIC_APP_URL"], "http://localhost:3000"),
  apiPublicUrl: readFirst(["API_PUBLIC_URL"], readFirst(["APP_PUBLIC_URL", "PUBLIC_APP_URL"], "http://localhost:3000")),
  port: asNumber("API_PORT", 4000),
  trustProxy: asBoolean("TRUST_PROXY", false),
  allowedOrigins: [
    ...splitCsv(process.env.ALLOWED_ORIGINS),
    ...splitCsv(process.env.CORS_ORIGIN),
    readFirst(["APP_PUBLIC_URL", "PUBLIC_APP_URL"], "http://localhost:3000"),
    readFirst(["API_PUBLIC_URL"], "")
  ].filter(Boolean),
  allowCloudflareTempTunnels: asBoolean("ALLOW_CLOUDFLARE_TEMP_TUNNELS", false),
  cookieSecureAuto: asBoolean("COOKIE_SECURE_AUTO", true),
  cookieSameSite: readFirst(["COOKIE_SAMESITE"], "lax").toLowerCase(),
  databaseUrl: process.env.DATABASE_URL || "postgres://chat_x:change-this-database-password@localhost:5432/chat_x",
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
  httpsOnly: asBoolean("HTTPS_ONLY", false),
  qrLoginTtlSeconds: asNumber("QR_LOGIN_TTL_SECONDS", 120),
  stunUrls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302").split(",").map((value) => value.trim()).filter(Boolean),
  turnUrls: (process.env.TURN_URLS || "").split(",").map((value) => value.trim()).filter(Boolean),
  turnUsername: process.env.TURN_USERNAME || "",
  turnCredential: process.env.TURN_CREDENTIAL || ""
};

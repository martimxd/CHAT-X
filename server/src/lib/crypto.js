import crypto from "node:crypto";
import { config } from "../config.js";

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqualHex(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function encryptForStorage(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", config.mediaEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext,
    envelope: {
      algorithm: "AES-256-GCM",
      iv: iv.toString("base64"),
      tag: tag.toString("base64")
    }
  };
}

export function decryptFromStorage(buffer, envelope) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    config.mediaEncryptionKey,
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

export function signMediaUrl({ mediaId, userId, expiresAt }) {
  const payload = `${mediaId}.${userId}.${expiresAt}`;
  return crypto.createHmac("sha256", config.mediaSigningSecret).update(payload).digest("base64url");
}

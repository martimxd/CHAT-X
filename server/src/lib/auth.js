import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { query } from "../db.js";
import { randomToken, sha256Hex } from "./crypto.js";
import { apiError } from "./validators.js";

const PUBLIC_FORCED_CHANGE_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/forced-change"
]);

export async function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptCost);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId, userAgent) {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
  await query(
    `INSERT INTO user_sessions (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, userAgent || null, expiresAt]
  );
  return { token, expiresAt };
}

export async function destroySession(token) {
  if (!token) return;
  await query("DELETE FROM user_sessions WHERE token_hash = $1", [sha256Hex(token)]);
}

export async function loadSession(token) {
  if (!token) return null;
  const result = await query(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       u.id,
       u.username,
       u.display_name,
       u.is_admin,
       u.is_first_admin,
       u.must_change_credentials,
       u.is_banned,
       u.is_disabled,
       u.language,
       u.show_read_receipts,
       u.show_online_status,
       u.default_disappearing_seconds,
       u.public_key_jwk,
       u.encrypted_private_key_jwk,
       u.avatar_media_id
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256Hex(token)]
  );
  if (result.rowCount === 0) return null;
  await query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [result.rows[0].session_id]);
  await query("UPDATE users SET last_seen_at = now() WHERE id = $1", [result.rows[0].id]);
  return result.rows[0];
}

export function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    isAdmin: user.is_admin,
    isFirstAdmin: user.is_first_admin,
    mustChangeCredentials: user.must_change_credentials,
    language: user.language,
    showReadReceipts: user.show_read_receipts,
    showOnlineStatus: user.show_online_status,
    defaultDisappearingSeconds: user.default_disappearing_seconds,
    hasKeyBundle: Boolean(user.public_key_jwk && user.encrypted_private_key_jwk),
    publicKeyJwk: user.public_key_jwk,
    encryptedPrivateKeyJwk: user.encrypted_private_key_jwk,
    avatarMediaId: user.avatar_media_id
  };
}

export function requireAuth(options = {}) {
  const { allowMustChange = false } = options;
  return async (req, res, next) => {
    const auth = req.header("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
    const user = await loadSession(token);

    if (!user) {
      return apiError(res, 401, "not_authenticated");
    }
    if (user.is_banned || user.is_disabled) {
      return apiError(res, 403, "account_unavailable");
    }
    if (user.must_change_credentials && !allowMustChange && !PUBLIC_FORCED_CHANGE_PATHS.has(req.path)) {
      return apiError(res, 423, "credentials_change_required");
    }

    req.authToken = token;
    req.user = user;
    return next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return apiError(res, 403, "admin_required");
  }
  return next();
}

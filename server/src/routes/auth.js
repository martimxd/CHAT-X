import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { createSession, destroySession, hashPassword, requireAuth, serializeUser, verifyPassword } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { asyncHandler } from "../lib/http.js";
import { apiError, parseBody, passwordSchema, usernameSchema } from "../lib/validators.js";

export const authRouter = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false
});

authRouter.post(
  "/login",
  loginLimiter,
  parseBody(z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) })),
  asyncHandler(async (req, res) => {
    const { username, password } = req.validatedBody;
    const result = await query("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
    if (result.rowCount === 0) return apiError(res, 401, "invalid_credentials");

    const user = result.rows[0];
    if (user.is_banned || user.is_disabled) return apiError(res, 403, "account_unavailable");
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return apiError(res, 401, "invalid_credentials");

    const session = await createSession(user.id, req.header("user-agent"), { ipAddress: req.ip });
    return res.json({ token: session.token, expiresAt: session.expiresAt, user: serializeUser(user) });
  })
);

authRouter.post(
  "/qr/request",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + config.qrLoginTtlSeconds * 1000);
    await query(
      `INSERT INTO qr_login_requests (token_hash, token_prefix, requester_user_agent, requester_ip, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sha256Hex(token), token.slice(0, 8), req.header("user-agent") || null, req.ip || null, expiresAt]
    );
    return res.status(201).json({
      token,
      expiresAt,
      ttlSeconds: config.qrLoginTtlSeconds,
      requester: {
        userAgent: req.header("user-agent") || "",
        ipAddress: req.ip || ""
      }
    });
  })
);

authRouter.get(
  "/qr/status/:token",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const tokenHash = sha256Hex(req.params.token);
    const outcome = await withTransaction(async (client) => {
      const request = await client.query("SELECT * FROM qr_login_requests WHERE token_hash = $1 FOR UPDATE", [tokenHash]);
      if (request.rowCount === 0) return { status: "missing" };
      const row = request.rows[0];
      if (row.expires_at.getTime() <= Date.now() && row.status === "pending") {
        await client.query("UPDATE qr_login_requests SET status = 'expired' WHERE id = $1", [row.id]);
        return { status: "expired" };
      }
      if (row.consumed_at) return { status: "consumed" };
      if (row.status !== "approved") return { status: row.status, expiresAt: row.expires_at };
      await client.query("UPDATE qr_login_requests SET consumed_at = now() WHERE id = $1", [row.id]);
      return { status: "approved", userId: row.approved_by };
    });
    if (outcome.status === "missing") return apiError(res, 404, "qr_login_not_found");
    if (outcome.status !== "approved") return res.json(outcome);

    const userResult = await query("SELECT * FROM users WHERE id = $1 AND is_banned = false AND is_disabled = false", [outcome.userId]);
    if (userResult.rowCount === 0) return apiError(res, 403, "account_unavailable");
    const session = await createSession(outcome.userId, req.header("user-agent"), { deviceName: "QR login browser", ipAddress: req.ip });
    return res.json({ status: "approved", token: session.token, expiresAt: session.expiresAt, user: serializeUser(userResult.rows[0]) });
  })
);

authRouter.post(
  "/qr/approve",
  requireAuth(),
  parseBody(z.object({
    token: z.string().min(16).max(256),
    approve: z.boolean()
  })),
  asyncHandler(async (req, res) => {
    const tokenHash = sha256Hex(req.validatedBody.token);
    const result = await query(
      `UPDATE qr_login_requests
       SET status = $1,
           approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END
       WHERE token_hash = $3
         AND status = 'pending'
         AND expires_at > now()
       RETURNING id, requester_user_agent, requester_ip::text AS requester_ip, expires_at, status`,
      [req.validatedBody.approve ? "approved" : "denied", req.user.id, tokenHash]
    );
    if (result.rowCount === 0) return apiError(res, 404, "qr_login_not_found");
    return res.json({
      request: {
        id: result.rows[0].id,
        requesterUserAgent: result.rows[0].requester_user_agent,
        requesterIp: result.rows[0].requester_ip,
        expiresAt: result.rows[0].expires_at,
        status: result.rows[0].status
      }
    });
  })
);

authRouter.get(
  "/me",
  requireAuth({ allowMustChange: true }),
  asyncHandler(async (req, res) => {
    return res.json({ user: serializeUser(req.user) });
  })
);

authRouter.post(
  "/logout",
  requireAuth({ allowMustChange: true }),
  asyncHandler(async (req, res) => {
    await destroySession(req.authToken);
    return res.status(204).end();
  })
);

authRouter.post(
  "/forced-change",
  requireAuth({ allowMustChange: true }),
  parseBody(z.object({ username: usernameSchema, password: passwordSchema })),
  asyncHandler(async (req, res) => {
    if (!req.user.must_change_credentials) return apiError(res, 400, "forced_change_not_required");
    const { username, password } = req.validatedBody;
    const duplicate = await query("SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2", [username, req.user.id]);
    if (duplicate.rowCount > 0) return apiError(res, 409, "username_taken");

    const passwordHash = await hashPassword(password);
    const result = await query(
      `UPDATE users
       SET username = $1,
           password_hash = $2,
           display_name = CASE WHEN display_name = 'Administrator' THEN $1 ELSE display_name END,
           must_change_credentials = false,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [username, passwordHash, req.user.id]
    );
    await audit(req.user.id, "forced_credentials_changed", "user", req.user.id, { username });
    return res.json({ user: serializeUser(result.rows[0]) });
  })
);

authRouter.put(
  "/key-bundle",
  requireAuth(),
  parseBody(z.object({
    publicKeyJwk: z.record(z.any()),
    encryptedPrivateKeyJwk: z.record(z.any())
  })),
  asyncHandler(async (req, res) => {
    const result = await query(
      `UPDATE users
       SET public_key_jwk = $1,
           encrypted_private_key_jwk = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [req.validatedBody.publicKeyJwk, req.validatedBody.encryptedPrivateKeyJwk, req.user.id]
    );
    return res.json({ user: serializeUser(result.rows[0]) });
  })
);

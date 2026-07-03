import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import { createSession, destroySession, hashPassword, requireAuth, serializeUser, verifyPassword } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
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

    const session = await createSession(user.id, req.header("user-agent"));
    return res.json({ token: session.token, expiresAt: session.expiresAt, user: serializeUser(user) });
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

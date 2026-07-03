import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { hashPassword, serializeUser } from "../lib/auth.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { asyncHandler } from "../lib/http.js";
import { apiError, parseBody, passwordSchema, usernameSchema } from "../lib/validators.js";

export const registerRouter = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.registerRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false
});

registerRouter.get(
  "/invites/:token",
  registerLimiter,
  asyncHandler(async (req, res) => {
    const tokenHash = sha256Hex(req.params.token);
    const result = await query(
      `SELECT id, expires_at, max_uses, use_count, revoked_at
       FROM invite_links
       WHERE token_hash = $1`,
      [tokenHash]
    );
    if (result.rowCount === 0) return apiError(res, 404, "invite_invalid");
    const invite = result.rows[0];
    const active = !invite.revoked_at && new Date(invite.expires_at).getTime() > Date.now() && invite.use_count < invite.max_uses;
    return res.json({
      active,
      expiresAt: invite.expires_at,
      remainingUses: Math.max(0, invite.max_uses - invite.use_count)
    });
  })
);

registerRouter.post(
  "/register",
  registerLimiter,
  parseBody(z.object({
    token: z.string().min(16),
    username: usernameSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80).optional(),
    publicKeyJwk: z.record(z.any()),
    encryptedPrivateKeyJwk: z.record(z.any())
  })),
  asyncHandler(async (req, res) => {
    const { token, username, password, displayName, publicKeyJwk, encryptedPrivateKeyJwk } = req.validatedBody;
    const user = await withTransaction(async (client) => {
      const inviteResult = await client.query(
        `SELECT *
         FROM invite_links
         WHERE token_hash = $1
         FOR UPDATE`,
        [sha256Hex(token)]
      );
      if (inviteResult.rowCount === 0) {
        const error = new Error("invite_invalid");
        error.statusCode = 404;
        throw error;
      }
      const invite = inviteResult.rows[0];
      if (invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now() || invite.use_count >= invite.max_uses) {
        const error = new Error("invite_expired");
        error.statusCode = 410;
        throw error;
      }

      const duplicate = await client.query("SELECT id FROM users WHERE lower(username) = lower($1)", [username]);
      if (duplicate.rowCount > 0) {
        const error = new Error("username_taken");
        error.statusCode = 409;
        throw error;
      }

      const passwordHash = await hashPassword(password);
      const created = await client.query(
        `INSERT INTO users (
           username,
           password_hash,
           display_name,
           public_key_jwk,
           encrypted_private_key_jwk,
           language
         )
         VALUES ($1, $2, $3, $4, $5, 'en')
         RETURNING *`,
        [username, passwordHash, displayName || username, publicKeyJwk, encryptedPrivateKeyJwk]
      );
      await client.query("UPDATE invite_links SET use_count = use_count + 1 WHERE id = $1", [invite.id]);
      return created.rows[0];
    });

    return res.status(201).json({ user: serializeUser(user), recoveryNotice: "Store your password safely. The server cannot decrypt your private chat key bundle." });
  }),
  (error, req, res, next) => {
    if (error.statusCode) return apiError(res, error.statusCode, error.message);
    return next(error);
  }
);

export function createInviteToken() {
  return randomToken(32);
}

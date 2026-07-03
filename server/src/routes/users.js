import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { hashPassword, requireAuth, serializeUser, verifyPassword } from "../lib/auth.js";
import { asyncHandler, pickUserPublic } from "../lib/http.js";
import { apiError, languageSchema, parseBody, passwordSchema } from "../lib/validators.js";

export const usersRouter = express.Router();

usersRouter.use(requireAuth());

usersRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ users: [] });
    const result = await query(
      `SELECT *
       FROM users
       WHERE lower(username) LIKE lower($1)
         AND id <> $2
         AND is_banned = false
         AND is_disabled = false
       ORDER BY username ASC
       LIMIT 20`,
      [`%${q}%`, req.user.id]
    );
    return res.json({ users: result.rows.map(pickUserPublic) });
  })
);

usersRouter.patch(
  "/me",
  parseBody(z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    language: languageSchema.optional(),
    showReadReceipts: z.boolean().optional(),
    showOnlineStatus: z.boolean().optional(),
    defaultDisappearingSeconds: z.number().int().min(0).max(31_536_000).nullable().optional()
  })),
  asyncHandler(async (req, res) => {
    const nextDefaultDisappearingSeconds = Object.hasOwn(req.validatedBody, "defaultDisappearingSeconds")
      ? req.validatedBody.defaultDisappearingSeconds
      : req.user.default_disappearing_seconds;
    const result = await query(
      `UPDATE users
       SET display_name = coalesce($1, display_name),
           language = coalesce($2, language),
           show_read_receipts = coalesce($3, show_read_receipts),
           show_online_status = coalesce($4, show_online_status),
           default_disappearing_seconds = $5,
           updated_at = now()
       WHERE id = $6
       RETURNING *`,
      [
        req.validatedBody.displayName ?? null,
        req.validatedBody.language ?? null,
        req.validatedBody.showReadReceipts ?? null,
        req.validatedBody.showOnlineStatus ?? null,
        nextDefaultDisappearingSeconds ?? null,
        req.user.id
      ]
    );
    return res.json({ user: serializeUser(result.rows[0]) });
  })
);

usersRouter.post(
  "/me/password",
  parseBody(z.object({
    currentPassword: z.string().min(1).max(256),
    newPassword: passwordSchema,
    encryptedPrivateKeyJwk: z.record(z.any()).optional()
  })),
  asyncHandler(async (req, res) => {
    const userResult = await query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const ok = await verifyPassword(req.validatedBody.currentPassword, userResult.rows[0].password_hash);
    if (!ok) return apiError(res, 401, "invalid_credentials");
    const passwordHash = await hashPassword(req.validatedBody.newPassword);
    const result = await query(
      `UPDATE users
       SET password_hash = $1,
           encrypted_private_key_jwk = coalesce($2, encrypted_private_key_jwk),
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [passwordHash, req.validatedBody.encryptedPrivateKeyJwk ?? null, req.user.id]
    );
    return res.json({ user: serializeUser(result.rows[0]) });
  })
);

usersRouter.delete(
  "/me",
  parseBody(z.object({ confirmation: z.literal("DELETE") })),
  asyncHandler(async (req, res) => {
    if (req.user.is_first_admin) return apiError(res, 409, "first_admin_delete_blocked");
    await query(
      `UPDATE users
       SET username = 'deleted_' || replace(id::text, '-', ''),
           display_name = 'Deleted account',
           password_hash = '',
           is_disabled = true,
           public_key_jwk = NULL,
           encrypted_private_key_jwk = NULL,
           avatar_media_id = NULL,
           updated_at = now()
       WHERE id = $1`,
      [req.user.id]
    );
    await query("DELETE FROM user_sessions WHERE user_id = $1", [req.user.id]);
    return res.status(204).end();
  })
);

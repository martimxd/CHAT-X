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
      `SELECT u.*,
              n.nickname,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS blocked_by_me,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2) AS blocks_me
       FROM users u
       LEFT JOIN user_contact_nicknames n ON n.owner_user_id = $2 AND n.target_user_id = u.id
       WHERE lower(u.username) LIKE lower($1)
         AND u.id <> $2
         AND u.is_banned = false
         AND u.is_disabled = false
       ORDER BY u.username ASC
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
    theme: z.enum(["light", "dark", "system"]).optional(),
    notificationsEnabled: z.boolean().optional(),
    notificationPreviews: z.boolean().optional(),
    onlineVisibility: z.enum(["everyone", "contacts", "nobody"]).optional(),
    lastSeenVisibility: z.enum(["everyone", "contacts", "nobody"]).optional(),
    showTypingStatus: z.boolean().optional(),
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
           theme = coalesce($6, theme),
           notifications_enabled = coalesce($7, notifications_enabled),
           notification_previews = coalesce($8, notification_previews),
           online_visibility = coalesce($9, online_visibility),
           last_seen_visibility = coalesce($10, last_seen_visibility),
           show_typing_status = coalesce($11, show_typing_status),
           updated_at = now()
       WHERE id = $12
       RETURNING *`,
      [
        req.validatedBody.displayName ?? null,
        req.validatedBody.language ?? null,
        req.validatedBody.showReadReceipts ?? null,
        req.validatedBody.showOnlineStatus ?? null,
        nextDefaultDisappearingSeconds ?? null,
        req.validatedBody.theme ?? null,
        req.validatedBody.notificationsEnabled ?? null,
        req.validatedBody.notificationPreviews ?? null,
        req.validatedBody.onlineVisibility ?? null,
        req.validatedBody.lastSeenVisibility ?? null,
        req.validatedBody.showTypingStatus ?? null,
        req.user.id
      ]
    );
    return res.json({ user: serializeUser(result.rows[0]) });
  })
);

usersRouter.get(
  "/me/sessions",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT id, user_agent, device_name, ip_address::text AS ip_address, expires_at, created_at, last_seen_at, revoked_at
       FROM user_sessions
       WHERE user_id = $1
       ORDER BY last_seen_at DESC`,
      [req.user.id]
    );
    return res.json({
      sessions: result.rows.map((session) => ({
        id: session.id,
        userAgent: session.user_agent,
        deviceName: session.device_name,
        ipAddress: session.ip_address,
        expiresAt: session.expires_at,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
        revokedAt: session.revoked_at,
        current: session.id === req.user.session_id
      }))
    });
  })
);

usersRouter.delete(
  "/me/sessions/:id",
  asyncHandler(async (req, res) => {
    await query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    return res.json({ ok: true });
  })
);

usersRouter.get(
  "/me/blocks",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT u.*, b.created_at AS blocked_at, n.nickname
       FROM user_blocks b
       JOIN users u ON u.id = b.blocked_id
       LEFT JOIN user_contact_nicknames n ON n.owner_user_id = b.blocker_id AND n.target_user_id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    return res.json({ users: result.rows.map((row) => ({ ...pickUserPublic(row), blockedAt: row.blocked_at })) });
  })
);

usersRouter.post(
  "/:id/block",
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) return apiError(res, 400, "cannot_block_self");
    const target = await query("SELECT id FROM users WHERE id = $1 AND is_disabled = false", [req.params.id]);
    if (target.rowCount === 0) return apiError(res, 404, "user_not_found");
    await query(
      `INSERT INTO user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [req.user.id, req.params.id]
    );
    return res.json({ ok: true });
  })
);

usersRouter.delete(
  "/:id/block",
  asyncHandler(async (req, res) => {
    await query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [req.user.id, req.params.id]);
    return res.json({ ok: true });
  })
);

usersRouter.put(
  "/:id/nickname",
  parseBody(z.object({ nickname: z.string().trim().min(1).max(80) })),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) return apiError(res, 400, "cannot_nickname_self");
    const target = await query("SELECT id FROM users WHERE id = $1 AND is_disabled = false", [req.params.id]);
    if (target.rowCount === 0) return apiError(res, 404, "user_not_found");
    await query(
      `INSERT INTO user_contact_nicknames (owner_user_id, target_user_id, nickname)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_user_id, target_user_id)
       DO UPDATE SET nickname = excluded.nickname, updated_at = now()`,
      [req.user.id, req.params.id, req.validatedBody.nickname]
    );
    return res.json({ ok: true });
  })
);

usersRouter.delete(
  "/:id/nickname",
  asyncHandler(async (req, res) => {
    await query("DELETE FROM user_contact_nicknames WHERE owner_user_id = $1 AND target_user_id = $2", [req.user.id, req.params.id]);
    return res.json({ ok: true });
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

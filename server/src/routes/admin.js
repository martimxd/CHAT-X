import express from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import { hashPassword, requireAdmin, requireAuth } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { decryptFromStorage, encryptForStorage, randomToken, sha256Hex } from "../lib/crypto.js";
import { asyncHandler, pickUserPublic } from "../lib/http.js";
import { apiError, parseBody, passwordSchema, usernameSchema } from "../lib/validators.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth(), requireAdmin);

adminRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const [users, chats, messages, media, invites] = await Promise.all([
      query("SELECT count(*)::int AS total, count(*) FILTER (WHERE is_banned)::int AS banned, count(*) FILTER (WHERE is_disabled)::int AS disabled FROM users"),
      query("SELECT count(*)::int AS total, count(*) FILTER (WHERE type = 'group')::int AS groups FROM chats"),
      query("SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_for_everyone_at IS NOT NULL)::int AS deleted FROM messages"),
      query("SELECT count(*)::int AS total, coalesce(sum(byte_size),0)::bigint AS bytes FROM media_files WHERE deleted_at IS NULL"),
      query("SELECT count(*)::int AS total, count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now() AND use_count < max_uses)::int AS active FROM invite_links")
    ]);
    return res.json({
      users: users.rows[0],
      chats: chats.rows[0],
      messages: messages.rows[0],
      media: media.rows[0],
      invites: invites.rows[0]
    });
  })
);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const result = await query("SELECT * FROM users ORDER BY created_at DESC");
    return res.json({ users: result.rows.map(pickUserPublic) });
  })
);

adminRouter.post(
  "/users",
  parseBody(z.object({
    username: usernameSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80).optional(),
    isAdmin: z.boolean().optional()
  })),
  asyncHandler(async (req, res) => {
    const { username, password, displayName, isAdmin = false } = req.validatedBody;
    const duplicate = await query("SELECT id FROM users WHERE lower(username) = lower($1)", [username]);
    if (duplicate.rowCount > 0) return apiError(res, 409, "username_taken");
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (username, password_hash, display_name, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [username, passwordHash, displayName || username, isAdmin]
    );
    await audit(req.user.id, "user_created", "user", result.rows[0].id, { username, isAdmin });
    return res.status(201).json({ user: pickUserPublic(result.rows[0]) });
  })
);

adminRouter.patch(
  "/users/:id",
  parseBody(z.object({
    isBanned: z.boolean().optional(),
    isDisabled: z.boolean().optional(),
    isAdmin: z.boolean().optional()
  })),
  asyncHandler(async (req, res) => {
    const existing = await query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (existing.rowCount === 0) return apiError(res, 404, "user_not_found");
    const user = existing.rows[0];
    if (user.is_first_admin) {
      if (req.validatedBody.isAdmin === false || req.validatedBody.isDisabled === true || req.validatedBody.isBanned === true) {
        return apiError(res, 409, "first_admin_protected");
      }
    }

    const result = await query(
      `UPDATE users
       SET is_banned = coalesce($1, is_banned),
           is_disabled = coalesce($2, is_disabled),
           is_admin = coalesce($3, is_admin),
           updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [
        req.validatedBody.isBanned ?? null,
        req.validatedBody.isDisabled ?? null,
        req.validatedBody.isAdmin ?? null,
        req.params.id
      ]
    );
    await audit(req.user.id, "user_updated", "user", req.params.id, req.validatedBody);
    return res.json({ user: pickUserPublic(result.rows[0]) });
  })
);

adminRouter.get(
  "/invites",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT i.*, u.username AS created_by_username
       FROM invite_links i
       LEFT JOIN users u ON u.id = i.created_by
       ORDER BY i.created_at DESC`
    );
    return res.json({
      invites: result.rows.map((invite) => {
        let url = null;
        if (invite.token_ciphertext && invite.token_encryption) {
          try {
            const token = decryptFromStorage(invite.token_ciphertext, invite.token_encryption).toString("utf8");
            url = `${config.publicAppUrl}/invite/${token}`;
          } catch {
            url = null;
          }
        }
        return {
        id: invite.id,
        tokenPrefix: invite.token_prefix,
        createdBy: invite.created_by_username,
        url,
        expiresAt: invite.expires_at,
        maxUses: invite.max_uses,
        useCount: invite.use_count,
        revokedAt: invite.revoked_at,
        createdAt: invite.created_at,
        active: !invite.revoked_at && new Date(invite.expires_at).getTime() > Date.now() && invite.use_count < invite.max_uses
        };
      })
    });
  })
);

adminRouter.post(
  "/invites",
  parseBody(z.object({
    expiresAt: z.coerce.date(),
    maxUses: z.number().int().min(1).max(1000)
  })),
  asyncHandler(async (req, res) => {
    const { expiresAt, maxUses } = req.validatedBody;
    if (expiresAt.getTime() <= Date.now()) return apiError(res, 400, "invite_expiration_in_past");
    if (expiresAt.getTime() > Date.now() + 31 * 24 * 60 * 60 * 1000) return apiError(res, 400, "invite_expiration_too_long");
    const token = randomToken(32);
    const tokenPrefix = token.slice(0, 8);
    const encryptedToken = encryptForStorage(Buffer.from(token, "utf8"));
    const result = await query(
      `INSERT INTO invite_links (token_hash, token_prefix, token_ciphertext, token_encryption, created_by, expires_at, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [sha256Hex(token), tokenPrefix, encryptedToken.ciphertext, encryptedToken.envelope, req.user.id, expiresAt, maxUses]
    );
    await audit(req.user.id, "invite_created", "invite", result.rows[0].id, { expiresAt, maxUses });
    return res.status(201).json({
      invite: {
        id: result.rows[0].id,
        token,
        url: `${config.publicAppUrl}/invite/${token}`,
        expiresAt: result.rows[0].expires_at,
        maxUses: result.rows[0].max_uses,
        useCount: result.rows[0].use_count,
        active: true
      }
    });
  })
);

adminRouter.post(
  "/invites/:id/revoke",
  asyncHandler(async (req, res) => {
    const result = await query("UPDATE invite_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING *", [req.params.id]);
    if (result.rowCount === 0) return apiError(res, 404, "invite_not_found");
    await audit(req.user.id, "invite_revoked", "invite", req.params.id);
    return res.json({ ok: true });
  })
);

adminRouter.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT l.*, u.username AS actor_username
       FROM admin_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_id
       ORDER BY l.created_at DESC
       LIMIT 100`
    );
    return res.json({ logs: result.rows });
  })
);

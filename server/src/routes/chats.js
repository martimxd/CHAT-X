import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { deleteMediaIfUnreferenced } from "../lib/media.js";
import { asyncHandler, pickUserPublic } from "../lib/http.js";
import { apiError, parseBody } from "../lib/validators.js";

export const chatsRouter = express.Router();

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.messageRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false
});

chatsRouter.use(requireAuth());

async function requireMember(req, res, next) {
  const result = await query(
    "SELECT * FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [req.params.chatId || req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return apiError(res, 403, "chat_access_denied");
  req.chatMember = result.rows[0];
  return next();
}

async function loadChatPayload(chatId, userId) {
  const chat = await query("SELECT * FROM chats WHERE id = $1", [chatId]);
  if (chat.rowCount === 0) return null;
  const members = await query(
    `SELECT u.*, cm.role, cm.joined_at, cm.last_read_at, cm.deleted_at, ck.encrypted_key
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN chat_member_keys ck ON ck.chat_id = cm.chat_id AND ck.user_id = cm.user_id
     WHERE cm.chat_id = $1
     ORDER BY cm.joined_at ASC`,
    [chatId]
  );
  const key = await query("SELECT encrypted_key FROM chat_member_keys WHERE chat_id = $1 AND user_id = $2", [chatId, userId]);
  return {
    chat: {
      id: chat.rows[0].id,
      type: chat.rows[0].type,
      name: chat.rows[0].name,
      avatarMediaId: chat.rows[0].avatar_media_id,
      disappearingSeconds: chat.rows[0].disappearing_seconds,
      pinnedMessageId: chat.rows[0].pinned_message_id,
      createdAt: chat.rows[0].created_at,
      updatedAt: chat.rows[0].updated_at,
      members: members.rows.map((row) => ({
        ...pickUserPublic(row),
        role: row.role,
        joinedAt: row.joined_at,
        lastReadAt: row.last_read_at,
        deletedAt: row.deleted_at,
        encryptedKey: row.encrypted_key
      })),
      encryptedKey: key.rows[0]?.encrypted_key || null
    }
  };
}

chatsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT c.*,
              ck.encrypted_key,
              lm.id AS latest_message_id,
              lm.message_type AS latest_message_type,
              lm.media_id AS latest_media_id,
              lm.encrypted_payload AS latest_encrypted_payload,
              lm.created_at AS latest_created_at,
              lm.deleted_for_everyone_at AS latest_deleted_for_everyone_at,
              (
                SELECT count(*)::int
                FROM messages unread
                WHERE unread.chat_id = c.id
                  AND unread.sender_id IS DISTINCT FROM $1
                  AND unread.deleted_for_everyone_at IS NULL
                  AND unread.created_at > coalesce(cm.last_read_at, cm.joined_at)
                  AND NOT EXISTS (
                    SELECT 1 FROM message_deletions md WHERE md.message_id = unread.id AND md.user_id = $1
                  )
              ) AS unread_count
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       LEFT JOIN chat_member_keys ck ON ck.chat_id = c.id AND ck.user_id = $1
       LEFT JOIN LATERAL (
         SELECT *
         FROM messages m
         WHERE m.chat_id = c.id
           AND NOT EXISTS (
             SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = $1
           )
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON true
       WHERE cm.user_id = $1 AND cm.deleted_at IS NULL
       ORDER BY coalesce(lm.created_at, c.updated_at) DESC`,
      [req.user.id]
    );
    return res.json({
      chats: result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        avatarMediaId: row.avatar_media_id,
        disappearingSeconds: row.disappearing_seconds,
        pinnedMessageId: row.pinned_message_id,
        encryptedKey: row.encrypted_key,
        latestMessage: row.latest_message_id ? {
          id: row.latest_message_id,
          messageType: row.latest_message_type,
          mediaId: row.latest_media_id,
          encryptedPayload: row.latest_encrypted_payload,
          deletedForEveryoneAt: row.latest_deleted_for_everyone_at,
          createdAt: row.latest_created_at
        } : null,
        unreadCount: row.unread_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  })
);

chatsRouter.post(
  "/direct",
  parseBody(z.object({ username: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    const otherResult = await query(
      "SELECT * FROM users WHERE lower(username) = lower($1) AND is_banned = false AND is_disabled = false",
      [req.validatedBody.username]
    );
    if (otherResult.rowCount === 0) return apiError(res, 404, "user_not_found");
    const other = otherResult.rows[0];
    if (other.id === req.user.id) return apiError(res, 400, "cannot_message_self");
    const directKey = [req.user.id, other.id].sort().join(":");

    const chatId = await withTransaction(async (client) => {
      const chat = await client.query(
        `INSERT INTO chats (type, created_by, direct_key)
         VALUES ('direct', $1, $2)
         ON CONFLICT (direct_key) DO UPDATE SET updated_at = chats.updated_at
         RETURNING id`,
        [req.user.id, directKey]
      );
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'member'), ($1, $3, 'member')
         ON CONFLICT (chat_id, user_id) DO UPDATE SET deleted_at = NULL`,
        [chat.rows[0].id, req.user.id, other.id]
      );
      return chat.rows[0].id;
    });

    const payload = await loadChatPayload(chatId, req.user.id);
    return res.status(201).json(payload);
  })
);

chatsRouter.post(
  "/groups",
  parseBody(z.object({
    name: z.string().trim().min(1).max(80),
    usernames: z.array(z.string().trim().min(1).max(64)).max(100).default([]),
    disappearingSeconds: z.number().int().min(0).max(31_536_000).nullable().optional()
  })),
  asyncHandler(async (req, res) => {
    const uniqueUsernames = [...new Set(req.validatedBody.usernames.map((value) => value.toLowerCase()))];
    const chatId = await withTransaction(async (client) => {
      const chat = await client.query(
        `INSERT INTO chats (type, name, created_by, disappearing_seconds)
         VALUES ('group', $1, $2, $3)
         RETURNING id`,
        [req.validatedBody.name, req.user.id, req.validatedBody.disappearingSeconds || null]
      );
      await client.query("INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, 'admin')", [chat.rows[0].id, req.user.id]);
      if (uniqueUsernames.length > 0) {
        const users = await client.query(
          "SELECT id FROM users WHERE lower(username) = ANY($1) AND is_banned = false AND is_disabled = false",
          [uniqueUsernames]
        );
        for (const user of users.rows) {
          if (user.id !== req.user.id) {
            await client.query(
              "INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
              [chat.rows[0].id, user.id]
            );
          }
        }
      }
      return chat.rows[0].id;
    });
    const payload = await loadChatPayload(chatId, req.user.id);
    return res.status(201).json(payload);
  })
);

chatsRouter.get(
  "/:id",
  requireMember,
  asyncHandler(async (req, res) => {
    const payload = await loadChatPayload(req.params.id, req.user.id);
    if (!payload) return apiError(res, 404, "chat_not_found");
    return res.json(payload);
  })
);

chatsRouter.patch(
  "/:id",
  requireMember,
  parseBody(z.object({
    name: z.string().trim().min(1).max(80).optional(),
    disappearingSeconds: z.number().int().min(0).max(31_536_000).nullable().optional()
  })),
  asyncHandler(async (req, res) => {
    if (req.chatMember.role !== "admin") return apiError(res, 403, "chat_admin_required");
    const existing = await query("SELECT disappearing_seconds FROM chats WHERE id = $1", [req.params.id]);
    const nextDisappearingSeconds = Object.hasOwn(req.validatedBody, "disappearingSeconds")
      ? req.validatedBody.disappearingSeconds
      : existing.rows[0]?.disappearing_seconds;
    const result = await query(
      `UPDATE chats
       SET name = coalesce($1, name),
           disappearing_seconds = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [req.validatedBody.name ?? null, nextDisappearingSeconds ?? null, req.params.id]
    );
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    return res.json({ chat: result.rows[0] });
  })
);

chatsRouter.post(
  "/:id/keys",
  requireMember,
  parseBody(z.object({
    keys: z.array(z.object({
      userId: z.string().uuid(),
      encryptedKey: z.record(z.any())
    })).min(1).max(200)
  })),
  asyncHandler(async (req, res) => {
    const ids = req.validatedBody.keys.map((key) => key.userId);
    const members = await query("SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id = ANY($2) AND deleted_at IS NULL", [req.params.id, ids]);
    const allowed = new Set(members.rows.map((row) => row.user_id));
    for (const key of req.validatedBody.keys) {
      if (!allowed.has(key.userId)) return apiError(res, 400, "key_target_not_member");
      await query(
        `INSERT INTO chat_member_keys (chat_id, user_id, encrypted_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (chat_id, user_id)
         DO UPDATE SET encrypted_key = excluded.encrypted_key, updated_at = now()`,
        [req.params.id, key.userId, key.encryptedKey]
      );
    }
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:keys-updated", { chatId: req.params.id });
    return res.json({ ok: true });
  })
);

chatsRouter.get(
  "/:id/messages",
  requireMember,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT m.*,
              u.username,
              u.display_name,
              u.avatar_media_id,
              mf.original_name AS media_original_name,
              mf.mime_type AS media_mime_type,
              mf.byte_size AS media_byte_size,
              mf.encrypted_blob AS media_encrypted_blob,
              mf.metadata AS media_metadata,
              mf.created_at AS media_created_at
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN media_files mf ON mf.id = m.media_id AND mf.deleted_at IS NULL
       WHERE m.chat_id = $1
         AND (m.expires_at IS NULL OR m.expires_at > now() OR m.deleted_for_everyone_at IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = $2
         )
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.params.id, req.user.id]
    );
    return res.json({
      messages: result.rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        senderUsername: row.username,
        senderDisplayName: row.display_name,
        replyToId: row.reply_to_id,
        mediaId: row.media_id,
        media: row.media_id ? {
          id: row.media_id,
          filename: row.media_original_name,
          mimeType: row.media_mime_type,
          size: row.media_byte_size === null ? null : Number(row.media_byte_size),
          encryptedBlob: row.media_encrypted_blob,
          metadata: row.media_metadata,
          createdAt: row.media_created_at
        } : null,
        messageType: row.message_type,
        encryptedPayload: row.encrypted_payload,
        payloadVersion: row.payload_version,
        expiresAt: row.expires_at,
        deletedForEveryoneAt: row.deleted_for_everyone_at,
        clientId: row.client_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        editedAt: row.edited_at
      }))
    });
  })
);

chatsRouter.post(
  "/:id/messages",
  requireMember,
  messageLimiter,
  parseBody(z.object({
    encryptedPayload: z.record(z.any()),
    messageType: z.enum(["text", "image", "video", "audio", "file"]),
    mediaId: z.string().uuid().nullable().optional(),
    replyToId: z.string().uuid().nullable().optional(),
    clientId: z.string().max(120).optional()
  })),
  asyncHandler(async (req, res) => {
    const chat = await query("SELECT disappearing_seconds FROM chats WHERE id = $1", [req.params.id]);
    const disappearingSeconds = chat.rows[0]?.disappearing_seconds || req.user.default_disappearing_seconds;
    const result = await query(
      `INSERT INTO messages (
         chat_id,
         sender_id,
         reply_to_id,
         media_id,
         message_type,
         encrypted_payload,
         expires_at,
         client_id
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         CASE WHEN $7::integer IS NULL OR $7::integer = 0 THEN NULL ELSE now() + ($7::text || ' seconds')::interval END,
         $8
       )
       RETURNING *`,
      [
        req.params.id,
        req.user.id,
        req.validatedBody.replyToId || null,
        req.validatedBody.mediaId || null,
        req.validatedBody.messageType,
        req.validatedBody.encryptedPayload,
        disappearingSeconds || null,
        req.validatedBody.clientId || null
      ]
    );
    await query("UPDATE chats SET updated_at = now() WHERE id = $1", [req.params.id]);
    const message = result.rows[0];
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("message:new", { chatId: req.params.id, message });
    return res.status(201).json({ message });
  })
);

chatsRouter.patch(
  "/:chatId/messages/:messageId",
  requireMember,
  parseBody(z.object({ encryptedPayload: z.record(z.any()) })),
  asyncHandler(async (req, res) => {
    const existing = await query(
      "SELECT * FROM messages WHERE id = $1 AND chat_id = $2 AND sender_id = $3 AND deleted_for_everyone_at IS NULL",
      [req.params.messageId, req.params.chatId, req.user.id]
    );
    if (existing.rowCount === 0) return apiError(res, 404, "message_not_found");
    await query(
      "INSERT INTO message_revisions (message_id, editor_id, encrypted_payload) VALUES ($1, $2, $3)",
      [req.params.messageId, req.user.id, existing.rows[0].encrypted_payload]
    );
    const result = await query(
      `UPDATE messages
       SET encrypted_payload = $1,
           edited_at = now(),
           updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [req.validatedBody.encryptedPayload, req.params.messageId]
    );
    req.app.get("io")?.to(`chat:${req.params.chatId}`).emit("message:updated", { chatId: req.params.chatId, message: result.rows[0] });
    return res.json({ message: result.rows[0] });
  })
);

chatsRouter.delete(
  "/:chatId/messages/:messageId",
  requireMember,
  parseBody(z.object({ scope: z.enum(["me", "everyone"]) })),
  asyncHandler(async (req, res) => {
    if (req.validatedBody.scope === "me") {
      await query(
        `INSERT INTO message_deletions (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [req.params.messageId, req.user.id]
      );
      return res.json({ ok: true });
    }

    const existing = await query("SELECT * FROM messages WHERE id = $1 AND chat_id = $2", [req.params.messageId, req.params.chatId]);
    if (existing.rowCount === 0) return apiError(res, 404, "message_not_found");
    if (existing.rows[0].sender_id !== req.user.id && req.chatMember.role !== "admin") {
      return apiError(res, 403, "message_delete_denied");
    }

    const mediaId = existing.rows[0].media_id;
    const result = await query(
      `UPDATE messages
       SET encrypted_payload = NULL,
           media_id = NULL,
           deleted_for_everyone_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.messageId]
    );
    await query("DELETE FROM message_revisions WHERE message_id = $1", [req.params.messageId]);
    await deleteMediaIfUnreferenced(mediaId);
    req.app.get("io")?.to(`chat:${req.params.chatId}`).emit("message:deleted", { chatId: req.params.chatId, messageId: req.params.messageId });
    return res.json({ message: result.rows[0] });
  })
);

chatsRouter.post(
  "/:id/read",
  requireMember,
  asyncHandler(async (req, res) => {
    await query("UPDATE chat_members SET last_read_at = now() WHERE chat_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    if (req.user.show_read_receipts) {
      req.app.get("io")?.to(`chat:${req.params.id}`).emit("message:read", { chatId: req.params.id, userId: req.user.id, readAt: new Date().toISOString() });
    }
    return res.json({ ok: true });
  })
);

chatsRouter.post(
  "/:id/pin",
  requireMember,
  parseBody(z.object({ messageId: z.string().uuid().nullable() })),
  asyncHandler(async (req, res) => {
    if (req.chatMember.role !== "admin") return apiError(res, 403, "chat_admin_required");
    await query("UPDATE chats SET pinned_message_id = $1, updated_at = now() WHERE id = $2", [req.validatedBody.messageId, req.params.id]);
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    return res.json({ ok: true });
  })
);

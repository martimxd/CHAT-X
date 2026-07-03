import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { deleteMediaIfUnreferenced } from "../lib/media.js";
import { isUserOnline } from "../lib/presence.js";
import { asyncHandler, pickUserPublic } from "../lib/http.js";
import { directChatPeer, permissionAllows, userBlockedTarget, usersAreBlocked } from "../lib/social.js";
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
  const chat = await query("SELECT * FROM chats WHERE id = $1 AND archived_at IS NULL", [chatId]);
  if (chat.rowCount === 0) return null;
  const members = await query(
    `SELECT u.*, cm.role, cm.joined_at, cm.last_read_at, cm.deleted_at, ck.encrypted_key,
            n.nickname,
            EXISTS (
              SELECT 1
              FROM chats dc
              JOIN chat_members a ON a.chat_id = dc.id AND a.user_id = $2 AND a.deleted_at IS NULL
              JOIN chat_members b ON b.chat_id = dc.id AND b.user_id = u.id AND b.deleted_at IS NULL
              WHERE dc.type = 'direct' AND dc.archived_at IS NULL
            ) AS direct_contact,
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS blocked_by_me,
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2) AS blocks_me
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN chat_member_keys ck ON ck.chat_id = cm.chat_id AND ck.user_id = cm.user_id
     LEFT JOIN user_contact_nicknames n ON n.owner_user_id = $2 AND n.target_user_id = u.id
     WHERE cm.chat_id = $1
     ORDER BY cm.joined_at ASC`,
    [chatId, userId]
  );
  const key = await query("SELECT encrypted_key FROM chat_member_keys WHERE chat_id = $1 AND user_id = $2", [chatId, userId]);
  function canSee(row, field) {
    if (row.id === userId) return true;
    if (row.blocks_me) return false;
    const visibility = row[field] || "everyone";
    if (visibility === "everyone") return true;
    if (visibility === "contacts") return Boolean(row.direct_contact);
    return false;
  }

  return {
    chat: {
      id: chat.rows[0].id,
      type: chat.rows[0].type,
      name: chat.rows[0].name,
      avatarMediaId: chat.rows[0].avatar_media_id,
      ownerId: chat.rows[0].owner_id,
      archivedAt: chat.rows[0].archived_at,
      permissions: {
        send: chat.rows[0].send_permission,
        editInfo: chat.rows[0].edit_info_permission,
        addMembers: chat.rows[0].add_members_permission,
        changeImage: chat.rows[0].change_image_permission,
        startCalls: chat.rows[0].start_calls_permission
      },
      disappearingSeconds: chat.rows[0].disappearing_seconds,
      pinnedMessageId: chat.rows[0].pinned_message_id,
      createdAt: chat.rows[0].created_at,
      updatedAt: chat.rows[0].updated_at,
      members: members.rows.map((row) => {
        const canSeeOnline = row.show_online_status !== false && canSee(row, "online_visibility");
        const canSeeLastSeen = canSee(row, "last_seen_visibility");
        return {
          ...pickUserPublic(row),
          online: canSeeOnline ? isUserOnline(row.id) : false,
          lastSeenAt: canSeeLastSeen ? row.last_seen_at : null,
          role: row.role,
          joinedAt: row.joined_at,
          lastReadAt: row.last_read_at,
          deletedAt: row.deleted_at,
          encryptedKey: row.encrypted_key
        };
      }),
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
              peer.id AS peer_id,
              peer.username AS peer_username,
              peer.display_name AS peer_display_name,
              peer.avatar_media_id AS peer_avatar_media_id,
              peer.last_seen_at AS peer_last_seen_at,
              peer.show_online_status AS peer_show_online_status,
              peer.online_visibility AS peer_online_visibility,
              peer.last_seen_visibility AS peer_last_seen_visibility,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = peer.id) AS peer_blocked_by_me,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = peer.id AND b.blocked_id = $1) AS peer_blocks_me,
              peer_nick.nickname AS peer_nickname,
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
         SELECT u.*
         FROM chat_members pcm
         JOIN users u ON u.id = pcm.user_id
         WHERE pcm.chat_id = c.id
           AND pcm.user_id <> $1
           AND pcm.deleted_at IS NULL
         ORDER BY pcm.joined_at ASC
         LIMIT 1
       ) peer ON c.type = 'direct'
       LEFT JOIN user_contact_nicknames peer_nick ON peer_nick.owner_user_id = $1 AND peer_nick.target_user_id = peer.id
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
       WHERE cm.user_id = $1 AND cm.deleted_at IS NULL AND c.archived_at IS NULL
       ORDER BY coalesce(lm.created_at, c.updated_at) DESC`,
      [req.user.id]
    );
    return res.json({
      chats: result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        avatarMediaId: row.avatar_media_id,
        ownerId: row.owner_id,
        directPeer: row.peer_id ? {
          id: row.peer_id,
          username: row.peer_username,
          displayName: row.peer_display_name,
          avatarMediaId: row.peer_avatar_media_id,
          nickname: row.peer_nickname,
          blockedByMe: row.peer_blocked_by_me,
          blocksMe: row.peer_blocks_me,
          online: row.peer_show_online_status !== false && !row.peer_blocks_me && row.peer_online_visibility !== "nobody" ? isUserOnline(row.peer_id) : false,
          lastSeenAt: !row.peer_blocks_me && row.peer_last_seen_visibility !== "nobody" ? row.peer_last_seen_at : null
        } : null,
        permissions: {
          send: row.send_permission,
          editInfo: row.edit_info_permission,
          addMembers: row.add_members_permission,
          changeImage: row.change_image_permission,
          startCalls: row.start_calls_permission
        },
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
    if (await usersAreBlocked(req.user.id, other.id)) return apiError(res, 403, "user_blocked");
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
        `INSERT INTO chats (type, name, created_by, owner_id, disappearing_seconds)
         VALUES ('group', $1, $2, $2, $3)
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
    const existing = await query("SELECT type, disappearing_seconds, edit_info_permission FROM chats WHERE id = $1 AND archived_at IS NULL", [req.params.id]);
    if (existing.rowCount === 0) return apiError(res, 404, "chat_not_found");
    if (existing.rows[0].type === "group" && !permissionAllows(existing.rows[0].edit_info_permission, req.chatMember.role)) {
      return apiError(res, 403, "group_permission_denied");
    }
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

chatsRouter.patch(
  "/:id/permissions",
  requireMember,
  parseBody(z.object({
    send: z.enum(["everyone", "admins"]).optional(),
    editInfo: z.enum(["everyone", "admins"]).optional(),
    addMembers: z.enum(["everyone", "admins"]).optional(),
    changeImage: z.enum(["everyone", "admins"]).optional(),
    startCalls: z.enum(["everyone", "admins"]).optional()
  })),
  asyncHandler(async (req, res) => {
    if (req.chatMember.role !== "admin") return apiError(res, 403, "chat_admin_required");
    const result = await query(
      `UPDATE chats
       SET send_permission = coalesce($1, send_permission),
           edit_info_permission = coalesce($2, edit_info_permission),
           add_members_permission = coalesce($3, add_members_permission),
           change_image_permission = coalesce($4, change_image_permission),
           start_calls_permission = coalesce($5, start_calls_permission),
           updated_at = now()
       WHERE id = $6 AND type = 'group' AND archived_at IS NULL
       RETURNING *`,
      [
        req.validatedBody.send ?? null,
        req.validatedBody.editInfo ?? null,
        req.validatedBody.addMembers ?? null,
        req.validatedBody.changeImage ?? null,
        req.validatedBody.startCalls ?? null,
        req.params.id
      ]
    );
    if (result.rowCount === 0) return apiError(res, 404, "chat_not_found");
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    return res.json({ chat: result.rows[0] });
  })
);

chatsRouter.post(
  "/:id/members",
  requireMember,
  parseBody(z.object({ usernames: z.array(z.string().trim().min(1).max(64)).min(1).max(100) })),
  asyncHandler(async (req, res) => {
    const chat = await query("SELECT type, add_members_permission FROM chats WHERE id = $1 AND archived_at IS NULL", [req.params.id]);
    if (chat.rowCount === 0 || chat.rows[0].type !== "group") return apiError(res, 404, "chat_not_found");
    if (!permissionAllows(chat.rows[0].add_members_permission, req.chatMember.role)) {
      return apiError(res, 403, "group_permission_denied");
    }
    const usernames = [...new Set(req.validatedBody.usernames.map((value) => value.toLowerCase()))];
    const users = await query(
      "SELECT id FROM users WHERE lower(username) = ANY($1) AND is_banned = false AND is_disabled = false",
      [usernames]
    );
    for (const user of users.rows) {
      if (user.id !== req.user.id) {
        await query(
          `INSERT INTO chat_members (chat_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT (chat_id, user_id) DO UPDATE SET deleted_at = NULL`,
          [req.params.id, user.id]
        );
      }
    }
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    return res.json(await loadChatPayload(req.params.id, req.user.id));
  })
);

chatsRouter.post(
  "/:id/members/:userId/promote",
  requireMember,
  asyncHandler(async (req, res) => {
    if (req.chatMember.role !== "admin") return apiError(res, 403, "chat_admin_required");
    const result = await query(
      `UPDATE chat_members
       SET role = 'admin'
       WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id, req.params.userId]
    );
    if (result.rowCount === 0) return apiError(res, 404, "user_not_found");
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    return res.json({ ok: true });
  })
);

chatsRouter.post(
  "/:id/members/:userId/demote",
  requireMember,
  asyncHandler(async (req, res) => {
    if (req.chatMember.role !== "admin") return apiError(res, 403, "chat_admin_required");
    const chat = await query("SELECT owner_id FROM chats WHERE id = $1 AND type = 'group' AND archived_at IS NULL", [req.params.id]);
    if (chat.rowCount === 0) return apiError(res, 404, "chat_not_found");
    if (chat.rows[0].owner_id === req.params.userId) return apiError(res, 409, "group_owner_protected");
    const admins = await query(
      "SELECT user_id FROM chat_members WHERE chat_id = $1 AND role = 'admin' AND deleted_at IS NULL",
      [req.params.id]
    );
    if (admins.rows.length <= 1 && admins.rows[0]?.user_id === req.params.userId) {
      return apiError(res, 409, "last_admin_transfer_required");
    }
    await query("UPDATE chat_members SET role = 'member' WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [req.params.id, req.params.userId]);
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    return res.json({ ok: true });
  })
);

chatsRouter.delete(
  "/:id/members/:userId",
  requireMember,
  asyncHandler(async (req, res) => {
    if (req.chatMember.role !== "admin") return apiError(res, 403, "chat_admin_required");
    const chat = await query("SELECT owner_id FROM chats WHERE id = $1 AND type = 'group' AND archived_at IS NULL", [req.params.id]);
    if (chat.rowCount === 0) return apiError(res, 404, "chat_not_found");
    if (chat.rows[0].owner_id === req.params.userId) return apiError(res, 409, "group_owner_protected");
    const target = await query("SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [req.params.id, req.params.userId]);
    if (target.rowCount === 0) return apiError(res, 404, "user_not_found");
    if (target.rows[0].role === "admin") {
      const admins = await query("SELECT count(*)::int AS count FROM chat_members WHERE chat_id = $1 AND role = 'admin' AND deleted_at IS NULL", [req.params.id]);
      if (admins.rows[0].count <= 1) return apiError(res, 409, "last_admin_transfer_required");
    }
    await query("UPDATE chat_members SET deleted_at = now() WHERE chat_id = $1 AND user_id = $2", [req.params.id, req.params.userId]);
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    req.app.get("io")?.to(`user:${req.params.userId}`).emit("chat:removed", { chatId: req.params.id });
    return res.json({ ok: true });
  })
);

chatsRouter.post(
  "/:id/leave",
  requireMember,
  parseBody(z.object({ transferToUserId: z.string().uuid().nullable().optional() })),
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const chat = await client.query("SELECT * FROM chats WHERE id = $1 AND type = 'group' AND archived_at IS NULL FOR UPDATE", [req.params.id]);
      if (chat.rowCount === 0) return { error: "chat_not_found" };
      const members = await client.query(
        "SELECT user_id, role FROM chat_members WHERE chat_id = $1 AND deleted_at IS NULL ORDER BY joined_at ASC",
        [req.params.id]
      );
      const activeMembers = members.rows;
      const admins = activeMembers.filter((member) => member.role === "admin");
      const current = activeMembers.find((member) => member.user_id === req.user.id);
      if (!current) return { error: "chat_access_denied" };

      if (current.role === "admin" && activeMembers.length > 1) {
        const otherAdmins = admins.filter((member) => member.user_id !== req.user.id);
        let transferTarget = req.validatedBody.transferToUserId || null;
        if (chat.rows[0].owner_id === req.user.id && !transferTarget) {
          transferTarget = otherAdmins[0]?.user_id || null;
        }
        if (otherAdmins.length === 0 && !transferTarget) return { error: "last_admin_transfer_required" };
        if (transferTarget) {
          const target = activeMembers.find((member) => member.user_id === transferTarget && member.user_id !== req.user.id);
          if (!target) return { error: "transfer_target_not_member" };
          await client.query("UPDATE chat_members SET role = 'admin' WHERE chat_id = $1 AND user_id = $2", [req.params.id, transferTarget]);
          if (chat.rows[0].owner_id === req.user.id) {
            await client.query("UPDATE chats SET owner_id = $1 WHERE id = $2", [transferTarget, req.params.id]);
          }
        }
      }

      await client.query("UPDATE chat_members SET deleted_at = now() WHERE chat_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
      const remaining = await client.query("SELECT count(*)::int AS count FROM chat_members WHERE chat_id = $1 AND deleted_at IS NULL", [req.params.id]);
      if (remaining.rows[0].count === 0) {
        await client.query("UPDATE chats SET archived_at = now(), updated_at = now() WHERE id = $1", [req.params.id]);
      }
      return { archived: remaining.rows[0].count === 0 };
    });
    if (result.error) return apiError(res, result.error === "chat_not_found" ? 404 : 409, result.error);
    req.app.get("io")?.to(`chat:${req.params.id}`).emit("chat:updated", { chatId: req.params.id });
    req.app.get("io")?.to(`user:${req.user.id}`).emit("chat:removed", { chatId: req.params.id });
    return res.json({ ok: true, archived: result.archived });
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
              mf.created_at AS media_created_at,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = m.sender_id) AS sender_blocked_by_me
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
        senderBlockedByMe: row.sender_blocked_by_me,
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

chatsRouter.get(
  "/:id/shared/:kind",
  requireMember,
  asyncHandler(async (req, res) => {
    const kind = req.params.kind;
    if (!["media", "files", "links", "gifs"].includes(kind)) return apiError(res, 404, "route_not_found");
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 60);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && Number.isNaN(before.getTime())) return apiError(res, 400, "validation_failed");

    let typeCondition = "m.message_type IN ('image', 'video')";
    if (kind === "files") typeCondition = "m.message_type = 'file'";
    if (kind === "links") typeCondition = "m.message_type = 'text'";
    if (kind === "gifs") {
      typeCondition = `(m.message_type = 'image' AND (
        lower(coalesce(mf.original_name, '')) LIKE '%.gif%'
        OR lower(coalesce(mf.metadata->>'originalMimeType', '')) = 'image/gif'
        OR lower(coalesce(mf.metadata->>'mediaKind', '')) = 'gif'
      ))`;
    }

    const result = await query(
      `SELECT m.id,
              m.chat_id,
              m.sender_id,
              m.message_type,
              m.encrypted_payload,
              m.created_at,
              u.username,
              u.display_name,
              mf.id AS media_id,
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
         AND m.deleted_for_everyone_at IS NULL
         AND (${typeCondition})
         AND ($2::timestamptz IS NULL OR m.created_at < $2::timestamptz)
         AND NOT EXISTS (
           SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = $3
         )
       ORDER BY m.created_at DESC
       LIMIT $4`,
      [req.params.id, before || null, req.user.id, limit]
    );
    return res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        senderUsername: row.username,
        senderDisplayName: row.display_name,
        messageType: row.message_type,
        encryptedPayload: row.encrypted_payload,
        createdAt: row.created_at,
        media: row.media_id ? {
          id: row.media_id,
          filename: row.media_original_name,
          mimeType: row.media_mime_type,
          size: row.media_byte_size === null ? null : Number(row.media_byte_size),
          encryptedBlob: row.media_encrypted_blob,
          metadata: row.media_metadata,
          createdAt: row.media_created_at
        } : null
      })),
      nextCursor: result.rows.length === limit ? result.rows[result.rows.length - 1].created_at : null,
      encryptedIndexing: kind === "links"
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
    const chat = await query(
      "SELECT type, disappearing_seconds, send_permission FROM chats WHERE id = $1 AND archived_at IS NULL",
      [req.params.id]
    );
    if (chat.rowCount === 0) return apiError(res, 404, "chat_not_found");
    if (chat.rows[0].type === "group" && !permissionAllows(chat.rows[0].send_permission, req.chatMember.role)) {
      return apiError(res, 403, "group_permission_denied");
    }
    if (chat.rows[0].type === "direct") {
      const peer = await directChatPeer(req.params.id, req.user.id);
      if (!peer) return apiError(res, 404, "chat_not_found");
      if (await userBlockedTarget(peer.id, req.user.id) || await userBlockedTarget(req.user.id, peer.id)) {
        return apiError(res, 403, "user_blocked");
      }
    }
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
      const chat = await query("SELECT type FROM chats WHERE id = $1", [req.params.id]);
      if (chat.rows[0]?.type === "direct") {
        const peer = await directChatPeer(req.params.id, req.user.id);
        if (peer && (await userBlockedTarget(peer.id, req.user.id) || await userBlockedTarget(req.user.id, peer.id))) {
          return res.json({ ok: true });
        }
      }
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

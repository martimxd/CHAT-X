import { Server } from "socket.io";
import { config } from "./config.js";
import { query } from "./db.js";
import { loadSession } from "./lib/auth.js";
import { incrementOnline, decrementOnline } from "./lib/presence.js";
import { directChatPeer, userBlockedTarget } from "./lib/social.js";

async function getUserChatIds(userId) {
  const result = await query("SELECT chat_id FROM chat_members WHERE user_id = $1 AND deleted_at IS NULL", [userId]);
  return result.rows.map((row) => row.chat_id);
}

async function isDirectContact(subjectId, viewerId) {
  const result = await query(
    `SELECT 1
     FROM chats c
     JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $1 AND a.deleted_at IS NULL
     JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $2 AND b.deleted_at IS NULL
     WHERE c.type = 'direct' AND c.archived_at IS NULL
     LIMIT 1`,
    [subjectId, viewerId]
  );
  return result.rowCount > 0;
}

async function canSeeDetail(subjectId, viewerId, visibility) {
  if (subjectId === viewerId) return true;
  if (await userBlockedTarget(subjectId, viewerId) || await userBlockedTarget(viewerId, subjectId)) return false;
  if (visibility === "everyone") return true;
  if (visibility === "contacts") return isDirectContact(subjectId, viewerId);
  return false;
}

async function chatRecipients(chatId, subjectId, visibility) {
  const result = await query(
    `SELECT user_id
     FROM chat_members
     WHERE chat_id = $1 AND user_id <> $2 AND deleted_at IS NULL`,
    [chatId, subjectId]
  );
  const allowed = [];
  for (const row of result.rows) {
    if (await canSeeDetail(subjectId, row.user_id, visibility)) allowed.push(row.user_id);
  }
  return allowed;
}

async function emitPresence(io, userId, chatIds, online) {
  const user = await query("SELECT online_visibility, show_online_status, last_seen_at FROM users WHERE id = $1", [userId]);
  if (user.rowCount === 0 || user.rows[0].show_online_status === false || user.rows[0].online_visibility === "nobody") return;
  for (const chatId of chatIds) {
    const recipients = await chatRecipients(chatId, userId, user.rows[0].online_visibility);
    for (const recipientId of recipients) {
      io.to(`user:${recipientId}`).emit("presence:changed", {
        chatId,
        userId,
        online,
        lastSeenAt: online ? null : user.rows[0].last_seen_at
      });
    }
  }
}

async function emitTyping(io, socket, chatId, isTyping) {
  if (socket.user.show_typing_status === false) return;
  const member = await query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [chatId, socket.user.id]);
  if (member.rowCount === 0) return;
  const recipients = await chatRecipients(chatId, socket.user.id, socket.user.online_visibility || "everyone");
  for (const recipientId of recipients) {
    io.to(`user:${recipientId}`).emit("typing", {
      chatId,
      userId: socket.user.id,
      userName: socket.user.display_name || socket.user.username,
      isTyping: Boolean(isTyping)
    });
  }
}

export function setupSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: config.corsOrigin,
      credentials: false
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = await loadSession(token);
      if (!user || user.must_change_credentials || user.is_banned || user.is_disabled) {
        return next(new Error("not_authenticated"));
      }
      socket.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user.id;
    const chatIds = await getUserChatIds(userId);
    socket.join(`user:${userId}`);
    for (const chatId of chatIds) socket.join(`chat:${chatId}`);

    const becameOnline = incrementOnline(userId);
    if (socket.user.show_online_status && becameOnline) {
      await emitPresence(io, userId, chatIds, true);
    }

    socket.on("chat:join", async ({ chatId }) => {
      const member = await query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [chatId, userId]);
      if (member.rowCount > 0) socket.join(`chat:${chatId}`);
    });

    socket.on("typing", async ({ chatId, isTyping }) => {
      await emitTyping(io, socket, chatId, isTyping);
    });

    socket.on("call:start", async ({ chatId, offer }) => {
      const chat = await query(
        `SELECT c.*
         FROM chats c
         JOIN chat_members cm ON cm.chat_id = c.id
         WHERE c.id = $1
           AND c.type = 'direct'
           AND c.archived_at IS NULL
           AND cm.user_id = $2
           AND cm.deleted_at IS NULL`,
        [chatId, userId]
      );
      if (chat.rowCount === 0) {
        socket.emit("call:error", { chatId, code: "chat_access_denied" });
        return;
      }
      const peer = await directChatPeer(chatId, userId);
      if (!peer) {
        socket.emit("call:error", { chatId, code: "user_not_found" });
        return;
      }
      if (await userBlockedTarget(peer.id, userId) || await userBlockedTarget(userId, peer.id)) {
        socket.emit("call:error", { chatId, code: "user_blocked" });
        return;
      }
      const call = await query(
        `INSERT INTO call_history (chat_id, caller_id, callee_id, status)
         VALUES ($1, $2, $3, 'started')
         RETURNING id, started_at`,
        [chatId, userId, peer.id]
      );
      io.to(`user:${peer.id}`).emit("call:incoming", {
        callId: call.rows[0].id,
        chatId,
        callerId: userId,
        callerName: socket.user.display_name || socket.user.username,
        offer,
        startedAt: call.rows[0].started_at
      });
      socket.emit("call:ringing", { callId: call.rows[0].id, chatId, calleeId: peer.id });
    });

    socket.on("call:answer", async ({ callId, chatId, callerId, answer }) => {
      await query("UPDATE call_history SET status = 'accepted', answered_at = now() WHERE id = $1 AND callee_id = $2", [callId, userId]);
      io.to(`user:${callerId}`).emit("call:answer", { callId, chatId, answer, calleeId: userId });
    });

    socket.on("call:ice", async ({ callId, chatId, targetUserId, candidate }) => {
      const member = await query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [chatId, userId]);
      if (member.rowCount > 0) io.to(`user:${targetUserId}`).emit("call:ice", { callId, chatId, fromUserId: userId, candidate });
    });

    socket.on("call:reject", async ({ callId, chatId, callerId }) => {
      await query("UPDATE call_history SET status = 'rejected', ended_at = now() WHERE id = $1 AND callee_id = $2", [callId, userId]);
      io.to(`user:${callerId}`).emit("call:rejected", { callId, chatId, calleeId: userId });
    });

    socket.on("call:end", async ({ callId, chatId, targetUserId }) => {
      await query(
        "UPDATE call_history SET status = CASE WHEN status = 'started' THEN 'missed' ELSE 'ended' END, ended_at = now() WHERE id = $1",
        [callId]
      );
      io.to(`user:${targetUserId}`).emit("call:ended", { callId, chatId, fromUserId: userId });
    });

    socket.on("disconnect", async () => {
      if (decrementOnline(userId) && socket.user.show_online_status) {
        await query("UPDATE users SET last_seen_at = now() WHERE id = $1", [userId]);
        const currentChatIds = await getUserChatIds(userId);
        await emitPresence(io, userId, currentChatIds, false);
      }
    });
  });

  return io;
}

import { Server } from "socket.io";
import { config } from "./config.js";
import { query } from "./db.js";
import { loadSession } from "./lib/auth.js";

const onlineUsers = new Map();

async function getUserChatIds(userId) {
  const result = await query("SELECT chat_id FROM chat_members WHERE user_id = $1 AND deleted_at IS NULL", [userId]);
  return result.rows.map((row) => row.chat_id);
}

function incrementOnline(userId) {
  const count = onlineUsers.get(userId) || 0;
  onlineUsers.set(userId, count + 1);
  return count === 0;
}

function decrementOnline(userId) {
  const count = onlineUsers.get(userId) || 0;
  if (count <= 1) {
    onlineUsers.delete(userId);
    return true;
  }
  onlineUsers.set(userId, count - 1);
  return false;
}

export function isUserOnline(userId) {
  return onlineUsers.has(userId);
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
      for (const chatId of chatIds) {
        io.to(`chat:${chatId}`).emit("presence:changed", { userId, online: true });
      }
    }

    socket.on("chat:join", async ({ chatId }) => {
      const member = await query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [chatId, userId]);
      if (member.rowCount > 0) socket.join(`chat:${chatId}`);
    });

    socket.on("typing", async ({ chatId, isTyping }) => {
      const member = await query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [chatId, userId]);
      if (member.rowCount > 0) {
        socket.to(`chat:${chatId}`).emit("typing", { chatId, userId, isTyping: Boolean(isTyping) });
      }
    });

    socket.on("disconnect", async () => {
      if (decrementOnline(userId) && socket.user.show_online_status) {
        const currentChatIds = await getUserChatIds(userId);
        for (const chatId of currentChatIds) {
          io.to(`chat:${chatId}`).emit("presence:changed", { userId, online: false });
        }
      }
    });
  });

  return io;
}

import { query } from "../db.js";

export async function getBlockBetween(userA, userB) {
  const result = await query(
    `SELECT blocker_id, blocked_id
     FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)`,
    [userA, userB]
  );
  return result.rows;
}

export async function usersAreBlocked(userA, userB) {
  const rows = await getBlockBetween(userA, userB);
  return rows.length > 0;
}

export async function userBlockedTarget(blockerId, blockedId) {
  const result = await query("SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [blockerId, blockedId]);
  return result.rowCount > 0;
}

export function permissionAllows(permission, memberRole) {
  return permission === "everyone" || memberRole === "admin";
}

export async function directChatPeer(chatId, userId) {
  const result = await query(
    `SELECT u.*
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = $1
       AND cm.user_id <> $2
       AND cm.deleted_at IS NULL
     LIMIT 1`,
    [chatId, userId]
  );
  return result.rows[0] || null;
}

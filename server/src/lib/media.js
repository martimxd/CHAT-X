import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { query } from "../db.js";

export async function ensureMediaRoot() {
  await fs.mkdir(config.mediaRoot, { recursive: true });
}

export function storagePathFor(mediaId) {
  return path.join(config.mediaRoot, `${mediaId}.bin`);
}

export async function safeDeleteFile(filePath) {
  const resolvedRoot = path.resolve(config.mediaRoot);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot)) {
    throw new Error("Refusing to delete a file outside MEDIA_ROOT");
  }
  await fs.rm(resolvedFile, { force: true });
}

export async function userCanAccessMedia(userId, mediaId) {
  const result = await query(
    `SELECT m.id
     FROM media_files m
     WHERE m.id = $1
       AND m.deleted_at IS NULL
       AND (
         m.purpose IN ('avatar', 'group_avatar')
         OR m.uploader_id = $2
         OR EXISTS (
           SELECT 1
           FROM messages msg
           JOIN chat_members cm ON cm.chat_id = msg.chat_id
           WHERE msg.media_id = m.id
             AND cm.user_id = $2
             AND cm.deleted_at IS NULL
         )
         OR EXISTS (
           SELECT 1
           FROM chat_members cm
           WHERE cm.chat_id = m.chat_id
             AND cm.user_id = $2
             AND cm.deleted_at IS NULL
         )
       )`,
    [mediaId, userId]
  );
  return result.rowCount > 0;
}

export async function deleteMediaIfUnreferenced(mediaId) {
  if (!mediaId) return false;
  const refs = await query("SELECT 1 FROM messages WHERE media_id = $1 LIMIT 1", [mediaId]);
  if (refs.rowCount > 0) return false;

  const result = await query("SELECT * FROM media_files WHERE id = $1 AND deleted_at IS NULL", [mediaId]);
  if (result.rowCount === 0) return false;
  await safeDeleteFile(result.rows[0].storage_path);
  await query("UPDATE media_files SET deleted_at = now() WHERE id = $1", [mediaId]);
  return true;
}

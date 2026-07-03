import { config } from "../config.js";
import { query } from "../db.js";
import { deleteMediaIfUnreferenced, safeDeleteFile } from "./media.js";

export async function runCleanupOnce() {
  const expired = await query(
    `WITH expired AS (
       SELECT id, media_id
       FROM messages
       WHERE expires_at IS NOT NULL
         AND expires_at <= now()
         AND deleted_for_everyone_at IS NULL
     ),
     updated AS (
       UPDATE messages m
       SET encrypted_payload = NULL,
           media_id = NULL,
           deleted_for_everyone_at = coalesce(deleted_for_everyone_at, now()),
           updated_at = now()
       FROM expired e
       WHERE m.id = e.id
       RETURNING m.id, e.media_id
     )
     SELECT * FROM updated`
  );

  for (const row of expired.rows) {
    await query("DELETE FROM message_revisions WHERE message_id = $1", [row.id]);
    await deleteMediaIfUnreferenced(row.media_id);
  }

  const orphaned = await query(
    `SELECT m.*
     FROM media_files m
     WHERE m.deleted_at IS NULL
       AND m.purpose = 'message'
       AND m.created_at < now() - ($1::text || ' hours')::interval
       AND NOT EXISTS (SELECT 1 FROM messages msg WHERE msg.media_id = m.id)`,
    [config.orphanMediaRetentionHours]
  );

  for (const media of orphaned.rows) {
    await safeDeleteFile(media.storage_path);
    await query("UPDATE media_files SET deleted_at = now() WHERE id = $1", [media.id]);
  }

  await query("DELETE FROM user_sessions WHERE expires_at <= now()");

  return {
    expiredMessages: expired.rowCount,
    orphanedMedia: orphaned.rowCount
  };
}

export function startCleanupJob() {
  const intervalMs = Math.max(30, config.cleanupIntervalSeconds) * 1000;
  const timer = setInterval(() => {
    runCleanupOnce().catch((error) => {
      console.error("Cleanup job failed", { message: error.message });
    });
  }, intervalMs);
  return timer;
}

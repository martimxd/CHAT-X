import { query } from "../db.js";

export async function audit(actorId, action, targetType, targetId = null, metadata = {}) {
  await query(
    `INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, targetType, targetId, metadata]
  );
}

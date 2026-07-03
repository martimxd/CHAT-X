import { query } from "./db.js";
import { hashPassword } from "./lib/auth.js";
import { audit } from "./lib/audit.js";

export async function ensureFirstAdmin() {
  const count = await query("SELECT count(*)::int AS count FROM users");
  if (count.rows[0].count > 0) return;

  const passwordHash = await hashPassword("admin");
  const result = await query(
    `INSERT INTO users (
       username,
       password_hash,
       display_name,
       is_admin,
       is_first_admin,
       must_change_credentials,
       language
     )
     VALUES ('admin', $1, 'Administrator', true, true, true, 'en')
     RETURNING id`,
    [passwordHash]
  );
  await audit(result.rows[0].id, "bootstrap_first_admin", "user", result.rows[0].id, { username: "admin" });
  console.info("Created default first admin account. Change it immediately after first login.");
}

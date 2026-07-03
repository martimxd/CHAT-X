import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(dirname, "../migrations");

export async function runMigrations() {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (applied.rowCount > 0) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await pool.query("COMMIT");
      console.info(`Applied migration ${file}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

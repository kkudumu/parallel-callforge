import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createDbClient } from "./client.js";
import { getEnv } from "../../config/env.js";

const MIGRATIONS_DIR = path.join(
  import.meta.dirname,
  "migrations"
);

async function migrate() {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const lockKey = 4_247_001;

  try {
    await db.query("SELECT pg_advisory_lock($1)", [lockKey]);

    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await db.query<{ name: string }>(
      "SELECT name FROM _migrations ORDER BY id"
    );
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`  applying: ${file}`);
      if (db.withTransaction) {
        await db.withTransaction(async (tx) => {
          await tx.query(sql);
          await tx.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        });
      } else {
        await db.query("BEGIN");
        try {
          await db.query(sql);
          await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
          await db.query("COMMIT");
        } catch (err) {
          await db.query("ROLLBACK");
          throw err;
        }
      }
      console.log(`  applied: ${file}`);
    }

    console.log("Migrations complete.");
  } finally {
    try {
      await db.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    } catch {
      // Ignore unlock errors during shutdown.
    }
    await db.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

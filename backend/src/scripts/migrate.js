// Runs every migrations/*.sql file (in filename order) against the PRIMARY.
// Idempotent: tracks applied files in a schema_migrations table.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// migrations/ ships inside the backend (../../ from backend/src/scripts/) so the
// Docker image is self-contained. Overridable for other run contexts.
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || path.resolve(__dirname, '../../migrations');

// Prefer Neon's DIRECT (unpooled) URL for DDL; fall back to DATABASE_URL, then to
// discrete host/port for local. SSL on for any managed URL.
const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || '';
const useSsl = process.env.PG_SSL === 'true' || Boolean(directUrl);
const pool = new Pool(
  directUrl
    ? { connectionString: directUrl, ssl: useSsl ? { rejectUnauthorized: false } : false }
    : {
        host: process.env.PG_PRIMARY_HOST || 'localhost',
        port: Number(process.env.PG_PRIMARY_PORT || 5432),
        database: process.env.PG_DATABASE || 'booking',
        user: process.env.PG_USER || 'booking',
        password: process.env.PG_PASSWORD || 'booking_pass',
        ssl: useSsl ? { rejectUnauthorized: false } : false,
      },
);

async function migrate() {
  console.log(`[migrate] target ${directUrl ? 'managed URL (SSL)' : `${process.env.PG_PRIMARY_HOST || 'localhost'}:${process.env.PG_PRIMARY_PORT || 5432}`} (${MIGRATIONS_DIR})`);
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  • skip ${file} (already applied)`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  ▶ applying ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file} failed: ${err.message}`);
        throw err;
      }
    }
    console.log(`[migrate] done — ${count} new migration(s) applied, ${files.length} total.`);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});

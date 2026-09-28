import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const migrationsDirectory = new URL('../../db/migrations/', import.meta.url);
const pool = new pg.Pool({ connectionString });

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await fs.readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const already = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
    if (already.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationsDirectory.pathname, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.info(`applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}

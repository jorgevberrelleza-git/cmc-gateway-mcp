import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

export function createLearningStore({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required for persistent learning storage');
  const pool = new Pool({ connectionString, ssl: process.env.PGSSL === 'disable' ? false : undefined });

  async function saveSnapshot(snapshot, { source = 'scheduler', materialEvent = null } = {}) {
    const raw = JSON.stringify(snapshot);
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const generatedAt = snapshot?.generated_at || new Date().toISOString();
    const result = await pool.query(
      `insert into learning_snapshots (generated_at, snapshot_version, source, sha256, payload, material_event)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       on conflict (sha256) do update set material_event = coalesce(excluded.material_event, learning_snapshots.material_event)
       returning id, sha256, generated_at`,
      [generatedAt, snapshot?.snapshot_version ?? null, source, sha256, raw, materialEvent ? JSON.stringify(materialEvent) : null]
    );
    return result.rows[0];
  }

  async function latestSnapshot() {
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots order by generated_at desc limit 1`
    );
    return result.rows[0] ?? null;
  }

  async function close() { await pool.end(); }

  return { pool, saveSnapshot, latestSnapshot, close };
}

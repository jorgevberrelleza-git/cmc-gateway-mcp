import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : undefined
});

await client.connect();
try {
  const baseline = await fs.readFile(new URL('../learning/schema.sql', import.meta.url), 'utf8');
  await client.query(baseline);

  const dir = new URL('../learning/migrations/', import.meta.url);
  const names = (await fs.readdir(dir)).filter(x => x.endsWith('.sql')).sort();
  const result = { applied: [], skipped: [], total: names.length };

  for (const name of names) {
    const sql = await fs.readFile(new URL(name, dir), 'utf8');
    const sha256 = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('select sha256 from learning_schema_migrations where name = $1', [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== sha256) throw new Error(`migration_checksum_mismatch:${name}`);
      result.skipped.push(name);
      continue;
    }

    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        'insert into learning_schema_migrations (name, sha256) values ($1,$2)',
        [name, sha256]
      );
      await client.query('commit');
      result.applied.push(name);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await client.end();
}

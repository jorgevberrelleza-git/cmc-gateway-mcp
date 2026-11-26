import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const sql = await fs.readFile(new URL('../learning/schema.sql', import.meta.url), 'utf8');
const client = new Client({
  connectionString,
  ssl: process.env.PGSSL === 'disable' ? false : undefined
});

await client.connect();
try {
  await client.query(sql);
  console.log('learning-db-init: schema ready');
} finally {
  await client.end();
}

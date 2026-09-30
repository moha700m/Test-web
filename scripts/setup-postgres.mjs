import { readFile } from 'node:fs/promises';
import { postgresDb } from '../server/postgres-db.js';
const db = postgresDb();
if (!db) throw new Error('Connect a PostgreSQL database and set DATABASE_URL before deploying. Local SQLite cannot persist on Vercel.');
try {
  await db.pool.query(await readFile(new URL('../db/postgres.sql', import.meta.url), 'utf8'));
  console.log('WebsiteCheck database schema ready.');
} finally { await db.pool.end(); }

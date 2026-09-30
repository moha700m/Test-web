import pg from 'pg';
export function postgresDb(connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL) {
  if (!connectionString) return null;
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
  return postgresAdapter(pool);
}
export function postgresAdapter(pool) {
  return {
    pool,
    prepare(sql) {
      let index = 0;
      let query = sql.replace(/\?/g, () => '$' + ++index);
      if (query.startsWith('INSERT OR IGNORE INTO ')) {
        query = query.replace('INSERT OR IGNORE INTO ', 'INSERT INTO ') + ' ON CONFLICT DO NOTHING';
      }
      return { bind(...args) {
        return {
          first: async () => (await pool.query(query, args)).rows[0] || null,
          run: async () => ({ meta: { changes: (await pool.query(query, args)).rowCount } }),
        };
      } };
    },
  };
}

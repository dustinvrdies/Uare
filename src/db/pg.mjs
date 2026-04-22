import pg from 'pg';
const { Pool } = pg;

let pool = null;

export function getPgPool(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required for Postgres mode');
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

export async function checkPgHealth(connectionString) {
  const pool = getPgPool(connectionString);
  const result = await pool.query('select 1 as ok');
  return Boolean(result.rows?.[0]?.ok);
}

export async function withPgClient(connectionString, fn) {
  const pool = getPgPool(connectionString);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

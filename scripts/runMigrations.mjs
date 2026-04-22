import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const migrationsDir = process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'migrations');
const legacySchemaPath = process.env.SCHEMA_FILE || path.join(process.cwd(), 'schema.sql');
const client = new pg.Client({ connectionString: databaseUrl });

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadMigrations() {
  if (await fileExists(migrationsDir)) {
    const names = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    if (names.length) {
      return Promise.all(names.map(async (name) => ({ id: name, sql: await fs.readFile(path.join(migrationsDir, name), 'utf8') })));
    }
  }
  const sql = await fs.readFile(legacySchemaPath, 'utf8');
  const id = `schema-${Buffer.from(sql).toString('base64url').slice(0, 16)}`;
  return [{ id, sql }];
}

await client.connect();

try {
  const migrations = await loadMigrations();
  await client.query('BEGIN');
  await client.query(`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`);
  for (const migration of migrations) {
    const existing = await client.query('select id from schema_migrations where id=$1', [migration.id]);
    if (existing.rowCount) {
      console.log(`Migration ${migration.id} already applied`);
      continue;
    }
    await client.query(migration.sql);
    await client.query('insert into schema_migrations (id) values ($1)', [migration.id]);
    console.log(`Applied migration ${migration.id}`);
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}

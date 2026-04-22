import crypto from 'node:crypto';
import { withPgClient } from '../db/pg.mjs';
import { createJsonFileStore } from '../utils/jsonFileStore.mjs';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }

function createFileIdempotencyStore(runtime = {}) {
  const fileStore = createJsonFileStore(runtime.idempotencyStoreFile || './data/idempotency-store.json', { keys: [] });
  const ttlMs = Math.max(Number(runtime.idempotencyTtlMs || 24 * 60 * 60 * 1000), 60_000);

  function readActive() {
    const now = Date.now();
    const db = fileStore.read();
    return db.keys.filter((row) => new Date(row.expires_at || 0).getTime() > now);
  }

  return {
    mode: 'file',
    async get(key, scope) {
      const row = readActive().find((entry) => entry.idempotency_key === key && entry.scope === scope);
      return row ? clone(row) : null;
    },
    async save(record = {}) {
      const normalized = {
        ...clone(record),
        expires_at: record.expires_at || new Date(Date.now() + ttlMs).toISOString(),
        created_at: record.created_at || nowIso(),
      };
      fileStore.mutate((draft) => {
        const now = Date.now();
        draft.keys = draft.keys.filter((row) => new Date(row.expires_at || 0).getTime() > now && !(row.idempotency_key === normalized.idempotency_key && row.scope === normalized.scope));
        draft.keys.unshift(normalized);
        draft.keys = draft.keys.slice(0, Math.max(Number(runtime.idempotencyStoreMaxEntries || 5000), 100));
        return draft;
      });
      return clone(normalized);
    },
  };
}

function createPgIdempotencyStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;
  const ttlMs = Math.max(Number(runtime.idempotencyTtlMs || 24 * 60 * 60 * 1000), 60_000);
  return {
    mode: 'postgres',
    async get(key, scope) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(
          `select * from idempotency_keys where idempotency_key = $1 and scope = $2 and expires_at > now() limit 1`,
          [key, scope]
        );
        return result.rows[0] || null;
      });
    },
    async save(record = {}) {
      const normalized = {
        ...clone(record),
        expires_at: record.expires_at || new Date(Date.now() + ttlMs).toISOString(),
        created_at: record.created_at || nowIso(),
      };
      return withPgClient(connectionString, async (client) => {
        await client.query(
          `insert into idempotency_keys (idempotency_key, scope, request_hash, response_status, response_body_json, created_at, expires_at)
           values ($1,$2,$3,$4,$5::jsonb,$6,$7)
           on conflict (idempotency_key, scope) do update set
             request_hash=excluded.request_hash,
             response_status=excluded.response_status,
             response_body_json=excluded.response_body_json,
             expires_at=excluded.expires_at`,
          [normalized.idempotency_key, normalized.scope, normalized.request_hash, normalized.response_status, JSON.stringify(normalized.response_body_json || {}), normalized.created_at, normalized.expires_at]
        );
        return normalized;
      });
    },
  };
}

function getStore(runtime = {}) {
  return runtime.mode === 'postgres' ? createPgIdempotencyStore(runtime) : createFileIdempotencyStore(runtime);
}

function getRequestHash(req) {
  return crypto.createHash('sha256').update(JSON.stringify({
    method: req.method,
    path: req.baseUrl ? `${req.baseUrl}${req.path}` : req.path,
    body: req.validatedBody || req.body || {},
    actor_id: req.actor?.id || req.headers['x-user-id'] || null,
  })).digest('hex');
}

export function withIdempotency(scope, runtime = {}) {
  const store = getStore(runtime);
  return async function idempotencyMiddleware(req, res, next) {
    try {
      const key = String(req.headers['idempotency-key'] || '').trim();
      if (!key) return next();
      if (key.length > 200) {
        const error = new Error('Invalid idempotency key');
        error.statusCode = 400;
        throw error;
      }

      const requestHash = getRequestHash(req);
      const existing = await store.get(key, scope);
      if (existing) {
        if (existing.request_hash !== requestHash) {
          const error = new Error('Idempotency key reused with different request payload');
          error.statusCode = 409;
          throw error;
        }
        return res.status(Number(existing.response_status || 200)).json({
          ...(existing.response_body_json || {}),
          idempotent_replay: true,
        });
      }

      const originalJson = res.json.bind(res);
      res.json = async function patchedJson(payload) {
        const body = payload == null ? {} : payload;
        try {
          await store.save({
            idempotency_key: key,
            scope,
            request_hash: requestHash,
            response_status: res.statusCode || 200,
            response_body_json: body,
          });
        } catch {}
        return originalJson(body);
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

import { withPgClient } from '../db/pg.mjs';
import { createJsonFileStore } from './jsonFileStore.mjs';

function nowIso() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function randomId(prefix = 'audit') { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`; }

function normalizeAuditEntry(entry = {}) {
  return {
    audit_id: String(entry.audit_id || randomId('audit')),
    actor_id: entry.actor_id == null ? null : String(entry.actor_id),
    actor_role: entry.actor_role == null ? null : String(entry.actor_role),
    action: String(entry.action || 'unknown'),
    target_type: entry.target_type == null ? null : String(entry.target_type),
    target_id: entry.target_id == null ? null : String(entry.target_id),
    status: String(entry.status || 'success'),
    request_id: entry.request_id == null ? null : String(entry.request_id),
    ip: entry.ip == null ? null : String(entry.ip),
    metadata_json: clone(entry.metadata_json || entry.metadata || {}),
    created_at: entry.created_at || nowIso(),
  };
}

function createFileAuditStore(runtime = {}) {
  const fileStore = createJsonFileStore(runtime.auditStoreFile || './data/audit-events.json', { events: [] });

  return {
    mode: 'file',
    async record(entry = {}) {
      const event = normalizeAuditEntry(entry);
      fileStore.mutate((draft) => {
        draft.events.unshift(event);
        draft.events = draft.events.slice(0, Math.max(Number(runtime.auditStoreMaxEntries || 5000), 100));
        return draft;
      });
      return clone(event);
    },
    async listRecent(limit = 100, filters = {}) {
      const rows = fileStore.read().events.filter((row) => (
        (!filters.action || row.action === filters.action)
        && (!filters.actor_id || row.actor_id === String(filters.actor_id))
        && (!filters.target_type || row.target_type === String(filters.target_type))
        && (!filters.target_id || row.target_id === String(filters.target_id))
      ));
      return rows.slice(0, Math.max(Number(limit || 100), 1)).map(clone);
    },
  };
}

function createPgAuditStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;
  return {
    mode: 'postgres',
    async record(entry = {}) {
      const event = normalizeAuditEntry(entry);
      await withPgClient(connectionString, async (client) => {
        await client.query(
          `insert into audit_events (audit_id, actor_id, actor_role, action, target_type, target_id, status, request_id, ip, metadata_json, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
          [event.audit_id, event.actor_id, event.actor_role, event.action, event.target_type, event.target_id, event.status, event.request_id, event.ip, JSON.stringify(event.metadata_json || {}), event.created_at]
        );
      });
      return event;
    },
    async listRecent(limit = 100, filters = {}) {
      return withPgClient(connectionString, async (client) => {
        const clauses = [];
        const values = [];
        let i = 1;
        for (const [key, value] of Object.entries(filters || {})) {
          if (!['action', 'actor_id', 'target_type', 'target_id'].includes(key) || value == null || value === '') continue;
          clauses.push(`${key} = $${i++}`);
          values.push(String(value));
        }
        values.push(Math.max(Number(limit || 100), 1));
        const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const result = await client.query(`select * from audit_events ${where} order by created_at desc limit $${i}`, values);
        return result.rows;
      });
    },
  };
}

export function createAuditStore(runtime = {}) {
  return runtime.mode === 'postgres' ? createPgAuditStore(runtime) : createFileAuditStore(runtime);
}

export async function recordAuditEvent(auditStore, req, entry = {}) {
  if (!auditStore?.record) return null;
  const actor = req?.actor || {};
  return auditStore.record({
    actor_id: actor?.id && actor.id !== 'anonymous' ? actor.id : null,
    actor_role: actor?.role || null,
    request_id: req?.requestId || null,
    ip: req?.ip || req?.socket?.remoteAddress || null,
    ...entry,
  });
}

import crypto from 'crypto';
import { withPgClient } from '../db/pg.mjs';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEnvelope(envelope = {}, archived = false) {
  return {
    replay_id: envelope.replay_id || `replay-${crypto.randomUUID()}`,
    topic: String(envelope.topic || 'unknown'),
    payload: clone(envelope.payload || {}),
    origin_id: envelope.origin_id || null,
    published_at: envelope.published_at || nowIso(),
    archived: archived || envelope.archived === true,
    archived_at: archived ? envelope.archived_at || nowIso() : envelope.archived_at || null,
  };
}

function matchesFilters(row, filters = {}) {
  if (filters.topic && row.topic !== filters.topic) return false;
  if (filters.topic_prefix && !String(row.topic || '').startsWith(String(filters.topic_prefix))) return false;
  if (filters.origin_id && row.origin_id !== filters.origin_id) return false;
  if (filters.task_id && row.payload?.task?.task_id !== filters.task_id && row.payload?.task_id !== filters.task_id) return false;
  if (filters.kind && row.payload?.task?.kind !== filters.kind && row.payload?.kind !== filters.kind) return false;
  return true;
}

function toIsoMaybe(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function deriveCutoffIso(filters = {}, options = {}) {
  if (filters.before) return toIsoMaybe(filters.before);
  if (options.retentionDays) return new Date(Date.now() - (Number(options.retentionDays) * 24 * 60 * 60 * 1000)).toISOString();
  return null;
}

export function createReplayStore(options = {}) {
  const rows = [];
  const archiveRows = [];
  const maxEntries = Math.max(Number(options.maxEntries || 2000), 100);
  const archiveEnabled = options.archiveEnabled !== false;
  const archiveMaxEntries = Math.max(Number(options.archiveMaxEntries || 10000), 100);
  const retentionDays = Math.max(Number(options.retentionDays || 30), 1);

  function pushArchive(row) {
    if (!archiveEnabled) return;
    archiveRows.unshift(normalizeEnvelope(row, true));
    if (archiveRows.length > archiveMaxEntries) archiveRows.length = archiveMaxEntries;
  }

  async function append(envelope = {}) {
    const row = normalizeEnvelope(envelope);
    rows.unshift(row);
    while (rows.length > maxEntries) {
      const overflow = rows.pop();
      if (overflow) pushArchive(overflow);
    }
    return clone(row);
  }

  async function archive(filters = {}) {
    const cutoffIso = deriveCutoffIso(filters, { retentionDays });
    const limit = Math.max(Number(filters.limit || options.archiveBatchSize || maxEntries), 1);
    const toMove = [];
    for (let index = rows.length - 1; index >= 0 && toMove.length < limit; index -= 1) {
      const row = rows[index];
      if (!matchesFilters(row, filters)) continue;
      if (cutoffIso && String(row.published_at) > cutoffIso) continue;
      toMove.push(index);
    }
    const moved = [];
    for (const index of toMove) {
      const [row] = rows.splice(index, 1);
      if (row) {
        pushArchive(row);
        moved.push(row.replay_id);
      }
    }
    return { archived_count: moved.length, replay_ids: moved };
  }

  async function list(filters = {}, limit = 100) {
    const includeArchive = filters.include_archive === true;
    const archivedOnly = filters.archived_only === true;
    const active = archivedOnly ? [] : rows;
    const archived = includeArchive || archivedOnly ? archiveRows : [];
    const merged = [...active, ...archived]
      .filter((row) => matchesFilters(row, filters))
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
      .slice(0, Math.max(Number(limit || 100), 1));
    return clone(merged);
  }

  async function stats() {
    return {
      mode: 'memory',
      active_count: rows.length,
      archive_count: archiveRows.length,
      retention_days: retentionDays,
      archive_enabled: archiveEnabled,
      oldest_active_at: rows.at(-1)?.published_at || null,
      newest_active_at: rows[0]?.published_at || null,
      oldest_archive_at: archiveRows.at(-1)?.published_at || null,
      newest_archive_at: archiveRows[0]?.published_at || null,
    };
  }

  return { mode: 'memory', append, list, archive, stats };
}

export function createPostgresReplayStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;
  const table = runtime.eventReplayTable || 'event_replay';
  const archiveTable = runtime.eventReplayArchiveTable || 'event_replay_archive';
  const archiveEnabled = runtime.eventReplayArchiveEnabled !== false;
  const retentionDays = Math.max(Number(runtime.eventReplayRetentionDays || 30), 1);
  const archiveBatchSize = Math.max(Number(runtime.eventReplayArchiveBatchSize || 500), 1);

  async function append(envelope = {}) {
    const row = normalizeEnvelope(envelope);
    await withPgClient(connectionString, async (client) => {
      await client.query(
        `insert into ${table} (replay_id, topic, payload_json, origin_id, published_at) values ($1,$2,$3::jsonb,$4,$5)`,
        [row.replay_id, row.topic, JSON.stringify(row.payload), row.origin_id, row.published_at],
      );
    });
    return row;
  }

  function buildWhere(filters = {}, payloadColumn = 'payload_json') {
    const params = [];
    const where = [];
    let idx = 1;
    if (filters.topic) {
      where.push(`topic = $${idx++}`);
      params.push(filters.topic);
    }
    if (filters.topic_prefix) {
      where.push(`topic like $${idx++}`);
      params.push(`${filters.topic_prefix}%`);
    }
    if (filters.origin_id) {
      where.push(`origin_id = $${idx++}`);
      params.push(filters.origin_id);
    }
    if (filters.task_id) {
      where.push(`coalesce(${payloadColumn}->'task'->>'task_id', ${payloadColumn}->>'task_id') = $${idx++}`);
      params.push(String(filters.task_id));
    }
    if (filters.kind) {
      where.push(`coalesce(${payloadColumn}->'task'->>'kind', ${payloadColumn}->>'kind') = $${idx++}`);
      params.push(String(filters.kind));
    }
    if (filters.before) {
      where.push(`published_at <= $${idx++}`);
      params.push(toIsoMaybe(filters.before));
    }
    return { params, where, nextIndex: idx };
  }

  async function list(filters = {}, limit = 100) {
    const includeArchive = filters.include_archive === true;
    const archivedOnly = filters.archived_only === true;
    const sources = archivedOnly ? [archiveTable] : includeArchive ? [table, archiveTable] : [table];
    const queryParts = [];
    const params = [];
    let nextIndex = 1;
    for (const sourceTable of sources) {
      const built = buildWhere(filters);
      const offset = nextIndex - 1;
      const rewrittenWhere = built.where.map((clause) => clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`));
      params.push(...built.params);
      nextIndex += built.params.length;
      queryParts.push(`select replay_id, topic, payload_json, origin_id, published_at, ${sourceTable === archiveTable ? 'true' : 'false'} as archived from ${sourceTable} ${rewrittenWhere.length ? `where ${rewrittenWhere.join(' and ')}` : ''}`);
    }
    params.push(Math.max(Number(limit || 100), 1));
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(
        `${queryParts.join(' union all ')} order by published_at desc limit $${nextIndex}`,
        params,
      );
      return result.rows.map((row) => ({
        replay_id: row.replay_id,
        topic: row.topic,
        payload: typeof row.payload_json === 'object' ? row.payload_json : JSON.parse(row.payload_json || '{}'),
        origin_id: row.origin_id,
        published_at: row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at,
        archived: row.archived === true,
      }));
    });
  }

  async function archive(filters = {}) {
    if (!archiveEnabled) return { archived_count: 0, replay_ids: [] };
    const before = deriveCutoffIso(filters, { retentionDays });
    const built = buildWhere({ ...filters, before });
    const limitIndex = built.nextIndex;
    const insertParams = [...built.params, Math.max(Number(filters.limit || archiveBatchSize), 1)];
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(
        `with moved as (
          delete from ${table}
          where replay_id in (
            select replay_id from ${table}
            ${built.where.length ? `where ${built.where.join(' and ')}` : ''}
            order by published_at asc
            limit $${limitIndex}
          )
          returning replay_id, topic, payload_json, origin_id, published_at
        )
        insert into ${archiveTable} (replay_id, topic, payload_json, origin_id, published_at, archived_at)
        select replay_id, topic, payload_json, origin_id, published_at, now() from moved
        on conflict (replay_id) do update set
          topic = excluded.topic,
          payload_json = excluded.payload_json,
          origin_id = excluded.origin_id,
          published_at = excluded.published_at,
          archived_at = excluded.archived_at
        returning replay_id`,
        insertParams,
      );
      return { archived_count: result.rowCount, replay_ids: result.rows.map((row) => row.replay_id) };
    });
  }

  async function stats() {
    return withPgClient(connectionString, async (client) => {
      const [active, archive] = await Promise.all([
        client.query(`select count(*)::int as count, min(published_at) as oldest_at, max(published_at) as newest_at from ${table}`),
        client.query(`select count(*)::int as count, min(published_at) as oldest_at, max(published_at) as newest_at from ${archiveTable}`),
      ]);
      return {
        mode: 'postgres',
        active_count: active.rows[0]?.count || 0,
        archive_count: archive.rows[0]?.count || 0,
        retention_days: retentionDays,
        archive_enabled: archiveEnabled,
        oldest_active_at: toIsoMaybe(active.rows[0]?.oldest_at),
        newest_active_at: toIsoMaybe(active.rows[0]?.newest_at),
        oldest_archive_at: toIsoMaybe(archive.rows[0]?.oldest_at),
        newest_archive_at: toIsoMaybe(archive.rows[0]?.newest_at),
      };
    });
  }

  return { mode: 'postgres', append, list, archive, stats };
}

export function createReplayStoreForRuntime(runtime = {}) {
  if (runtime.eventReplayStoreMode === 'postgres' || runtime.mode === 'postgres') {
    return createPostgresReplayStore(runtime);
  }
  return createReplayStore({
    maxEntries: runtime.eventReplayMaxEntries,
    archiveEnabled: runtime.eventReplayArchiveEnabled,
    archiveMaxEntries: runtime.eventReplayArchiveMaxEntries,
    retentionDays: runtime.eventReplayRetentionDays,
    archiveBatchSize: runtime.eventReplayArchiveBatchSize,
  });
}

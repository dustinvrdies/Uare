import { withPgClient } from '../db/pg.mjs';

function tableFor(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (!['solver', 'cad', 'patent', 'physics'].includes(normalized)) throw new Error(`Unsupported job kind: ${kind}`);
  return `${normalized}_jobs`;
}

function idColumnFor(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'patent') return 'search_id';
  if (normalized === 'cad') return 'execution_id';
  return 'job_id';
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRow(row, kind) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json, {}),
    result_json: parseJson(row.result_json, null),
    metadata_json: parseJson(row.metadata_json, {}),
    progress_json: parseJson(row.progress_json, null),
    request_json: parseJson(row.request_json, null),
    response_json: parseJson(row.response_json, null),
    provider_meta_json: parseJson(row.provider_meta_json, null),
    kind,
  };
}

export function createPostgresJobStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;

  async function create(kind, input = {}) {
    const table = tableFor(kind);
    const idColumn = idColumnFor(kind);
    const idValue = String(input[idColumn] || `${kind}-${Date.now()}`);
    const createdAt = input.created_at || nowIso();
    const updatedAt = nowIso();
    const status = input.status || 'queued';
    const projectId = input.project_id || null;
    const actorId = input.actor_id || null;
    const executionTarget = input.execution_target || null;
    const taskId = input.task_id || input.dispatch_task_id || null;
    const learningEventId = input.learning_event_id || null;
    const payloadJson = input.payload_json ?? input.payload ?? null;
    const resultJson = input.result_json ?? input.result ?? null;
    const metadataJson = input.metadata_json ?? input.metadata ?? null;
    const progressJson = input.progress_json ?? input.progress ?? null;
    const requestJson = input.request_json ?? input.request ?? null;
    const responseJson = input.response_json ?? input.response ?? null;
    const providerMetaJson = input.provider_meta_json ?? input.provider_meta ?? null;

    await withPgClient(connectionString, async (client) => {
      if (kind === 'patent') {
        await client.query(`
          insert into ${table} (search_id, actor_id, project_id, status, request_json, response_json, provider_meta_json, learning_event_id, created_at, updated_at)
          values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)
          on conflict (search_id) do update set
            actor_id=excluded.actor_id,
            project_id=excluded.project_id,
            status=excluded.status,
            request_json=excluded.request_json,
            response_json=excluded.response_json,
            provider_meta_json=excluded.provider_meta_json,
            learning_event_id=excluded.learning_event_id,
            updated_at=excluded.updated_at
        `, [idValue, actorId, projectId, status, JSON.stringify(requestJson), JSON.stringify(responseJson), JSON.stringify(providerMetaJson), learningEventId, createdAt, updatedAt]);
      } else {
        await client.query(`
          insert into ${table} (${idColumn}, actor_id, project_id, status, execution_target, task_id, learning_event_id, payload_json, result_json, metadata_json, progress_json, created_at, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)
          on conflict (${idColumn}) do update set
            actor_id=excluded.actor_id,
            project_id=excluded.project_id,
            status=excluded.status,
            execution_target=excluded.execution_target,
            task_id=excluded.task_id,
            learning_event_id=excluded.learning_event_id,
            payload_json=excluded.payload_json,
            result_json=excluded.result_json,
            metadata_json=excluded.metadata_json,
            progress_json=excluded.progress_json,
            updated_at=excluded.updated_at
        `, [idValue, actorId, projectId, status, executionTarget, taskId, learningEventId, JSON.stringify(payloadJson), JSON.stringify(resultJson), JSON.stringify(metadataJson), JSON.stringify(progressJson), createdAt, updatedAt]);
      }
    });
    return get(kind, idValue);
  }

  async function get(kind, id) {
    const table = tableFor(kind);
    const idColumn = idColumnFor(kind);
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(`select * from ${table} where ${idColumn} = $1 limit 1`, [String(id)]);
      return mapRow(result.rows[0], kind);
    });
  }

  async function update(kind, id, patch = {}) {
    const current = await get(kind, id);
    if (!current) return null;
    const merged = { ...current, ...patch, updated_at: nowIso() };
    return create(kind, merged);
  }

  async function list(kind, limit = 100, filters = {}) {
    const table = tableFor(kind);
    const params = [];
    let idx = 1;
    const where = [];
    if (filters.status) {
      where.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.project_id) {
      where.push(`project_id = $${idx++}`);
      params.push(filters.project_id);
    }
    params.push(Math.max(Number(limit || 100), 1));
    const result = await withPgClient(connectionString, async (client) => client.query(`select * from ${table} ${where.length ? `where ${where.join(' and ')}` : ''} order by updated_at desc limit $${idx}`, params));
    return result.rows.map((row) => mapRow(row, kind));
  }

  return {
    mode: 'postgres',
    create,
    get,
    update,
    list,
  };
}

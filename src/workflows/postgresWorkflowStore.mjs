import { withPgClient } from '../db/pg.mjs';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json, {}),
    state_json: parseJson(row.state_json, {}),
    result_json: parseJson(row.result_json, null),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

export function createPostgresWorkflowStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;

  async function create(input = {}) {
    const runId = String(input.run_id);
    const workflowType = String(input.workflow_type || 'cad_solver_pipeline');
    const projectId = input.project_id || null;
    const actorId = input.actor_id || null;
    const status = input.status || 'queued';
    const currentStep = input.current_step || 'submitted';
    const requestedSteps = input.requested_steps || ['cad', 'solver'];
    const payloadJson = input.payload_json ?? input.payload ?? {};
    const stateJson = input.state_json ?? input.state ?? {};
    const resultJson = input.result_json ?? input.result ?? null;
    const metadataJson = input.metadata_json ?? input.metadata ?? {};
    const createdAt = input.created_at || nowIso();
    const updatedAt = input.updated_at || nowIso();
    const completedAt = input.completed_at || null;
    const revision = Number(input.revision ?? 0);

    await withPgClient(connectionString, async (client) => {
      await client.query(`
        insert into workflow_runs (
          run_id, workflow_type, project_id, actor_id, status, current_step, requested_steps, payload_json, state_json, result_json, metadata_json, created_at, updated_at, completed_at, revision
        ) values (
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15
        )
        on conflict (run_id) do update set
          workflow_type = excluded.workflow_type,
          project_id = excluded.project_id,
          actor_id = excluded.actor_id,
          status = excluded.status,
          current_step = excluded.current_step,
          requested_steps = excluded.requested_steps,
          payload_json = excluded.payload_json,
          state_json = excluded.state_json,
          result_json = excluded.result_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at,
          revision = excluded.revision
      `, [runId, workflowType, projectId, actorId, status, currentStep, JSON.stringify(requestedSteps), JSON.stringify(payloadJson), JSON.stringify(stateJson), JSON.stringify(resultJson), JSON.stringify(metadataJson), createdAt, updatedAt, completedAt, revision]);
    });

    return get(runId);
  }

  async function get(runId) {
    return withPgClient(connectionString, async (client) => {
      const result = await client.query('select * from workflow_runs where run_id = $1 limit 1', [String(runId)]);
      return mapRow(result.rows[0]);
    });
  }

  async function update(runId, patch = {}) {
    const current = await get(runId);
    if (!current) return null;
    return updateConditional(runId, current.revision, patch);
  }

  async function updateConditional(runId, expectedRevision, patch = {}) {
    const current = await get(runId);
    if (!current) return null;
    if (Number(current.revision || 0) !== Number(expectedRevision || 0)) {
      const error = new Error('Workflow revision conflict');
      error.code = 'WORKFLOW_REVISION_CONFLICT';
      error.current = current;
      throw error;
    }

    const next = {
      ...current,
      ...patch,
      run_id: current.run_id,
      updated_at: nowIso(),
      revision: Number(current.revision || 0) + 1,
    };

    return withPgClient(connectionString, async (client) => {
      const result = await client.query(`
        update workflow_runs
        set workflow_type = $2,
            project_id = $3,
            actor_id = $4,
            status = $5,
            current_step = $6,
            requested_steps = $7::jsonb,
            payload_json = $8::jsonb,
            state_json = $9::jsonb,
            result_json = $10::jsonb,
            metadata_json = $11::jsonb,
            updated_at = $12,
            completed_at = $13,
            revision = $14
        where run_id = $1 and revision = $15
        returning *
      `, [
        next.run_id,
        next.workflow_type,
        next.project_id,
        next.actor_id,
        next.status,
        next.current_step,
        JSON.stringify(next.requested_steps || []),
        JSON.stringify(next.payload_json ?? {}),
        JSON.stringify(next.state_json ?? {}),
        JSON.stringify(next.result_json ?? null),
        JSON.stringify(next.metadata_json ?? {}),
        next.updated_at,
        next.completed_at || null,
        next.revision,
        Number(expectedRevision || 0),
      ]);
      if (!result.rows[0]) {
        const latest = await get(runId);
        const error = new Error('Workflow revision conflict');
        error.code = 'WORKFLOW_REVISION_CONFLICT';
        error.current = latest;
        throw error;
      }
      return mapRow(result.rows[0]);
    });
  }

  async function list(limit = 100, filters = {}) {
    const params = [];
    let idx = 1;
    const where = [];
    if (filters.project_id) {
      where.push(`project_id = $${idx++}`);
      params.push(filters.project_id);
    }
    if (filters.status) {
      where.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    params.push(Math.max(Number(limit || 100), 1));
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(`select * from workflow_runs ${where.length ? `where ${where.join(' and ')}` : ''} order by updated_at desc limit $${idx}`, params);
      return result.rows.map(mapRow);
    });
  }

  return { mode: 'postgres', create, get, update, updateConditional, list };
}

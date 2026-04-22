import { getPgPool } from '../db/pg.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function createCadExecutionStore(runtime = {}) {
  function isPg() {
    return runtime.mode === 'postgres' && runtime.databaseUrl;
  }

  async function saveExecution(manifest = {}) {
    if (!isPg()) return { ok: false, skipped: true, reason: 'cad execution persistence requires postgres mode' };
    const pool = getPgPool(runtime.databaseUrl);
    const result = await pool.query(
      `insert into cad_executions (
        execution_id, actor_id, project_id, status, engine, deterministic, manufacturable,
        ready_for_execution, plan_signature, manifest_json, created_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
      on conflict (execution_id) do update set
        actor_id = excluded.actor_id,
        project_id = excluded.project_id,
        status = excluded.status,
        engine = excluded.engine,
        deterministic = excluded.deterministic,
        manufacturable = excluded.manufacturable,
        ready_for_execution = excluded.ready_for_execution,
        plan_signature = excluded.plan_signature,
        manifest_json = excluded.manifest_json
      returning execution_id`,
      [
        manifest.execution_id,
        manifest.actor_id || null,
        manifest.project_id || null,
        manifest.status || 'completed',
        manifest.engine || 'cadquery',
        Boolean(manifest.deterministic),
        Boolean(manifest.manufacturable),
        Boolean(manifest.ready_for_execution),
        manifest.plan_signature || null,
        manifest,
        manifest.created_at || nowIso(),
      ]
    );
    return { ok: true, execution_id: result.rows?.[0]?.execution_id || manifest.execution_id };
  }

  async function linkExecutionToProject(projectId, executionId) {
    if (!isPg()) return { ok: false, skipped: true, reason: 'project linkage requires postgres mode' };
    const pool = getPgPool(runtime.databaseUrl);
    await pool.query(
      `update projects set latest_cad_execution_id = $1, updated_at = $2 where id = $3`,
      [executionId, nowIso(), projectId]
    );
    return { ok: true, project_id: projectId, execution_id: executionId };
  }

  async function listProjectExecutions(projectId) {
    if (!isPg()) return [];
    const pool = getPgPool(runtime.databaseUrl);
    const result = await pool.query(
      `select execution_id, actor_id, project_id, status, engine, deterministic, manufacturable, ready_for_execution, plan_signature, created_at
         from cad_executions where project_id = $1 order by created_at desc limit 100`,
      [projectId]
    );
    return result.rows || [];
  }

  async function getExecutionManifest(executionId) {
    if (!isPg()) return null;
    const pool = getPgPool(runtime.databaseUrl);
    const result = await pool.query(
      `select manifest_json from cad_executions where execution_id = $1 limit 1`,
      [executionId]
    );
    return result.rows?.[0]?.manifest_json || null;
  }

  return { saveExecution, linkExecutionToProject, listProjectExecutions, getExecutionManifest };
}

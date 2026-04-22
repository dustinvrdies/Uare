import crypto from 'crypto';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRunId() {
  return `wf-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function createWorkflowStore() {
  const runs = [];

  function create(input = {}) {
    const run = {
      run_id: String(input.run_id || makeRunId()),
      workflow_type: String(input.workflow_type || 'cad_solver_pipeline'),
      project_id: input.project_id || null,
      actor_id: input.actor_id || null,
      status: String(input.status || 'queued'),
      current_step: input.current_step || 'submitted',
      requested_steps: Array.isArray(input.requested_steps) ? clone(input.requested_steps) : ['cad', 'solver'],
      payload_json: clone(input.payload_json || input.payload || {}),
      state_json: clone(input.state_json || input.state || {}),
      result_json: clone(input.result_json || input.result || null),
      metadata_json: clone(input.metadata_json || input.metadata || {}),
      created_at: input.created_at || nowIso(),
      updated_at: input.updated_at || nowIso(),
      completed_at: input.completed_at || null,
      revision: Number(input.revision ?? 0),
    };
    const existingIndex = runs.findIndex((entry) => entry.run_id === run.run_id);
    if (existingIndex >= 0) runs.splice(existingIndex, 1);
    runs.unshift(run);
    return clone(run);
  }

  function get(runId) {
    const found = runs.find((entry) => entry.run_id === String(runId));
    return found ? clone(found) : null;
  }

  function update(runId, patch = {}) {
    const current = runs.find((entry) => entry.run_id === String(runId));
    if (!current) return null;
    Object.assign(current, clone(patch), { updated_at: nowIso(), revision: Number(current.revision || 0) + 1 });
    return clone(current);
  }

  function updateConditional(runId, expectedRevision, patch = {}) {
    const current = runs.find((entry) => entry.run_id === String(runId));
    if (!current) return null;
    if (Number(current.revision || 0) != Number(expectedRevision || 0)) {
      const error = new Error('Workflow revision conflict');
      error.code = 'WORKFLOW_REVISION_CONFLICT';
      error.current = clone(current);
      throw error;
    }
    Object.assign(current, clone(patch), { updated_at: nowIso(), revision: Number(current.revision || 0) + 1 });
    return clone(current);
  }

  function list(limit = 100, filters = {}) {
    return runs
      .filter((entry) => {
        if (filters.project_id && entry.project_id !== filters.project_id) return false;
        if (filters.status && entry.status !== filters.status) return false;
        return true;
      })
      .slice(0, Math.max(Number(limit || 100), 1))
      .map(clone);
  }

  return { mode: 'memory', create, get, update, updateConditional, list };
}

import { normalizePhysicsRequest, validatePhysicsRequest } from './contracts.mjs';
import { solvePhysicsRequest } from './solverCore.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function createPhysicsJobService(runtime = {}, jobStore, taskStore = null) {
  async function submitJob(input = {}, actor = {}, options = {}) {
    const validation = validatePhysicsRequest({ ...input, execution_target: options.execution_target || input.execution_target || runtime.physicsExecutionTarget || 'in_process' });
    if (!validation.ok) {
      const error = new Error(validation.errors.join('; '));
      error.statusCode = 400;
      throw error;
    }
    const request = validation.request;
    const record = await jobStore.create('physics', {
      job_id: request.job_id,
      actor_id: actor?.id || 'unknown',
      project_id: request.project_id || null,
      status: request.execution_target === 'in_process' ? 'running' : 'queued',
      execution_target: request.execution_target,
      payload_json: request,
      metadata_json: { domain: request.domain, fidelity_tier: request.fidelity_tier, workflow_run_id: request.metadata?.workflow_run_id || null },
      progress_json: request.execution_target === 'in_process' ? { percent: 5, stage: 'running' } : { percent: 0, stage: 'queued' },
    });
    if (request.execution_target === 'in_process') {
      return runJob(record, actor);
    }
    if (taskStore) {
      const task = await taskStore.submitTask({
        kind: 'physics',
        source_id: record.job_id,
        execution_target: request.execution_target,
        payload: { job_id: record.job_id, request },
        metadata: { project_id: record.project_id, physics_domain: request.domain },
      });
      return jobStore.update('physics', record.job_id, { task_id: task.task_id, progress_json: { percent: 5, stage: 'queued' } });
    }
    return record;
  }

  async function runJob(jobOrId, actor = {}) {
    const current = typeof jobOrId === 'string' ? await jobStore.get('physics', jobOrId) : jobOrId;
    if (!current) return null;
    const request = normalizePhysicsRequest(current.payload_json || current.payload || {});
    const startedAt = Date.now();
    const result = solvePhysicsRequest(request);
    const completed = await jobStore.update('physics', current.job_id, {
      actor_id: current.actor_id || actor?.id || 'unknown',
      status: result.status || 'completed',
      result_json: { ...result, completed_at: nowIso() },
      progress_json: { percent: 100, stage: 'completed' },
      metadata_json: {
        ...(current.metadata_json || {}),
        actual_duration_ms: result.actual_duration_ms ?? Date.now() - startedAt,
        actual_cost_units: result.actual_cost_units ?? null,
      },
    });
    return completed;
  }

  async function getJob(jobId) {
    return jobStore.get('physics', jobId);
  }

  async function listJobs(limit = 100, filters = {}) {
    return jobStore.list('physics', limit, filters);
  }

  return { submitJob, runJob, getJob, listJobs };
}

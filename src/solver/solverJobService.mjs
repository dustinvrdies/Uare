import { deriveSolverLearningEvent } from '../learning/eventFactory.mjs';
import { runDeterministicSolver } from './deterministicWorker.mjs';

export function createSolverJobService(learningStore, jobStore = null) {
  const solverJobs = [];

  function findLocal(jobId) {
    return solverJobs.find((entry) => entry.job_id === jobId) || null;
  }

  async function sync(job) {
    if (!jobStore || !job?.job_id) return job;
    await jobStore.create('solver', {
      job_id: job.job_id,
      actor_id: job.actor_id,
      project_id: job.project_id,
      status: job.status,
      execution_target: job.payload?.execution_target || null,
      task_id: job.dispatch_task_id || null,
      learning_event_id: job.learning_event_id || null,
      payload_json: job.payload,
      result_json: job.result,
      metadata_json: job.worker_dispatch ? { worker_dispatch: job.worker_dispatch } : {},
      progress_json: job.progress,
      created_at: job.created_at,
      updated_at: new Date().toISOString(),
    });
    return job;
  }

  async function findJob(jobId) {
    const local = findLocal(jobId);
    if (local) return local;
    if (!jobStore) return null;
    const persisted = await jobStore.get('solver', jobId);
    if (!persisted) return null;
    const hydrated = {
      job_id: persisted.job_id,
      actor_id: persisted.actor_id,
      project_id: persisted.project_id,
      status: persisted.status,
      payload: persisted.payload_json || {},
      created_at: persisted.created_at,
      result: persisted.result_json || null,
      learning_event_id: persisted.learning_event_id || null,
      dispatch_task_id: persisted.task_id || null,
      worker_dispatch: persisted.metadata_json?.worker_dispatch || null,
      progress: persisted.progress_json || null,
    };
    solverJobs.unshift(hydrated);
    return hydrated;
  }

  async function submitJob(payload = {}, actor = {}, defaults = {}) {
    const job = {
      job_id: String(payload?.job_id || `solver-${Date.now()}`),
      actor_id: actor?.id || 'unknown',
      project_id: payload?.project_id || null,
      status: 'queued',
      payload: {
        ...payload,
        execution_target: payload?.execution_target || defaults.execution_target || 'in_process',
      },
      created_at: new Date().toISOString(),
      result: null,
      learning_event_id: null,
      dispatch_task_id: null,
      worker_dispatch: null,
      progress: { percent: 0, stage: 'queued', detail: 'Job submitted', updated_at: new Date().toISOString() },
    };
    solverJobs.unshift(job);
    await sync(job);
    return job;
  }

  async function finalizeJob(job, result, actor) {
    job.status = result.status;
    job.result = result;
    job.progress = {
      percent: result.status === 'completed' ? 100 : Number(job.progress?.percent || 0),
      stage: result.status,
      detail: result.summary || 'Solver job finalized',
      updated_at: new Date().toISOString(),
    };
    const learningEvent = await learningStore.recordEvent(deriveSolverLearningEvent(job, result, actor));
    job.learning_event_id = learningEvent.event_id;
    await sync(job);
    return learningEvent;
  }

  async function runJobLocally(job, actor) {
    job.status = 'running';
    job.progress = { percent: 35, stage: 'running', detail: 'Running deterministic solver', updated_at: new Date().toISOString() };
    await sync(job);
    const result = runDeterministicSolver(job);
    const learningEvent = await finalizeJob(job, result, actor);
    return { job, result, learningEvent };
  }

  async function attachDispatch(job, dispatch) {
    job.worker_dispatch = dispatch || null;
    job.progress = {
      percent: 5,
      stage: 'dispatched',
      detail: `Job dispatched to ${dispatch?.mode || job.payload.execution_target}`,
      updated_at: new Date().toISOString(),
    };
    await sync(job);
    return job;
  }

  async function listJobs(limit = 100) {
    const local = solverJobs.slice(0, limit);
    if (!jobStore) return local;
    const persisted = await jobStore.list('solver', limit);
    const existing = new Set(local.map((job) => job.job_id));
    for (const row of persisted) {
      if (existing.has(row.job_id)) continue;
      local.push({
        job_id: row.job_id,
        actor_id: row.actor_id,
        project_id: row.project_id,
        status: row.status,
        payload: row.payload_json || {},
        created_at: row.created_at,
        result: row.result_json || null,
        learning_event_id: row.learning_event_id || null,
        dispatch_task_id: row.task_id || null,
        worker_dispatch: row.metadata_json?.worker_dispatch || null,
        progress: row.progress_json || null,
      });
    }
    return local.slice(0, limit);
  }

  return {
    submitJob,
    findJob,
    finalizeJob,
    runJobLocally,
    attachDispatch,
    listJobs,
  };
}

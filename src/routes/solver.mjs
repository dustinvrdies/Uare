import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { buildExecutionAdapterPlan } from '../workers/adapters.mjs';

function hydrateJobFromTask(task) {
  const baseJob = task?.payload?.job || null;
  if (!baseJob) return null;
  const outcome = task.result?.job || null;
  const result = task.result?.result || outcome?.result || baseJob.result || null;
  const status = outcome?.status || result?.status || (task.status === 'completed' ? 'completed' : baseJob.status || task.status);
  return {
    ...baseJob,
    ...outcome,
    dispatch_task_id: task.task_id,
    status,
    result,
    learning_event_id: outcome?.learning_event_id || task.result?.learning_event?.event_id || baseJob.learning_event_id || null,
    progress: task.progress || outcome?.progress || baseJob.progress,
  };
}

export function buildSolverRoutes(runtime, solverJobService, taskStore) {
  const router = Router();

  router.post('/submit', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const payload = req.body?.job || {};
      const job = await solverJobService.submitJob(payload, actor, { execution_target: runtime.solverExecutionTarget });
      if (job.payload.execution_target !== 'in_process') {
        const portableJob = JSON.parse(JSON.stringify({ ...job, worker_dispatch: null }));
        const dispatch = buildExecutionAdapterPlan('solver', job.payload.execution_target, { job_id: job.job_id, job: portableJob }, runtime);
        const task = await taskStore.submitTask({
          kind: 'solver',
          source_id: job.job_id,
          execution_target: job.payload.execution_target,
          payload: { job_id: job.job_id, job: portableJob, dispatch },
          metadata: { project_id: job.project_id, dispatch },
        });
        job.dispatch_task_id = task.task_id;
        await solverJobService.attachDispatch(job, dispatch);
      }
      return res.status(201).json({ ok: true, job });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/jobs/:jobId/run-local', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await solverJobService.findJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: 'Solver job not found' });
      const outcome = await solverJobService.runJobLocally(job, actor);
      return res.json({ ok: true, job: outcome.job, learning_event: outcome.learningEvent });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/jobs/:jobId/dispatch', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await solverJobService.findJob(req.params.jobId);
      if (!job) {
        const [existingTask] = await taskStore.listTasks(1, { kind: 'solver', source_id: req.params.jobId });
        if (!existingTask) return res.status(404).json({ ok: false, error: 'Solver job not found' });
        return res.json({ ok: true, job: hydrateJobFromTask(existingTask), task: existingTask });
      }
      if (job.dispatch_task_id) {
        return res.json({ ok: true, job, task: await taskStore.getTask(job.dispatch_task_id) });
      }
      const executionTarget = req.body?.execution_target || job.payload.execution_target || runtime.solverExecutionTarget || 'queued';
      const portableJob = JSON.parse(JSON.stringify({ ...job, worker_dispatch: null }));
      const dispatch = buildExecutionAdapterPlan('solver', executionTarget, { job_id: job.job_id, job: portableJob }, runtime);
      const task = await taskStore.submitTask({
        kind: 'solver',
        source_id: job.job_id,
        execution_target: executionTarget,
        payload: { job_id: job.job_id, job: portableJob, dispatch },
        metadata: { project_id: job.project_id, dispatch },
      });
      job.dispatch_task_id = task.task_id;
      job.payload.execution_target = executionTarget;
      await solverJobService.attachDispatch(job, dispatch);
      return res.status(202).json({ ok: true, job, task, dispatch });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/jobs/:jobId/complete', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await solverJobService.findJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: 'Solver job not found' });
      const result = {
        status: String(req.body?.result?.status || 'completed').toLowerCase(),
        feasible: req.body?.result?.feasible !== false,
        convergence_score: req.body?.result?.convergence_score,
        confidence_score: req.body?.result?.confidence_score,
        max_stress_ratio: req.body?.result?.max_stress_ratio,
        estimated_deflection_mm: req.body?.result?.estimated_deflection_mm,
        reserve_factor: req.body?.result?.reserve_factor,
        solver_mode: req.body?.result?.solver_mode || 'external',
        summary: req.body?.result?.summary || '',
        completed_at: req.body?.result?.completed_at || new Date().toISOString(),
      };
      const learningEvent = await solverJobService.finalizeJob(job, result, actor);
      return res.json({ ok: true, job, learning_event: learningEvent });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/jobs', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const jobs = await solverJobService.listJobs(100);
      const tasks = await taskStore.listTasks(100, { kind: 'solver' });
      const byTaskJobId = new Set(jobs.map((job) => job.job_id));
      const hydrated = tasks.map(hydrateJobFromTask).filter(Boolean).filter((job) => !byTaskJobId.has(job.job_id));
      return res.json({ ok: true, jobs: [...jobs, ...hydrated] });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/jobs/:jobId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await solverJobService.findJob(req.params.jobId);
      if (job) return res.json({ ok: true, job });
      const [task] = await taskStore.listTasks(1, { kind: 'solver', source_id: req.params.jobId });
      if (!task) return res.status(404).json({ ok: false, error: 'Solver job not found' });
      return res.json({ ok: true, job: hydrateJobFromTask(task), task });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

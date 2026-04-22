import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildPhysicsRoutes(runtime, physicsJobService) {
  const router = Router();

  router.post('/jobs', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await physicsJobService.submitJob(req.body?.job || req.body || {}, actor, {
        execution_target: req.body?.execution_target || req.body?.job?.execution_target || runtime.physicsExecutionTarget,
      });
      return res.status(201).json({ ok: true, job });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/jobs', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const jobs = await physicsJobService.listJobs(100, { project_id: req.query.project_id || null, status: req.query.status || null });
      return res.json({ ok: true, jobs });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/jobs/:jobId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await physicsJobService.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: 'Physics job not found' });
      return res.json({ ok: true, job });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/jobs/:jobId/run', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await physicsJobService.runJob(req.params.jobId, actor);
      if (!job) return res.status(404).json({ ok: false, error: 'Physics job not found' });
      return res.json({ ok: true, job });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

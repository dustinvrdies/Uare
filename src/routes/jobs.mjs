import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildJobRoutes(runtime, jobStore) {
  const router = Router();

  router.get('/:kind/:id/status', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const job = await jobStore.find(req.params.kind, req.params.id);
      if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
      return res.json({ ok: true, job });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

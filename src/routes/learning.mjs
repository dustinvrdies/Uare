import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildLearningRoutes(runtime, learningStore) {
  const router = Router();

  router.post('/events', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const event = await learningStore.recordEvent({
        ...(req.body?.event || {}),
        actor_id: req.body?.event?.actor_id || actor.id,
      });
      return res.status(201).json({ ok: true, event });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/insights', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const domain = req.query?.domain ? String(req.query.domain).toLowerCase() : null;
      const projectId = req.query?.project_id ? String(req.query.project_id) : null;
      const insights = await learningStore.getInsights({ domain, projectId, limit: Number(req.query?.limit) || 50 });
      return res.json({ ok: true, ...insights });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

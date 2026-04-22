
import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildUsageRoutes(runtime, productStore) {
  const router = Router();

  router.get('/summary', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const usage = await productStore.getUsageSummary(actor.id);
      return res.json({ ok: true, usage });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/track', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const entry = await productStore.recordUsage({
        user_id: actor.id,
        meter_key: req.body?.meter_key || 'compute_credit',
        quantity: Number(req.body?.quantity || 1),
        source: req.body?.source || 'ui',
        metadata_json: req.body?.metadata || {},
      });
      return res.status(201).json({ ok: true, entry });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildAnalyticsRoutes(runtime, analyticsStore) {
  const router = Router();

  router.get('/summary', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const since = req.query?.since ? String(req.query.since) : null;
      const summary = await analyticsStore.summary({ since });
      return res.json({ ok: true, summary });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/throughput', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const hours = Number(req.query?.hours || 24);
      const throughput = await analyticsStore.throughput({ hours });
      return res.json({ ok: true, throughput, hours });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/workers', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const summary = await analyticsStore.summary({ since: req.query?.since ? String(req.query.since) : null });
      return res.json({ ok: true, workers: summary.worker_efficiency || [] });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function wantsPersistentStream(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  if (req.query?.once === 'true' || req.query?.bootstrap_only === 'true') return false;
  return accept.includes('text/event-stream');
}

export function buildExperienceRoutes(runtime, experienceService, eventBus = null) {
  const router = Router();

  router.get('/profile', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const data = await experienceService.getProfile(actor, { project_id: req.query.project_id || null });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/layout', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const layout = await experienceService.getLayout(actor, { project_id: req.query.project_id || null });
      return res.json({ ok: true, layout });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/feed', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const feed = await experienceService.getFeed(actor, { project_id: req.query.project_id || null, total_budget_units: req.query.total_budget_units || null });
      return res.json({ ok: true, ...feed });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/runs/:runId/canvas', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const canvas = await experienceService.getCanvas(actor, req.params.runId, { project_id: req.query.project_id || null });
      if (!canvas) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, canvas });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/runs/:runId/claim-overlay', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const overlay = await experienceService.getClaimOverlay(actor, req.params.runId, { project_id: req.query.project_id || null });
      if (!overlay) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, overlay });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/morph', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const morph = await experienceService.getMorph(actor, { project_id: req.query.project_id || null });
      return res.json({ ok: true, morph });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/bootstrap', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const payload = await experienceService.bootstrap(actor, {
        project_id: req.query.project_id || null,
        run_id: req.query.run_id || null,
        total_budget_units: req.query.total_budget_units || null,
      });
      return res.json({ ok: true, ...payload });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/ia/respond', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const response = await experienceService.respond(actor, req.body || {}, {
        project_id: req.body?.project_id || req.query.project_id || null,
        run_id: req.body?.run_id || req.query.run_id || null,
      });
      return res.json({ ok: true, response });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/stream', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const keepOpen = wantsPersistentStream(req);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', keepOpen ? 'keep-alive' : 'close');
      res.flushHeaders?.();
      sendSse(res, 'bootstrap', await experienceService.getStreamSnapshot(actor, { project_id: req.query.project_id || null }));
      if (!keepOpen) {
        res.end();
        return;
      }
      const unsubscribe = eventBus?.subscribeAll?.(({ topic, payload }) => {
        if (!/^task:|metric|metrics|workflow|portfolio|learning/.test(topic)) return;
        sendSse(res, 'workflow:update', { topic, payload });
      }) || (() => {});
      const heartbeat = setInterval(async () => {
        sendSse(res, 'pulse', await experienceService.getStreamSnapshot(actor, { project_id: req.query.project_id || null }));
      }, 15000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

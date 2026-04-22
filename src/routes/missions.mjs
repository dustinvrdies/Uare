import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildMissionRoutes(runtime, missionStore, workflowService) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const missions = await missionStore.listByOwner(actor.id, req.query.project_id || null);
      return res.json({ ok: true, missions });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const mission = await missionStore.create({
        owner_id: actor.id,
        project_id: req.body?.project_id,
        title: req.body?.title,
        brief: req.body?.brief,
        snapshot_json: req.body?.snapshot || req.body?.config || {},
        status: req.body?.status || 'draft',
      });
      return res.status(201).json({ ok: true, mission });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/:missionId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const mission = await missionStore.get(req.params.missionId);
      if (!mission || mission.owner_id !== actor.id) return res.status(404).json({ ok: false, error: 'Mission not found' });
      return res.json({ ok: true, mission });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/:missionId/fork', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const current = await missionStore.get(req.params.missionId);
      if (!current || current.owner_id !== actor.id) return res.status(404).json({ ok: false, error: 'Mission not found' });
      const version = await missionStore.saveVersion(req.params.missionId, {
        label: req.body?.label || 'fork',
        snapshot_json: req.body?.snapshot || current.versions?.[0]?.snapshot_json || {},
        run_id: req.body?.run_id || null,
        status: req.body?.status || 'draft',
      });
      return res.status(201).json({ ok: true, version });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/:missionId/launch', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const mission = await missionStore.get(req.params.missionId);
      if (!mission || mission.owner_id !== actor.id) return res.status(404).json({ ok: false, error: 'Mission not found' });
      const run = await workflowService.createRun({
        workflow_type: req.body?.workflow_type || 'cad_solver_pipeline',
        project_id: mission.project_id || req.body?.project_id || null,
        cad_plan: req.body?.cad_plan || {},
        solver_payload: req.body?.solver_payload || {},
        requested_steps: req.body?.requested_steps || ['cad','solver'],
        metadata: { mission_id: mission.mission_id, title: mission.title, ...(req.body?.metadata || {}) },
        lineage: { mission_id: mission.mission_id, version_id: mission.current_version_id },
        options: req.body?.options || {},
      }, actor);
      const version = await missionStore.saveVersion(mission.mission_id, { label: req.body?.label || 'launch', snapshot_json: req.body || {}, run_id: run.run_id, status: run.status || 'queued' });
      return res.status(201).json({ ok: true, run, version });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

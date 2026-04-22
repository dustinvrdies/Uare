import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildWorkflowRoutes(runtime, workflowService) {
  const router = Router();

  router.post('/runs', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.createRun({
        workflow_type: req.body?.workflow_type || 'cad_solver_pipeline',
        project_id: req.body?.project_id || req.body?.cad_plan?.project_id || null,
        cad_plan: req.body?.cad_plan || {},
        solver_payload: req.body?.solver_payload || {},
        requested_steps: req.body?.requested_steps || ['cad', 'solver'],
        metadata: req.body?.metadata || {},
        lineage: req.body?.lineage || req.body?.metadata?.lineage || null,
        options: req.body?.options || {},
      }, actor);
      return res.status(201).json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const runs = await workflowService.listRuns(100, { project_id: req.query.project_id || null, status: req.query.status || null });
      return res.json({ ok: true, runs });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/runs/:runId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.getRun(req.params.runId);
      if (!run) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  async function reconcile(req, res) {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.reconcileRun(req.params.runId, actor);
      if (!run) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  }

  router.post('/runs/:runId/reconcile', reconcile);
  router.post('/runs/:runId/resume', reconcile);

  router.post('/runs/:runId/retry', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.retryRun(req.params.runId, actor, {
        step: req.body?.step || null,
        reason: req.body?.reason || null,
      });
      return res.json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });


  router.post('/runs/:runId/branch', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.branchRun(req.params.runId, actor, {
        branch_key: req.body?.branch_key || null,
        workflow_type: req.body?.workflow_type || null,
        requested_steps: req.body?.requested_steps || null,
        cad_plan_patch: req.body?.cad_plan_patch || {},
        solver_payload_patch: req.body?.solver_payload_patch || {},
        metadata_patch: req.body?.metadata_patch || {},
        options_patch: req.body?.options_patch || {},
      });
      return res.status(201).json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/runs/:runId/reopen', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.reopenRun(req.params.runId, actor, {
        workflow_type: req.body?.workflow_type || null,
        requested_steps: req.body?.requested_steps || null,
        cad_plan_patch: req.body?.cad_plan_patch || {},
        solver_payload_patch: req.body?.solver_payload_patch || {},
        metadata_patch: req.body?.metadata_patch || {},
        options_patch: req.body?.options_patch || {},
      });
      return res.status(201).json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/runs/:runId/branch-policy', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const run = await workflowService.updateBranchPolicy(req.params.runId, actor, req.body || {});
      return res.json({ ok: true, run });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });


  router.get('/runs/:runId/predict', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const assessment = await workflowService.getPredictiveAssessment(req.params.runId);
      if (!assessment) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, assessment });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/runs/:runId/plan', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const plan = await workflowService.getLongHorizonPlan(req.params.runId);
      if (!plan) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, plan });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });
  router.get('/runs/:runId/branches', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const family = await workflowService.getBranchFamily(req.params.runId);
      if (!family) return res.status(404).json({ ok: false, error: 'Workflow run not found' });
      return res.json({ ok: true, family });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/sweep', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const summary = await workflowService.sweepRuns({
        limit: req.body?.limit || req.query.limit || null,
        stale_ms: req.body?.stale_ms || req.query.stale_ms || null,
        project_id: req.body?.project_id || req.query.project_id || null,
        status: req.body?.status || req.query.status || null,
        force: req.body?.force === true || req.query.force === 'true',
        auto_retry: req.body?.auto_retry !== false,
      }, actor);
      return res.json({ ok: true, summary });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

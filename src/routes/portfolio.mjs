import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildPortfolioRoutes(runtime, workflowService) {
  const router = Router();

  router.get('/optimize', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const projectId = req.query.project_id || null;
      const totalBudgetUnits = req.query.total_budget_units || req.query.totalBudgetUnits || null;
      const report = await workflowService.getPortfolioOptimization({
        project_id: projectId,
        totalBudgetUnits,
      });
      return res.json({ ok: true, report });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

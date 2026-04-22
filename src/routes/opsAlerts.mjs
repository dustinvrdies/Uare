import { Router } from 'express';
import { sendOpsAlert } from '../opsAlerting.mjs';

export function buildOpsAlertRoutes() {
  const router = Router();
  router.post('/test-alert', async (req, res) => {
    const result = await sendOpsAlert({
      severity: 'info',
      title: 'UARE production alert test',
      details: req.body || {},
    });
    res.json(result);
  });
  return router;
}

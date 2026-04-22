import { Router } from 'express';

export function buildAdminRoutes(runtime) {
  const router = Router();

  router.get('/metrics', async (req, res) => {
    return res.json({
      ok: true,
      metrics: {
        mode: runtime.mode,
        nodeEnv: runtime.nodeEnv,
        requestLogs: runtime.enableRequestLogs,
        devHeaderAuth: runtime.allowDevHeaderAuth,
        jwtConfigured: Boolean(runtime.jwtIssuer && runtime.jwtAudience && runtime.jwtJwksUrl),
        timestamp: new Date().toISOString()
      }
    });
  });

  return router;
}

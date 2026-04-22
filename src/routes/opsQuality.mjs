import { Router } from 'express';
import { snapshotMetrics, prometheusMetrics } from '../ops/metricsRegistry.mjs';

function assertOpsToken(req, runtime) {
  if (!runtime.opsMetricsToken) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${runtime.opsMetricsToken}`;
}

function redactedRuntime(runtime = {}) {
  return {
    nodeEnv: runtime.nodeEnv,
    mode: runtime.mode,
    billingProvider: runtime.billingProvider,
    appBaseUrlConfigured: Boolean(runtime.appBaseUrl),
    corsAllowedOriginsCount: (runtime.corsAllowedOrigins || []).length,
    stripeSecretConfigured: Boolean(runtime.stripeSecretKey),
    stripeWebhookSecretConfigured: Boolean(runtime.stripeWebhookSecret),
    redisConfigured: Boolean(runtime.redisUrl),
    rateLimitMode: runtime.rateLimitMode,
    eventBusMode: runtime.eventBusMode,
    stripePriceProConfigured: Boolean(runtime.stripePriceMap?.pro),
    stripePriceEnterpriseConfigured: Boolean(runtime.stripePriceMap?.enterprise),
    sessionSecretConfigured: Boolean(runtime.sessionSecret),
    allowDevHeaderAuth: runtime.allowDevHeaderAuth,
    artifactRootConfigured: Boolean(runtime.artifactRootDir || runtime.dataRootDir),
    trustProxy: runtime.trustProxy,
    requestBodyLimit: runtime.requestBodyLimit,
    rateLimitWindowMs: runtime.rateLimitWindowMs,
    rateLimitMax: runtime.rateLimitMax,
    publicHealthDetails: runtime.publicHealthDetails,
    auditStoreConfigured: Boolean(runtime.auditStoreFile || runtime.mode === 'postgres'),
    idempotencyStoreConfigured: Boolean(runtime.idempotencyStoreFile || runtime.mode === 'postgres'),
  };
}

export function buildOpsQualityRoutes(runtime) {
  const router = Router();

  router.get('/metrics-json', (req, res) => {
    if (!assertOpsToken(req, runtime)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    res.json(snapshotMetrics());
  });

  router.get('/metrics-prometheus', (req, res) => {
    if (!assertOpsToken(req, runtime)) return res.status(401).type('text/plain').send('Unauthorized\n');
    res.type('text/plain').send(prometheusMetrics());
  });

  router.get('/recent-audit', async (req, res) => {
    if (!assertOpsToken(req, runtime)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const auditStore = req.app?.locals?.auditStore;
    const events = await auditStore?.listRecent?.(Math.min(Number(req.query?.limit || 50), 200), { action: req.query?.action, actor_id: req.query?.actor_id, target_type: req.query?.target_type, target_id: req.query?.target_id }) || [];
    return res.json({ ok: true, events });
  });

  router.get('/config-audit', (req, res) => {
    if (!assertOpsToken(req, runtime)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const required = runtime.requiredProdVars || [];
    const missing = runtime.nodeEnv === 'production' ? required.filter((key) => !process.env[key]) : [];
    res.json({ ok: missing.length === 0, runtime: redactedRuntime(runtime), requiredProdVars: required, missingRequiredProdVars: missing });
  });

  return router;
}

import { Router } from 'express';

function check(name, ok, severity = 'warn', message = '') {
  return { name, ok: Boolean(ok), severity, message };
}

export function buildOpsRoutes(runtime, services = {}) {
  const router = Router();

  router.get('/liveness', (_req, res) => {
    res.json({ ok: true, service: 'uare-custom-backend', env: runtime.nodeEnv || 'development' });
  });

  router.get('/readiness', async (_req, res) => {
    let pgHealthy = runtime.mode !== 'postgres';
    try {
      if (runtime.mode === 'postgres' && services.checkPgHealth) {
        pgHealthy = await services.checkPgHealth(runtime.databaseUrl);
      }
    } catch {
      pgHealthy = false;
    }

    const checks = [
      check('database_postgres_for_scale', runtime.mode === 'postgres', 'warn', 'Use CUSTOM_BACKEND_MODE=postgres and DATABASE_URL before high-traffic beta.'),
      check('database_connection_healthy', pgHealthy, runtime.mode === 'postgres' ? 'error' : 'warn', runtime.mode === 'postgres' ? 'Database health check failed.' : 'Database not required in current mode.'),
      check('session_secret_configured', runtime.nodeEnv !== 'production' || Boolean(runtime.sessionSecret), 'error', 'Set SESSION_SECRET in production.'),
      check('dev_header_auth_disabled_in_production', runtime.nodeEnv !== 'production' || runtime.allowDevHeaderAuth === false, 'error', 'Set ALLOW_DEV_HEADER_AUTH=false in production.'),
      check('stripe_secret_configured_when_stripe_enabled', runtime.billingProvider !== 'stripe' || Boolean(runtime.stripeSecretKey), 'error', 'Set STRIPE_SECRET_KEY when BILLING_PROVIDER=stripe.'),
      check('stripe_webhook_secret_configured_when_stripe_enabled', runtime.billingProvider !== 'stripe' || Boolean(runtime.stripeWebhookSecret), 'error', 'Set STRIPE_WEBHOOK_SECRET when BILLING_PROVIDER=stripe.'),
      check('stripe_price_pro_configured_when_stripe_enabled', runtime.billingProvider !== 'stripe' || Boolean(runtime.stripePriceMap?.pro), 'warn', 'Set STRIPE_PRICE_PRO to use a real Stripe price.'),
      check('artifact_root_configured', Boolean(runtime.artifactRootDir || runtime.dataRootDir), 'warn', 'Set ARTIFACT_ROOT_DIR or DATA_ROOT_DIR for consistent artifact persistence.'),
      check('cors_origin_configured_in_production', runtime.nodeEnv !== 'production' || (runtime.corsAllowedOrigins || []).length > 0 || Boolean(runtime.appBaseUrl), 'warn', 'Set CORS_ALLOWED_ORIGINS and APP_BASE_URL in production.'),
      check('ops_metrics_token_configured', runtime.nodeEnv !== 'production' || Boolean(runtime.opsMetricsToken), 'warn', 'Set OPS_METRICS_TOKEN or protect /ops/quality at the network layer.'),
    ];

    const fatal = checks.filter((entry) => entry.severity === 'error' && !entry.ok);
    const passed = checks.filter((entry) => entry.ok).length;
    const score = Math.round((passed / checks.length) * 100);
    res.status(fatal.length ? 503 : 200).json({ ok: fatal.length === 0, score, checks });
  });

  return router;
}

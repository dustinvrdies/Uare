const env = process.env;
let errors = 0;
let warnings = 0;

function fail(message) { errors += 1; console.error(`ERROR: ${message}`); }
function warn(message) { warnings += 1; console.warn(`WARN: ${message}`); }
function strongSecret(value, name) {
  if (!value) return fail(`${name} is required.`);
  if (value.length < 32) fail(`${name} should be at least 32 characters.`);
  if (/^(secret|change|replace|test|dev)/i.test(value)) fail(`${name} looks like a placeholder.`);
}

const inProd = (env.NODE_ENV || 'development') === 'production';
strongSecret(env.SESSION_SECRET, 'SESSION_SECRET');
if (inProd && env.ALLOW_DEV_HEADER_AUTH !== 'false') fail('ALLOW_DEV_HEADER_AUTH must be false in production.');
if (!env.APP_BASE_URL) fail('APP_BASE_URL is required.');
if (env.APP_BASE_URL && !/^https:\/\//.test(env.APP_BASE_URL) && inProd) fail('APP_BASE_URL must use https in production.');
if ((env.BILLING_PROVIDER || 'stripe') === 'stripe') {
  if (!env.STRIPE_SECRET_KEY) fail('STRIPE_SECRET_KEY is required for Stripe.');
  if (!env.STRIPE_WEBHOOK_SECRET) fail('STRIPE_WEBHOOK_SECRET is required for Stripe.');
  if (!env.STRIPE_PRICE_PRO) fail('STRIPE_PRICE_PRO is required for paid plan checkout.');
  if (!env.STRIPE_PRICE_ENTERPRISE) warn('STRIPE_PRICE_ENTERPRISE is not set. Enterprise checkout will need manual handling.');
}
if ((env.CUSTOM_BACKEND_MODE || 'memory') !== 'postgres') fail('CUSTOM_BACKEND_MODE must be postgres for production.');
if (!env.DATABASE_URL) fail('DATABASE_URL is required.');
if (!env.REDIS_URL) fail('REDIS_URL is required.');
if ((env.RATE_LIMIT_MODE || 'memory') !== 'redis' && inProd) warn('RATE_LIMIT_MODE should be redis for horizontally scaled production.');
if ((env.EVENT_BUS_MODE || 'memory') !== 'redis' && inProd) warn('EVENT_BUS_MODE should be redis for cross-instance event delivery.');
if (!env.CORS_ALLOWED_ORIGINS) warn('CORS_ALLOWED_ORIGINS is not set.');
if (!env.TRUSTED_ORIGINS) warn('TRUSTED_ORIGINS is not set; CSRF origin enforcement may be too permissive.');
if (env.SESSION_COOKIE_SECURE !== 'true' && inProd) fail('SESSION_COOKIE_SECURE must be true in production.');
if (!env.ARTIFACT_ROOT_DIR && !env.DATA_ROOT_DIR) warn('Set ARTIFACT_ROOT_DIR or DATA_ROOT_DIR for persistent artifacts.');
if (!env.OPS_ALERT_WEBHOOK_URL) warn('OPS_ALERT_WEBHOOK_URL is not set; alerts will log only.');
if (!env.OPS_METRICS_TOKEN && inProd) warn('OPS_METRICS_TOKEN is not set; ops metrics are publicly reachable unless network-protected.');

console.log(JSON.stringify({ ok: errors === 0, errors, warnings }, null, 2));
if (errors > 0) { console.error('Preflight failed.'); process.exit(1); }
console.log('Preflight passed.');

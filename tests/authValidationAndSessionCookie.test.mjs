import assert from 'node:assert/strict';
import { buildAuthRoutes } from '../src/routes/auth.mjs';
import { writeSessionCookie, clearSessionCookie } from '../src/auth/sessionService.mjs';

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    app: { locals: { auditStore: { async record() { return { ok: true }; } } } },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function routeHandlers(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(router, method, path, req, res) {
  const handlers = routeHandlers(router, method, path);
  req.app = req.app || res.app;
  let index = 0;
  const next = async (error) => {
    if (error) { res.status(error.statusCode || 500).json({ ok: false, error: error.message, details: error.details || null }); return; }
    const handler = handlers[index++];
    if (!handler) return;
    if (handler.length >= 3) return handler(req, res, next);
    return handler(req, res);
  };
  await next();
}

const runtime = { nodeEnv: 'development', sessionCookieName: 'uare_auth', sessionCookieDomain: 'example.com', sessionCookieSameSite: 'Strict', sessionCookieSecure: true, sessionCookieMaxAgeSec: 600, authRateLimitWindowMs: 60000, authRateLimitMax: 20 };
writeSessionCookie(makeRes(), 'abc123', runtime);
const resCookie = makeRes();
writeSessionCookie(resCookie, 'abc123', runtime);
assert.match(resCookie.headers['Set-Cookie'], /uare_auth=abc123/);
assert.match(resCookie.headers['Set-Cookie'], /Domain=example\.com/);
assert.match(resCookie.headers['Set-Cookie'], /SameSite=Strict/);
assert.match(resCookie.headers['Set-Cookie'], /Secure/);
const resClear = makeRes();
clearSessionCookie(resClear, runtime);
assert.match(resClear.headers['Set-Cookie'], /Max-Age=0/);

const productStore = {
  async findUserByEmail() { return null; },
  async upsertUser(user) { return { user_id: 'user-1', email: user.email, full_name: user.full_name, role: 'owner', plan_id: 'free' }; },
  async createSession() { return { session_id: 'sess-1', expires_at: new Date(Date.now() + 60_000).toISOString() }; },
  async authenticateUser() { return null; },
  async deleteSession() { return { ok: true }; },
  async getSession() { return null; },
};
const router = buildAuthRoutes(runtime, productStore);
let req = { body: { email: 'bad-email', password: 'StrongPass1', full_name: 'Bad' }, headers: {} };
let res = makeRes();
await invokeRoute(router, 'post', '/register', req, res);
assert.equal(res.statusCode, 400);
assert.match(res.body.error, /Validation failed/);
req = { body: { email: 'good@example.com', password: 'weak', full_name: 'Weak' }, headers: {} };
res = makeRes();
await invokeRoute(router, 'post', '/register', req, res);
assert.equal(res.statusCode, 400);
assert.match(res.body.error, /(Password|Validation failed)/);
console.log('authValidationAndSessionCookie.test.mjs passed');

import assert from 'node:assert/strict';
import { buildOpsQualityRoutes } from '../src/routes/opsQuality.mjs';

function makeReq({ headers = {} } = {}) { return { headers }; }
function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null, text: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(value) { this.text = value; return this; },
  };
}
async function invoke(router, method, path, req = makeReq()) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} not found`);
  const handler = layer.route.stack[0].handle;
  const res = makeRes();
  await handler(req, res);
  return res;
}
const router = buildOpsQualityRoutes({ nodeEnv: 'test', opsMetricsToken: 'token-123', stripePriceMap: {} });
let res = await invoke(router, 'get', '/metrics-json');
assert.equal(res.statusCode, 401);
res = await invoke(router, 'get', '/metrics-json', makeReq({ headers: { authorization: 'Bearer token-123' } }));
assert.equal(res.statusCode, 200);
assert.equal(res.body.ok, true);
res = await invoke(router, 'get', '/config-audit', makeReq({ headers: { authorization: 'Bearer token-123' } }));
assert.equal(res.statusCode, 200);
assert.equal(res.body.runtime.nodeEnv, 'test');
console.log('opsQualityRoutes.test.mjs passed');

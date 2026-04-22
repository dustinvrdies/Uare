import assert from 'node:assert/strict';
import { notFound } from '../src/middleware/notFound.mjs';
import { errorHandler } from '../src/middleware/errorHandler.mjs';

function makeRes() {
  return {
    statusCode: 200,
    headersSent: false,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
const req404 = { requestId: 'req_404', originalUrl: '/missing', url: '/missing' };
const res404 = makeRes();
notFound(req404, res404);
assert.equal(res404.statusCode, 404);
assert.equal(res404.body.ok, false);
assert.equal(res404.body.request_id, 'req_404');

const logger = { error() {} };
const req500 = { requestId: 'req_500', path: '/boom', method: 'GET' };
const res500 = makeRes();
const handler = errorHandler(logger, { nodeEnv: 'production', exposeErrors: false });
handler(new Error('secret detail'), req500, res500, () => {});
assert.equal(res500.statusCode, 500);
assert.equal(res500.body.error, 'Internal server error');
console.log('notFoundErrorHandler.test.mjs passed');

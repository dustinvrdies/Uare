import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createProductStore } from '../src/product/store.mjs';

const store = createProductStore({ productStoreFile: path.join(os.tmpdir(), `uare-webhook-${process.pid}-${Date.now()}.json`) });
let result = await store.recordWebhookEvent('evt_test_1', { event_type: 'checkout.session.completed' });
assert.equal(result.inserted, true);
assert.equal(result.duplicate, false);
result = await store.recordWebhookEvent('evt_test_1', { event_type: 'checkout.session.completed' });
assert.equal(result.inserted, false);
assert.equal(result.duplicate, true);
const stored = await store.getWebhookEvent('evt_test_1');
assert.equal(stored.event_id, 'evt_test_1');
console.log('webhookIdempotencyStore.test.mjs passed');

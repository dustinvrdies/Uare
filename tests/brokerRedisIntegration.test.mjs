import { createEventBus } from '../src/events/pubsub.mjs';
import { createReplayStore } from '../src/events/replayStore.mjs';

const url = process.env.REDIS_URL || process.env.EVENT_BUS_REDIS_URL || '';
if (!url) {
  console.log('brokerRedisIntegration.test.mjs skipped (no REDIS_URL configured)');
  process.exit(0);
}

let createClient;
try {
  ({ createClient } = await import('redis'));
} catch {
  console.log('brokerRedisIntegration.test.mjs skipped (redis package not installed)');
  process.exit(0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let probe;
try {
  probe = createClient({ url });
  await probe.connect();
  await probe.ping();
  await probe.quit();
} catch (error) {
  try { await probe?.quit(); } catch {}
  console.log(`brokerRedisIntegration.test.mjs skipped (${error.message})`);
  process.exit(0);
}

const channel = `uare.events.test.${Date.now()}`;
const runtime = { eventBusMode: 'redis', eventBusRedisUrl: url, eventBusRedisChannel: channel };
const a = createEventBus(runtime, console, { replayStore: createReplayStore({ maxEntries: 50 }) });
const b = createEventBus(runtime, console, { replayStore: createReplayStore({ maxEntries: 50 }) });
await a.start();
await b.start();
try {
  const received = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('redis event bus timed out')), 5000);
    const unsubscribe = b.subscribeAll?.(({ topic, payload }) => {
      if (topic === 'metrics' && payload?.name === 'redis_probe') {
        clearTimeout(timeout);
        unsubscribe?.();
        resolve(payload.value);
      }
    });
    a.publishMetric({ name: 'redis_probe', value: 17 });
  });
  assert(received === 17, 'expected redis broker event to propagate');
  console.log('brokerRedisIntegration.test.mjs passed');
} finally {
  await a.stop();
  await b.stop();
}

import { createEventBus } from '../src/events/pubsub.mjs';
import { createReplayStore } from '../src/events/replayStore.mjs';

const servers = process.env.NATS_SERVERS || process.env.EVENT_BUS_NATS_SERVERS || '';
if (!servers) {
  console.log('brokerNatsIntegration.test.mjs skipped (no NATS_SERVERS configured)');
  process.exit(0);
}

let connect;
try {
  ({ connect } = await import('nats'));
} catch {
  console.log('brokerNatsIntegration.test.mjs skipped (nats package not installed)');
  process.exit(0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let probe;
try {
  probe = await connect({ servers });
  await probe.flush();
  await probe.close();
} catch (error) {
  try { await probe?.close(); } catch {}
  console.log(`brokerNatsIntegration.test.mjs skipped (${error.message})`);
  process.exit(0);
}

const subject = `uare.events.test.${Date.now()}`;
const runtime = { eventBusMode: 'nats', eventBusNatsServers: servers, eventBusNatsSubject: subject };
const a = createEventBus(runtime, console, { replayStore: createReplayStore({ maxEntries: 50 }) });
const b = createEventBus(runtime, console, { replayStore: createReplayStore({ maxEntries: 50 }) });
await a.start();
await b.start();
try {
  const received = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('nats event bus timed out')), 5000);
    const unsubscribe = b.subscribeAll?.(({ topic, payload }) => {
      if (topic === 'metrics' && payload?.name === 'nats_probe') {
        clearTimeout(timeout);
        unsubscribe?.();
        resolve(payload.value);
      }
    });
    a.publishMetric({ name: 'nats_probe', value: 11 });
  });
  assert(received === 11, 'expected nats broker event to propagate');
  console.log('brokerNatsIntegration.test.mjs passed');
} finally {
  await a.stop();
  await b.stop();
}

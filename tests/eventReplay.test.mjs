import { createReplayStore } from '../src/events/replayStore.mjs';
import { createEventBus } from '../src/events/pubsub.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const replayStore = createReplayStore({ maxEntries: 20 });
const bus = createEventBus({ eventBusMode: 'memory', eventBusInstanceId: 'replay-test' }, console, { replayStore });
await bus.start();
try {
  bus.publishTask('task-1', { event: 'task_progress', task: { task_id: 'task-1', kind: 'solver', status: 'running' } });
  bus.publishMetric({ name: 'worker_runs', value: 4 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const events = await bus.replay({}, 10);
  assert(events.length >= 2, 'expected replayed events');
  const taskEvents = await bus.replay({ task_id: 'task-1' }, 10);
  assert(taskEvents.some((entry) => entry.topic === 'task:task-1'), 'expected task-specific replay event');
  console.log('eventReplay.test.mjs passed');
} finally {
  await bus.stop();
}

import { createEventBus, createMemoryEventTransportHub } from '../src/events/pubsub.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const hub = createMemoryEventTransportHub();
const logger = { info() {}, warn() {}, error() {} };

const busA = createEventBus({ eventBusMode: 'postgres', eventBusInstanceId: 'bus-a' }, logger, { transportFactory: () => Promise.resolve(hub.createTransport()) });
const busB = createEventBus({ eventBusMode: 'postgres', eventBusInstanceId: 'bus-b' }, logger, { transportFactory: () => Promise.resolve(hub.createTransport()) });

await Promise.all([busA.start(), busB.start()]);

try {
  let receivedTask = null;
  const unsubscribe = busB.subscribeTask('solver-task-1', (payload) => {
    receivedTask = payload;
  });

  busA.publishTask('solver-task-1', {
    event: 'task_progress',
    task: { task_id: 'solver-task-1', status: 'running', progress: { percent: 55 } },
  });

  await wait(25);
  unsubscribe();

  assert(receivedTask?.task?.task_id === 'solver-task-1', 'expected remote task payload to reach second bus');
  assert(receivedTask?.task?.progress?.percent === 55, 'expected remote task progress to match');

  let localEchoCount = 0;
  const unsubscribeLocal = busA.subscribeTask('solver-task-1', () => {
    localEchoCount += 1;
  });
  busA.publishTask('solver-task-1', { event: 'task_completed', task: { task_id: 'solver-task-1', status: 'completed' } });
  await wait(25);
  unsubscribeLocal();
  assert(localEchoCount === 1, `expected exactly one local emission, got ${localEchoCount}`);

  console.log('eventBusCrossInstance.test.mjs passed');
} finally {
  await Promise.all([busA.stop(), busB.stop()]);
}

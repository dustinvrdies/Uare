import { createTaskStore } from '../src/workers/taskStore.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = createTaskStore({ leaseMs: 5, maxAttempts: 2, progressLogLimit: 50 });
const task = store.submitTask({ kind: 'solver', execution_target: 'queued', payload: { job_id: 'job-timeout-1' } });
assert(task.status === 'pending', 'expected submitted task to be pending');

const claimed = store.claimNext({ kind: 'solver', execution_targets: ['queued'], worker: { worker_id: 'w-1' } });
assert(claimed.status === 'running', 'expected task to become running after claim');
assert(claimed.attempts === 1, 'expected first attempt count');

await new Promise((resolve) => setTimeout(resolve, 15));
store.recoverExpiredTasks();
const requeued = store.getTask(task.task_id);
assert(requeued.status === 'pending', 'expected timed out task to requeue before max attempts');
assert(requeued.retry_count === 1, 'expected retry count increment after timeout recovery');

const claimedAgain = store.claimNext({ kind: 'solver', execution_targets: ['queued'], worker: { worker_id: 'w-2' } });
assert(claimedAgain.attempts === 2, 'expected second attempt count');
store.updateProgress(task.task_id, { percent: 55, stage: 'solving', detail: 'Mid-run' });
store.heartbeatTask(task.task_id, { worker_id: 'w-2' }, { percent: 65, stage: 'solving', detail: 'Heartbeat progress' });
const withEvents = store.getTask(task.task_id);
assert(withEvents.progress.percent === 65, 'expected heartbeat progress to update task progress');
assert(store.listTaskEvents(task.task_id, 20).length >= 4, 'expected multiple events for task lifecycle');

await new Promise((resolve) => setTimeout(resolve, 15));
store.recoverExpiredTasks();
const failed = store.getTask(task.task_id);
assert(failed.status === 'failed', 'expected task to fail after second lease expiry at max attempts');
assert(String(failed.error).includes('max attempts'), 'expected lease failure reason');

console.log('taskStoreDurability.test.mjs passed');

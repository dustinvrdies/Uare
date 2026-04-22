import { createTaskStore } from './taskStore.mjs';
import { createPostgresTaskStore } from './postgresTaskStore.mjs';

export function createTaskStoreForRuntime(runtime = {}, extras = {}) {
  const options = {
    leaseMs: runtime.taskLeaseMs,
    maxAttempts: runtime.taskMaxAttempts,
    progressLogLimit: runtime.taskProgressLogLimit,
    eventBus: extras.eventBus,
    telemetry: extras.telemetry,
  };
  if (runtime.workerStoreMode === 'postgres' || runtime.mode === 'postgres') {
    return createPostgresTaskStore(runtime, options);
  }
  return createTaskStore(options);
}

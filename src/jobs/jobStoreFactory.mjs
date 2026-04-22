import { createJobStore } from './jobStore.mjs';
import { createPostgresJobStore } from './postgresJobStore.mjs';

export function createJobStoreForRuntime(runtime = {}) {
  if (runtime.jobStoreMode === 'postgres' || runtime.mode === 'postgres') {
    return createPostgresJobStore(runtime);
  }
  return createJobStore();
}

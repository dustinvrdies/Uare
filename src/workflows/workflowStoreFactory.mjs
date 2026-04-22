import { createWorkflowStore } from './workflowStore.mjs';
import { createPostgresWorkflowStore } from './postgresWorkflowStore.mjs';

export function createWorkflowStoreForRuntime(runtime = {}) {
  if (runtime.mode === 'postgres') return createPostgresWorkflowStore(runtime);
  return createWorkflowStore();
}

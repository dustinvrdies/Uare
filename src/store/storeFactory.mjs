import { createProjectStore } from './projectStore.mjs';
import { createPostgresProjectStore } from './postgresProjectStore.mjs';

export function createStore(runtime = {}) {
  if (runtime.mode === 'postgres') return createPostgresProjectStore(runtime);
  return createProjectStore(runtime);
}

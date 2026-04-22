import { createLearningStore } from './learningStore.mjs';
import { createPostgresLearningStore } from './postgresLearningStore.mjs';

export function createLearningStoreForRuntime(runtime = {}) {
  if (runtime.mode === 'postgres') return createPostgresLearningStore(runtime);
  return createLearningStore();
}

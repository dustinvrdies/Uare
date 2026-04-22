import { createCadExecutionStore } from '../src/store/cadExecutionStore.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = createCadExecutionStore({ mode: 'memory' });
assert(typeof store.saveExecution === 'function', 'cadExecutionStore should expose saveExecution');
assert(typeof store.linkExecutionToProject === 'function', 'cadExecutionStore should expose linkExecutionToProject');
console.log('cadExecutionStore.test.mjs passed');

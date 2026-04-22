import { createJobStore } from '../src/jobs/jobStore.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = createJobStore();
await store.create('solver', { job_id: 'solver-persist-1', status: 'queued', payload_json: { a: 1 } });
await store.update('solver', 'solver-persist-1', { status: 'completed', result_json: { feasible: true } });
const solver = await store.get('solver', 'solver-persist-1');
assert(solver.status === 'completed', 'expected solver job update to persist');
assert(solver.result_json.feasible === true, 'expected solver result_json');

await store.create('cad', { execution_id: 'cad-persist-1', status: 'queued', payload_json: { plan: true } });
await store.create('patent', { search_id: 'patent-persist-1', status: 'completed', request_json: { query: 'hinge' }, response_json: { results: [] } });
const patent = await store.get('patent', 'patent-persist-1');
assert(patent.request_json.query === 'hinge', 'expected patent request persistence');
const list = await store.list('cad', 10);
assert(list.length === 1, 'expected cad list length');
console.log('jobStorePersistence.test.mjs passed');

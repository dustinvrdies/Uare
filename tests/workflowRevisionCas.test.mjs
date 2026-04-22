import { createWorkflowStore } from '../src/workflows/workflowStore.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = createWorkflowStore();
const created = store.create({
  run_id: 'wf-cas-1',
  workflow_type: 'cad_solver_pipeline',
  status: 'queued',
  current_step: 'submitted',
  requested_steps: ['cad', 'solver'],
  payload_json: {},
  state_json: { step_status: { cad: 'pending', solver: 'pending' } },
  metadata_json: {},
});

assert(created.revision === 0, 'new workflow revision should start at 0');

const updated = store.updateConditional(created.run_id, created.revision, { status: 'running' });
assert(updated.revision === 1, 'successful CAS update should increment revision');
assert(updated.status === 'running', 'successful CAS update should apply patch');

let conflictCaught = false;
try {
  store.updateConditional(created.run_id, 0, { status: 'failed' });
} catch (error) {
  conflictCaught = error?.code === 'WORKFLOW_REVISION_CONFLICT';
}

assert(conflictCaught, 'stale CAS update should raise revision conflict');
console.log('workflowRevisionCas.test.mjs passed');

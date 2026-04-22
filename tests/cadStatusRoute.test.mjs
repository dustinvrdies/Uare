import { createCadTestHarness } from './helpers/testHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { cadExecutionService } = createCadTestHarness();

const created = await cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  recipe: { parameters: { bracket_length_mm: 100 } },
  script: 'print("cad")'
}, { id: 'tester' });

const loaded = cadExecutionService.getStatus(created.execution_id);
assert(loaded?.execution_id === created.execution_id, 'status route should reload manifest');
console.log('cadStatusRoute.test.mjs passed');

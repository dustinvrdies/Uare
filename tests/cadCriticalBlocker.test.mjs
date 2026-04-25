import { createCadTestHarness } from './helpers/testHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const blockerHarness = createCadTestHarness();
let blocked = false;
try {
  await blockerHarness.cadExecutionService.execute({
    engine: 'cadquery',
    ready_for_execution: true,
    manufacturability: { manufacturable: true },
    parts: [
      {
        id: 'oversized-unsafe-part',
        name: 'Oversized Unsafe Part',
        type: 'box',
        kind: 'mechanical',
        material: 'steel',
        process: 'cnc',
        dims: { x: 12001, y: 50, z: 50 },
        position: [0, 0, 0],
      },
    ],
    script: 'print("blocked")',
  }, { id: 'tester' });
} catch (error) {
  blocked = true;
  assert(error.statusCode === 422, 'critical guardrail block should return 422 status code');
  assert(error.code === 'CAD_GUARDRAIL_BLOCKED', 'critical guardrail block should expose stable error code');
}
assert(blocked, 'CAD execution should be blocked on critical guardrail failure without override token');

const autoRepairHarness = createCadTestHarness();
const autoRepairManifest = await autoRepairHarness.cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturability: { manufacturable: true },
  parts: [
    {
      id: 'pcb-cnc-autorepair',
      name: 'PCB Auto Repair',
      type: 'pcb',
      kind: 'electrical_pcb',
      material: 'fr4',
      process: 'cnc',
      dims: { x: 100, y: 80, z: 1.6 },
      position: [0, 0, 0],
    },
  ],
  script: 'print("auto-repair")',
}, { id: 'tester' });

assert(autoRepairManifest.execution_id, 'auto-repair execution should still produce manifest');
assert(Array.isArray(autoRepairManifest.auto_repair?.applied_fixes) && autoRepairManifest.auto_repair.applied_fixes.length > 0, 'auto-repair should apply at least one fix');

const overrideHarness = createCadTestHarness();
overrideHarness.runtime.cadGuardrailOverrideToken = 'force-cad-override';
const manifest = await overrideHarness.cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturability: { manufacturable: true },
  engineering_override_token: 'force-cad-override',
  parts: [
    {
      id: 'oversized-override',
      name: 'Override Unsafe Part',
      type: 'box',
      kind: 'mechanical',
      material: 'steel',
      process: 'cnc',
      dims: { x: 12001, y: 50, z: 50 },
      position: [0, 0, 0],
    },
  ],
  script: 'print("override")',
}, { id: 'tester' });

assert(manifest.execution_id, 'override execution should still produce a manifest');
assert(manifest.engineering_guardrail_policy?.override_used === true, 'manifest should indicate explicit override usage');

console.log('cadCriticalBlocker.test.mjs passed');

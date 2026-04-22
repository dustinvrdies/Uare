import fs from 'fs';
import path from 'path';
import { createCadTestHarness } from './helpers/testHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { artifactStore, cadExecutionService } = createCadTestHarness();
const manifest = await cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  recipe: { parameters: { bracket_length_mm: 90, bracket_width_mm: 30, bracket_height_mm: 20 } },
  script: 'print("cad")'
}, { id: 'tester' });

const previewPath = path.join(artifactStore.executionDir(manifest.execution_id), 'preview.html');
assert(fs.existsSync(previewPath), 'preview.html should exist');
assert(manifest.artifacts.some((artifact) => artifact.filename === 'preview.html'), 'manifest should expose preview artifact');
console.log('cadArtifactServingPlan.test.mjs passed');

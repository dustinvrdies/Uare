import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArtifactStore } from '../../src/cad/artifactStore.mjs';
import { createStorageAdapter } from '../../src/cad/storageAdapter.mjs';
import { createCadExecutionService } from '../../src/cad/executionService.mjs';

function logger() {
  return { info() {}, warn() {}, error() {} };
}

function cadExecutionStore() {
  return {
    async saveExecution() {},
    async linkExecutionToProject() {},
  };
}

export function createCadTestHarness() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uare-cad-test-'));
  const runtime = {
    cadKernelEnabled: false,
    artifactBaseUrl: '',
    artifactStorageMode: 'local',
    artifactUrlMode: 'public',
  };
  const artifactStore = createArtifactStore(path.join(tempRoot, 'artifacts'));
  const storageAdapter = createStorageAdapter(path.join(tempRoot, 'artifacts'));
  const cadExecutionService = createCadExecutionService(runtime, artifactStore, storageAdapter, cadExecutionStore(), logger());

  return { tempRoot, runtime, artifactStore, storageAdapter, cadExecutionService };
}

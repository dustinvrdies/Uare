import { readBackendRuntime } from '../src/config/runtime.mjs';
import { createArtifactStore } from '../src/cad/artifactStore.mjs';
import { createCadStorageProvider } from '../src/cad/providerFactory.mjs';
import { createCadExecutionStore } from '../src/store/cadExecutionStore.mjs';
import { createCadExecutionService } from '../src/cad/executionService.mjs';
import { resolveFromImportMeta } from '../src/platform/paths.mjs';
import { createLogger } from '../src/logging/logger.mjs';

const runtime = readBackendRuntime(process.env);
const logger = createLogger(runtime);
const artifactStore = createArtifactStore(runtime.artifactRootDir || resolveFromImportMeta(import.meta.url, '../artifacts'));
const storageAdapter = createCadStorageProvider(runtime);
const cadExecutionStore = createCadExecutionStore(runtime);
const cadExecutionService = createCadExecutionService(runtime, artifactStore, storageAdapter, cadExecutionStore, logger);

const payload = JSON.parse(process.argv[2] || '{}');
const actor = { id: payload?.actor_id || 'autonomous-worker' };
const manifest = await cadExecutionService.execute(payload?.plan || {}, actor, {
  executionId: payload?.execution_id,
  executionTarget: 'subprocess',
});
process.stdout.write(`${JSON.stringify({ manifest })}\n`);

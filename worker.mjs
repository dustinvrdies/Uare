import { readBackendRuntime } from './src/config/runtime.mjs';
import { createLearningStoreForRuntime } from './src/store/learningStoreFactory.mjs';
import { createTaskStoreForRuntime } from './src/workers/taskStoreFactory.mjs';
import { createArtifactStore } from './src/cad/artifactStore.mjs';
import { createCadStorageProvider } from './src/cad/providerFactory.mjs';
import { createCadExecutionStore } from './src/store/cadExecutionStore.mjs';
import { resolveFromImportMeta } from './src/platform/paths.mjs';
import { createCadExecutionService } from './src/cad/executionService.mjs';
import { createLogger } from './src/logging/logger.mjs';
import { createSolverJobService } from './src/solver/solverJobService.mjs';
import { deriveCadLearningEvent } from './src/learning/eventFactory.mjs';
import { createAutonomousWorkerService } from './src/workers/autonomousWorker.mjs';
import { createEventBus } from './src/events/pubsub.mjs';
import { createWorkerTelemetry } from './src/metrics/workerTelemetry.mjs';
import { createReplayStoreForRuntime } from './src/events/replayStore.mjs';
import { createJobStoreForRuntime } from './src/jobs/jobStoreFactory.mjs';
import { createWorkflowStoreForRuntime } from './src/workflows/workflowStoreFactory.mjs';
import { createWorkflowService } from './src/workflows/workflowService.mjs';
import { createPhysicsJobService } from './src/physics/jobService.mjs';

const runtime = readBackendRuntime({
  ...process.env,
  AUTONOMOUS_WORKER_ENABLED: process.env.AUTONOMOUS_WORKER_ENABLED || 'true',
});
const logger = createLogger(runtime);
const replayStore = createReplayStoreForRuntime(runtime);
const eventBus = createEventBus(runtime, logger, { replayStore });
const telemetry = createWorkerTelemetry(runtime, logger, eventBus);

if (runtime.eventReplayArchiveEnabled && typeof replayStore.archive === 'function') {
  setInterval(() => {
    replayStore.archive({ limit: runtime.eventReplayArchiveBatchSize }).catch(() => {});
  }, runtime.eventReplayArchiveIntervalMs).unref();
}

const artifactStore = createArtifactStore(runtime.artifactRootDir || resolveFromImportMeta(import.meta.url, './artifacts'));
const storageAdapter = createCadStorageProvider(runtime);
const cadExecutionStore = createCadExecutionStore(runtime);
const learningStore = createLearningStoreForRuntime(runtime);
const cadExecutionService = createCadExecutionService(runtime, artifactStore, storageAdapter, cadExecutionStore, logger);
const taskStore = createTaskStoreForRuntime(runtime, { eventBus, telemetry });
const jobStore = createJobStoreForRuntime(runtime);
const solverJobService = createSolverJobService(learningStore, jobStore);
const workflowStore = createWorkflowStoreForRuntime(runtime);
const physicsJobService = createPhysicsJobService(runtime, jobStore, taskStore);
const workflowService = createWorkflowService(runtime, workflowStore, taskStore, jobStore, cadExecutionService, solverJobService, learningStore, physicsJobService);

const workerHandlers = {
  async completeSolverTask(task, actor, body = {}) {
    const localJob = (await solverJobService.findJob(task.source_id || task.payload?.job_id)) || task.payload?.job || null;
    if (!localJob) throw new Error('Solver job not found for task completion');
    const result = body?.result || (await solverJobService.runJobLocally(localJob, actor)).result;
    if (!body?.result) {
      await workflowService.handleSolverCompleted(localJob, result, actor, { workflow_run_id: task.metadata?.workflow_run_id || localJob.payload?.workflow_run_id || null });
      return { job: localJob, learning_event: { event_id: localJob.learning_event_id }, result };
    }
    const learningEvent = await solverJobService.finalizeJob(localJob, result, actor);
    await workflowService.handleSolverCompleted(localJob, result, actor, { workflow_run_id: task.metadata?.workflow_run_id || localJob.payload?.workflow_run_id || null });
    return { job: localJob, learning_event: learningEvent, result };
  },
  async completeCadTask(task, actor, body = {}) {
    const manifest = body?.manifest || await cadExecutionService.execute(task.payload?.plan || {}, actor, {
      executionId: task.source_id || task.payload?.execution_id,
      executionTarget: task.execution_target,
    });
    const learningEvent = await learningStore.recordEvent(deriveCadLearningEvent(manifest, actor));
    await workflowService.handleCadCompleted({ ...manifest, workflow_run_id: task.metadata?.workflow_run_id || task.payload?.plan?.workflow_run_id || null }, actor, { workflow_run_id: task.metadata?.workflow_run_id || task.payload?.plan?.workflow_run_id || null });
    return { manifest: { ...manifest, learning_event_id: learningEvent.event_id }, learning_event: learningEvent };
  },
  async completePhysicsTask(task, actor, body = {}) {
    const jobId = task.source_id || task.payload?.job_id;
    if (!jobId) throw new Error('Physics job not found for task completion');
    const job = await physicsJobService.runJob(jobId, actor);
    if (!job) throw new Error('Physics job not found for task completion');
    return { job, result: job.result_json || job.result || null };
  },
};

const autonomousWorker = createAutonomousWorkerService(runtime, taskStore, workerHandlers, logger);
await eventBus.start();
autonomousWorker.start();
logger.info('worker.service.started', {
  replay_store_mode: replayStore.mode,
  concurrency: runtime.autonomousWorkerConcurrency,
  execution_targets: runtime.autonomousWorkerExecutionTargets,
  kinds: runtime.autonomousWorkerKinds,
  event_bus_mode: eventBus.mode,
});

async function shutdown(signal) {
  logger.info('worker.service.stopping', { signal });
  await autonomousWorker.stop();
  await eventBus.stop();
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      logger.error('worker.service.shutdown_failed', { signal, error: error.message });
      process.exit(1);
    });
  });
}

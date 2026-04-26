import { loadSecrets } from './src/secrets/secretsManager.mjs';
import { requestLogging } from './src/middleware/requestLogging.mjs';
import { requestMetrics } from './src/middleware/requestMetrics.mjs';
import { notFound } from './src/middleware/notFound.mjs';
import { buildOpsRoutes } from './src/routes/ops.mjs';
import { buildOpsAlertRoutes } from './src/routes/opsAlerts.mjs';
import { buildOpsQualityRoutes } from './src/routes/opsQuality.mjs';
import { registerSubscriptionLifecycleRoutes } from './src/routes/billingLifecycle.mjs';
import { registerExportCenterRoutes } from './src/routes/exportCenter.mjs';
import express from 'express';
import cors from 'cors';
import { readBackendRuntime } from './src/config/runtime.mjs';
import { createStore } from './src/store/storeFactory.mjs';
import { buildProjectRoutes } from './src/routes/projects.mjs';
import { buildAdminRoutes } from './src/routes/admin.mjs';
import { buildCadRoutes } from './src/routes/cad.mjs';
import { buildCadHistoryRoutes } from './src/routes/cadHistory.mjs';
import { buildSolverRoutes } from './src/routes/solver.mjs';
import { buildLearningRoutes } from './src/routes/learning.mjs';
import { buildPatentRoutes } from './src/routes/patents.mjs';
import { buildWorkerRoutes } from './src/routes/workers.mjs';
import { buildFleetRoutes } from './src/routes/fleet.mjs';
import { buildAnalyticsRoutes } from './src/routes/analytics.mjs';
import { buildAuthRoutes } from './src/routes/auth.mjs';
import { buildBillingRoutes } from './src/routes/billing.mjs';
import { buildUsageRoutes } from './src/routes/usage.mjs';
import { buildCopilotRoutes } from './src/routes/copilot.mjs';
import { buildEnkiV5Routes } from './src/enki/routes.mjs';
import { buildOrgRoutes } from './src/routes/orgs.mjs';
import { createArtifactStore } from './src/cad/artifactStore.mjs';
import { createCadStorageProvider } from './src/cad/providerFactory.mjs';
import { createCadExecutionStore } from './src/store/cadExecutionStore.mjs';
import { createLearningStoreForRuntime } from './src/store/learningStoreFactory.mjs';
import { resolveFromImportMeta } from './src/platform/paths.mjs';
import { createCadExecutionService } from './src/cad/executionService.mjs';
import { createLogger } from './src/logging/logger.mjs';
import { attachRequestContext } from './src/middleware/requestContext.mjs';
import { securityHeaders } from './src/middleware/securityHeaders.mjs';
import { errorHandler } from './src/middleware/errorHandler.mjs';
import { simpleRateLimit } from './src/rateLimit/simpleRateLimit.mjs';
import { ensureJsonBody, enforceTrustedOrigin } from './src/middleware/requestValidation.mjs';
import { createAuditStore } from './src/utils/auditStore.mjs';
import { closeRedisClient } from './src/redis/client.mjs';
import { checkPgHealth } from './src/db/pg.mjs';
import { createTaskStoreForRuntime } from './src/workers/taskStoreFactory.mjs';
import { createSolverJobService } from './src/solver/solverJobService.mjs';
import { createJobStoreForRuntime } from './src/jobs/jobStoreFactory.mjs';
import { createEventBus } from './src/events/pubsub.mjs';
import { createWorkerTelemetry } from './src/metrics/workerTelemetry.mjs';
import { createReplayStoreForRuntime } from './src/events/replayStore.mjs';
import { deriveCadLearningEvent } from './src/learning/eventFactory.mjs';
import { createAutonomousWorkerService } from './src/workers/autonomousWorker.mjs';
import { createFleetAnalyticsStoreForRuntime, deriveAnalyticsRecord } from './src/analytics/fleetAnalytics.mjs';
import { createProductStoreForRuntime } from './src/product/store.mjs';
import { createWorkflowStoreForRuntime } from './src/workflows/workflowStoreFactory.mjs';
import { createWorkflowService } from './src/workflows/workflowService.mjs';
import { buildWorkflowRoutes } from './src/routes/workflows.mjs';
import { buildPortfolioRoutes } from './src/routes/portfolio.mjs';
import { buildPhysicsRoutes } from './src/routes/physics.mjs';
import { createPhysicsJobService } from './src/physics/jobService.mjs';
import { buildExperienceRoutes } from './src/routes/experience.mjs';
import { buildMissionRoutes } from './src/routes/missions.mjs';
import { buildJobRoutes } from './src/routes/jobs.mjs';
import { createExperienceService } from './src/experience/service.mjs';
import { createMissionStore } from './src/store/missionStore.mjs';

// Load secrets from the configured backend (default: env, supports: aws)
// before any runtime config is read so injected secrets are available.
await loadSecrets(process.env);

const runtime = readBackendRuntime(process.env);
const logger = createLogger(runtime);
const app = express();
app.disable('x-powered-by');
app.locals.runtime = runtime;
app.set('trust proxy', runtime.trustProxy ? 1 : false);
const store = createStore(runtime);
const artifactStore = createArtifactStore(runtime.artifactRootDir || resolveFromImportMeta(import.meta.url, './artifacts'));
const storageAdapter = createCadStorageProvider(runtime);
const cadExecutionStore = createCadExecutionStore(runtime);
const learningStore = createLearningStoreForRuntime(runtime);
const cadExecutionService = createCadExecutionService(runtime, artifactStore, storageAdapter, cadExecutionStore, logger);
const replayStore = createReplayStoreForRuntime(runtime);
const eventBus = createEventBus(runtime, logger, { replayStore });
const telemetry = createWorkerTelemetry(runtime, logger, eventBus);
const analyticsStore = createFleetAnalyticsStoreForRuntime(runtime);
const productStore = createProductStoreForRuntime(runtime);
app.locals.productStore = productStore;
const workflowStore = createWorkflowStoreForRuntime(runtime);
const missionStore = createMissionStore(runtime);
const auditStore = createAuditStore(runtime);
app.locals.auditStore = auditStore;

if (runtime.eventReplayArchiveEnabled && typeof replayStore.archive === 'function') {
  setInterval(() => {
    replayStore.archive({ limit: runtime.eventReplayArchiveBatchSize }).catch(() => {});
  }, runtime.eventReplayArchiveIntervalMs).unref();
}

const taskStore = createTaskStoreForRuntime(runtime, { eventBus, telemetry });
const jobStore = createJobStoreForRuntime(runtime);
const solverJobService = createSolverJobService(learningStore, jobStore);
const physicsJobService = createPhysicsJobService(runtime, jobStore, taskStore);
const workflowService = createWorkflowService(runtime, workflowStore, taskStore, jobStore, cadExecutionService, solverJobService, learningStore, physicsJobService);
const experienceService = createExperienceService({ workflowService, learningStore });
if (runtime.workflowWatchdogEnabled) {
  setInterval(() => {
    workflowService.sweepRuns({}, { id: 'workflow-watchdog', role: 'system' }).catch(() => {});
  }, runtime.workflowWatchdogIntervalMs).unref();
}
eventBus.subscribeAll?.(({ topic, payload }) => {
  const metric = deriveAnalyticsRecord(topic, payload);
  if (metric) analyticsStore.record(metric).catch(() => {});
});

app.use(cors({
  origin(origin, callback) {
    const allowed = new Set([...(runtime.corsAllowedOrigins || []), runtime.appBaseUrl].filter(Boolean));
    if (!origin || allowed.size === 0 || allowed.has(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: runtime.requestBodyLimit, verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(securityHeaders);
app.use(requestLogging);
app.use(requestMetrics);
app.use(simpleRateLimit({ windowMs: runtime.rateLimitWindowMs, max: runtime.rateLimitMax, runtime }));
app.use(attachRequestContext(logger, runtime));
app.use(ensureJsonBody);
app.use(enforceTrustedOrigin);

app.get('/health', async (req, res) => {
  let databaseOk = null;
  if (runtime.mode === 'postgres') {
    try { databaseOk = await checkPgHealth(runtime.databaseUrl); }
    catch (error) { databaseOk = false; }
  }
  const publicPayload = {
    ok: databaseOk !== false,
    service: 'uare-custom-backend',
    timestamp: new Date().toISOString(),
  };
  if (!runtime.publicHealthDetails) return res.json(publicPayload);
  return res.json({
    ...publicPayload,
    mode: runtime.mode,
    execution_targets: {
      solver: runtime.solverExecutionTarget,
      cad: runtime.cadExecutionTarget,
      physics: runtime.physicsExecutionTarget,
    },
    workers: {
      store_mode: taskStore.mode || 'memory',
      lease_ms: runtime.taskLeaseMs,
      max_attempts: runtime.taskMaxAttempts,
      job_store_mode: jobStore.mode || 'memory',
      event_bus_mode: eventBus.mode || 'memory',
      replay_store_mode: replayStore.mode || 'memory',
      analytics_store_mode: analyticsStore.mode || 'memory',
      billing_provider: runtime.billingProvider || 'mock',
    },
    workflows: {
      watchdog_enabled: runtime.workflowWatchdogEnabled,
      watchdog_interval_ms: runtime.workflowWatchdogIntervalMs,
      sweep_stale_ms: runtime.workflowSweepStaleMs,
      step_max_retries: runtime.workflowStepMaxRetries,
      parallel_ready_steps: runtime.workflowParallelReadySteps,
      branch_max_children: runtime.workflowBranchMaxChildren,
      branch_max_reopens: runtime.workflowBranchMaxReopens,
      branch_min_score: runtime.workflowBranchMinScore,
      lock_mode: runtime.mode === 'postgres' ? 'pg_advisory_lock' : 'in_process_mutex',
    },
    telemetry: telemetry.snapshot(),
    auth: {
      allowDevHeaderAuth: runtime.allowDevHeaderAuth,
      jwtIssuerConfigured: Boolean(runtime.jwtIssuer),
      jwtAudienceConfigured: Boolean(runtime.jwtAudience),
      jwtJwksUrlConfigured: Boolean(runtime.jwtJwksUrl)
    },
    database: { ok: databaseOk },
  });
});

app.get('/ready', async (req, res) => {
  if (runtime.mode !== 'postgres') return res.status(200).json({ ok: true, ready: true, mode: runtime.publicHealthDetails ? runtime.mode : undefined });
  try {
    const databaseOk = await checkPgHealth(runtime.databaseUrl);
    return res.status(databaseOk ? 200 : 503).json({ ok: databaseOk, ready: databaseOk, mode: runtime.publicHealthDetails ? runtime.mode : undefined });
  } catch (error) {
    return res.status(503).json({ ok: false, ready: false, error: runtime.publicHealthDetails ? error.message : 'dependency unavailable' });
  }
});

app.use('/projects', buildProjectRoutes(store, runtime, productStore));
app.use('/admin', buildAdminRoutes(runtime));
const workerHandlers = {
  async completeSolverTask(task, actor, body = {}) {
    const job = (await solverJobService.findJob(task.source_id || task.payload?.job_id)) || task.payload?.job || null;
    if (!job) throw new Error('Solver job not found for task completion');
    const result = body?.result || (await solverJobService.runJobLocally(job, actor)).result;
    if (!body?.result) {
      await workflowService.handleSolverCompleted(job, result, actor, { workflow_run_id: task.metadata?.workflow_run_id || job.payload?.workflow_run_id || null });
      return { job, learning_event: { event_id: job.learning_event_id }, result };
    }
    const learningEvent = await solverJobService.finalizeJob(job, result, actor);
    await workflowService.handleSolverCompleted(job, result, actor, { workflow_run_id: task.metadata?.workflow_run_id || job.payload?.workflow_run_id || null });
    return { job, learning_event: learningEvent, result };
  },
  async completeCadTask(task, actor, body = {}) {
    const manifest = body?.manifest || await cadExecutionService.execute(task.payload?.plan || {}, actor, {
      executionId: task.source_id || task.payload?.execution_id,
      executionTarget: task.execution_target,
    });
    const learningEvent = await learningStore.recordEvent(deriveCadLearningEvent(manifest, actor));
    await jobStore.update('cad', manifest.execution_id, { status: manifest.status || 'completed', result_json: manifest, learning_event_id: learningEvent.event_id, task_id: task.task_id });
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
const autonomousWorker = runtime.autonomousWorkerEnabled
  ? createAutonomousWorkerService(runtime, taskStore, workerHandlers, logger)
  : null;

if (runtime.metricsShipUrl) {
  setInterval(() => { telemetry.ship().catch(() => {}); }, runtime.metricsShipIntervalMs).unref();
}

app.use('/ops', buildOpsRoutes(runtime, { telemetry, taskStore, jobStore, eventBus, checkPgHealth }));
app.use('/ops/alerts', buildOpsAlertRoutes());
app.use('/ops/quality', buildOpsQualityRoutes(runtime));
app.use('/cad', buildCadRoutes(runtime, cadExecutionService, artifactStore, learningStore, taskStore, jobStore));
app.use('/cad-history', buildCadHistoryRoutes(runtime, cadExecutionStore, artifactStore));
app.use('/solver', buildSolverRoutes(runtime, solverJobService, taskStore));
app.use('/learning', buildLearningRoutes(runtime, learningStore));
app.use('/analytics', buildAnalyticsRoutes(runtime, analyticsStore));
app.use('/auth', buildAuthRoutes(runtime, productStore));
app.use('/billing', buildBillingRoutes(runtime, productStore));
app.use('/usage', buildUsageRoutes(runtime, productStore));
app.use('/copilot', buildCopilotRoutes(runtime, cadExecutionService));
app.use('/enki', buildEnkiV5Routes(runtime));
app.use('/orgs', buildOrgRoutes(runtime, productStore));
app.use('/workflows', buildWorkflowRoutes(runtime, workflowService));
app.use('/missions', buildMissionRoutes(runtime, missionStore, workflowService));
app.use('/jobs', buildJobRoutes(runtime, jobStore));
app.use('/portfolio', buildPortfolioRoutes(runtime, workflowService));
app.use('/physics', buildPhysicsRoutes(runtime, physicsJobService));
app.use('/patents', buildPatentRoutes(runtime, learningStore, jobStore));
app.use('/experience', buildExperienceRoutes(runtime, experienceService, eventBus));
app.get('/', (_req, res) => res.redirect(301, '/lab/'));
app.use('/lab', express.static(resolveFromImportMeta(import.meta.url, './public/lab')));
app.post('/api/client-error', express.json(), (req, res) => {
  const { errors } = req.body || {};
  console.error('[CLIENT-JS-ERROR]\n' + (errors || '(no error text)'));
  res.json({ ok: true });
});
app.use('/workers', buildWorkerRoutes(runtime, taskStore, workerHandlers, autonomousWorker, eventBus, telemetry));
app.use('/fleet', buildFleetRoutes(runtime, taskStore, jobStore, eventBus, telemetry, autonomousWorker));
try { registerSubscriptionLifecycleRoutes(app); } catch (err) { console.error('subscription lifecycle route registration failed', err); }
try { registerExportCenterRoutes(app); } catch (err) { console.error('export center route registration failed', err); }
app.use(notFound);
app.use(errorHandler(logger, runtime));

const server = app.listen(runtime.port, async () => {
  await eventBus.start();
  logger.info('server.started', { port: runtime.port, mode: runtime.mode, autonomous_worker_enabled: runtime.autonomousWorkerEnabled, event_bus_mode: eventBus.mode });
  if (autonomousWorker) autonomousWorker.start();
});

async function shutdown(signal) {
  logger.info('server.stopping', { signal });
  const shutdownTimer = setTimeout(() => {
    logger.error('server.shutdown_timeout', { signal, timeout_ms: runtime.gracefulShutdownTimeoutMs });
    process.exit(1);
  }, runtime.gracefulShutdownTimeoutMs);
  shutdownTimer.unref();
  if (autonomousWorker) await autonomousWorker.stop();
  await eventBus.stop();
  await closeRedisClient().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(shutdownTimer);
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      logger.error('server.shutdown_failed', { signal, error: error.message });
      process.exit(1);
    });
  });
}



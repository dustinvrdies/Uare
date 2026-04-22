import os from 'os';
import { spawn } from 'child_process';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [...fallback];
}

async function runNodeScript(command, args = [], cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `Worker subprocess exited with code ${code}`));
      }
      const trimmed = stdout.trim();
      if (!trimmed) return resolve({});
      try {
        return resolve(JSON.parse(trimmed));
      } catch (error) {
        return reject(new Error(`Worker subprocess returned invalid JSON: ${error.message}`));
      }
    });
  });
}

export function createAutonomousWorkerService(runtime = {}, taskStore, handlers = {}, logger = console) {
  const executionTargets = normalizeArray(runtime.autonomousWorkerExecutionTargets, ['queued', 'subprocess']);
  const kinds = normalizeArray(runtime.autonomousWorkerKinds, ['solver', 'cad']);
  const concurrency = Math.max(Number(runtime.autonomousWorkerConcurrency || 1), 1);
  const workerIdentity = {
    worker_id: runtime.autonomousWorkerId || `auto-${process.pid}`,
    worker_type: 'autonomous-service',
    host: os.hostname(),
    platform: process.platform,
  };

  let running = false;
  let loopPromise = null;
  let lastError = null;
  let processedCount = 0;
  const activeTasks = new Map();

  async function executeTask(task) {
    const handler = task.kind === 'solver'
      ? handlers.completeSolverTask
      : task.kind === 'cad'
        ? handlers.completeCadTask
        : task.kind === 'physics'
          ? handlers.completePhysicsTask
          : null;

    if (typeof handler !== 'function') {
      throw new Error(`No autonomous worker handler registered for task kind ${task.kind}`);
    }

    await taskStore.updateProgress(task.task_id, {
      percent: 12,
      stage: 'worker_started',
      detail: `Autonomous worker started ${task.kind} task`,
    });

    const heartbeatTimer = setInterval(() => {
      taskStore.heartbeatTask(task.task_id, workerIdentity, {
        percent: null,
        stage: 'running',
        detail: `Autonomous worker executing ${task.kind} task`,
      }).catch((error) => {
        lastError = error;
        logger.warn?.('worker.autonomous.heartbeat_failed', { task_id: task.task_id, error: error.message });
      });
    }, Math.max(Number(runtime.autonomousWorkerHeartbeatMs || 2000), 250));

    try {
      let outcome;
      if (task.execution_target === 'subprocess' && task.payload?.dispatch?.command) {
        await taskStore.updateProgress(task.task_id, {
          percent: 35,
          stage: 'subprocess_dispatch',
          detail: 'Launching subprocess worker',
        });
        const subprocessResult = await runNodeScript(
          task.payload.dispatch.command,
          task.payload.dispatch.args || [],
          process.cwd(),
        );
        await taskStore.updateProgress(task.task_id, {
          percent: 82,
          stage: 'subprocess_completed',
          detail: 'Subprocess worker finished execution',
        });
        outcome = await handler(task, workerIdentity, subprocessResult || {});
      } else {
        await taskStore.updateProgress(task.task_id, {
          percent: 55,
          stage: 'executing',
          detail: 'Running task in autonomous worker',
        });
        outcome = await handler(task, workerIdentity, {});
      }

      await taskStore.updateProgress(task.task_id, {
        percent: 95,
        stage: 'finalizing',
        detail: 'Persisting final task outcome',
      });
      await taskStore.completeTask(task.task_id, outcome);
      processedCount += 1;
      logger.info?.('worker.autonomous.task_completed', {
        task_id: task.task_id,
        kind: task.kind,
        execution_target: task.execution_target,
        processed_count: processedCount,
      });
    } catch (error) {
      lastError = error;
      await taskStore.failTask(task.task_id, error, { retryable: true });
      logger.error?.('worker.autonomous.task_failed', {
        task_id: task.task_id,
        kind: task.kind,
        execution_target: task.execution_target,
        error: error.message,
      });
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  async function claimAndRunOne(slotId) {
    let claimed = null;
    for (const kind of kinds) {
      claimed = await taskStore.claimNext({
        kind,
        execution_targets: executionTargets,
        worker: { ...workerIdentity, worker_id: `${workerIdentity.worker_id}-slot-${slotId}` },
      });
      if (claimed) break;
    }
    if (!claimed) return false;

    activeTasks.set(claimed.task_id, {
      task_id: claimed.task_id,
      kind: claimed.kind,
      execution_target: claimed.execution_target,
      slot_id: slotId,
      started_at: new Date().toISOString(),
    });
    logger.info?.('worker.autonomous.task_claimed', {
      task_id: claimed.task_id,
      kind: claimed.kind,
      execution_target: claimed.execution_target,
      slot_id: slotId,
    });

    try {
      await executeTask(claimed);
    } finally {
      activeTasks.delete(claimed.task_id);
    }
    return true;
  }

  async function runLoop() {
    while (running) {
      try {
        const availableSlots = Math.max(concurrency - activeTasks.size, 0);
        if (availableSlots === 0) {
          await wait(Math.max(Number(runtime.autonomousWorkerPollMs || 1200), 100));
          continue;
        }

        const launches = [];
        for (let slotId = 0; slotId < availableSlots; slotId += 1) {
          launches.push(claimAndRunOne(slotId));
        }
        const results = await Promise.allSettled(launches);
        const claimedAny = results.some((entry) => entry.status === 'fulfilled' && entry.value === true);
        const rejected = results.find((entry) => entry.status === 'rejected');
        if (rejected) {
          throw rejected.reason;
        }
        if (!claimedAny) {
          await wait(Math.max(Number(runtime.autonomousWorkerPollMs || 1200), 100));
        }
      } catch (error) {
        lastError = error;
        logger.error?.('worker.autonomous.loop_error', {
          error: error.message,
          active_task_ids: Array.from(activeTasks.keys()),
        });
        await wait(Math.max(Number(runtime.autonomousWorkerPollMs || 1200), 100));
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    logger.info?.('worker.autonomous.started', {
      execution_targets: executionTargets,
      kinds,
      worker_id: workerIdentity.worker_id,
      concurrency,
    });
    loopPromise = runLoop();
  }

  async function stop() {
    running = false;
    if (loopPromise) {
      await loopPromise;
      loopPromise = null;
    }
    logger.info?.('worker.autonomous.stopped', {
      worker_id: workerIdentity.worker_id,
      processed_count: processedCount,
    });
  }

  function status() {
    return {
      enabled: true,
      running,
      worker: workerIdentity,
      execution_targets: executionTargets,
      kinds,
      concurrency,
      active_tasks: Array.from(activeTasks.values()),
      active_task_count: activeTasks.size,
      processed_count: processedCount,
      last_error: lastError ? { message: lastError.message } : null,
    };
  }

  return { start, stop, status };
}

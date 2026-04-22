import crypto from 'crypto';

function makeTaskId(kind = 'task') {
  return `${kind}-task-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function addMs(dateLike, ms) {
  return new Date(new Date(dateLike).getTime() + Number(ms || 0)).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTask(input = {}, defaults = {}) {
  const submittedAt = nowIso();
  const maxAttempts = Math.max(Number(input.max_attempts || defaults.maxAttempts || 3), 1);
  return {
    task_id: String(input.task_id || makeTaskId(input.kind || 'task')),
    kind: String(input.kind || 'generic'),
    source_id: input.source_id || null,
    execution_target: String(input.execution_target || 'queued'),
    status: 'pending',
    payload: clone(input.payload || {}),
    worker_claim: null,
    result: null,
    submitted_at: submittedAt,
    started_at: null,
    completed_at: null,
    error: null,
    metadata: clone(input.metadata || {}),
    dedupe_key: input.dedupe_key || input.metadata?.dedupe_key || null,
    lease_expires_at: null,
    heartbeat_at: null,
    timeout_recovered_at: null,
    attempts: 0,
    max_attempts: maxAttempts,
    retry_count: 0,
    progress: {
      percent: 0,
      stage: 'submitted',
      detail: 'Task submitted',
      updated_at: submittedAt,
    },
    logs: [{
      at: submittedAt,
      level: 'info',
      message: 'Task submitted',
      event_type: 'task_submitted',
    }],
  };
}

function hasExpiredLease(task, now = Date.now()) {
  if (!task?.lease_expires_at) return false;
  return new Date(task.lease_expires_at).getTime() <= now;
}

export function createTaskStore(options = {}) {
  const tasks = [];
  const eventBus = options.eventBus || null;
  const telemetry = options.telemetry || null;
  const defaults = {
    leaseMs: Math.max(Number(options.leaseMs || 300000), 1),
    maxAttempts: Math.max(Number(options.maxAttempts || 3), 1),
    progressLogLimit: Math.max(Number(options.progressLogLimit || 200), 20),
  };

  function emitTask(task, event = 'task_updated') {
    const snapshot = clone(task);
    eventBus?.publishTask(snapshot.task_id, { event, task: snapshot, at: nowIso() });
    telemetry?.setGauge?.('worker_task_progress_percent', Number(snapshot.progress?.percent || 0), { kind: snapshot.kind, status: snapshot.status });
    telemetry?.inc?.(`worker_task_${event}`, 1, { kind: snapshot.kind, status: snapshot.status });
  }

  function trimLogs(task) {
    if (Array.isArray(task.logs) && task.logs.length > defaults.progressLogLimit) {
      task.logs = task.logs.slice(task.logs.length - defaults.progressLogLimit);
    }
  }

  function appendLog(task, entry = {}) {
    task.logs = Array.isArray(task.logs) ? task.logs : [];
    task.logs.push({
      at: entry.at || nowIso(),
      level: entry.level || 'info',
      message: String(entry.message || ''),
      event_type: entry.event_type || 'task_log',
      detail: entry.detail || null,
      worker_id: entry.worker_id || task.worker_claim?.worker_id || null,
    });
    trimLogs(task);
    return task;
  }

  function recoverExpiredTasks() {
    const now = Date.now();
    for (const task of tasks) {
      if (task.status !== 'running' || !hasExpiredLease(task, now)) continue;
      if (task.attempts >= task.max_attempts) {
        task.status = 'failed';
        task.completed_at = nowIso();
        task.error = 'Task lease expired and max attempts reached';
        appendLog(task, { level: 'error', message: 'Task lease expired and max attempts reached', event_type: 'task_timeout_failed' });
        emitTask(task, 'task_timeout_failed');
        continue;
      }
      task.status = 'pending';
      task.timeout_recovered_at = nowIso();
      task.retry_count += 1;
      task.worker_claim = null;
      task.started_at = null;
      task.lease_expires_at = null;
      task.heartbeat_at = null;
      task.progress = {
        percent: Math.max(Number(task.progress?.percent || 0), 0),
        stage: 'requeued_after_timeout',
        detail: 'Lease expired; task returned to queue',
        updated_at: task.timeout_recovered_at,
      };
      appendLog(task, { level: 'warn', message: 'Task lease expired and task was returned to queue', event_type: 'task_timeout_requeued' });
      emitTask(task, 'task_timeout_requeued');
    }
  }

  function submitTask(input = {}) {
    const task = normalizeTask(input, defaults);
    if (task.dedupe_key) {
      const existing = tasks.find((entry) => entry.dedupe_key === task.dedupe_key && ['pending', 'running'].includes(entry.status));
      if (existing) return existing;
    }
    tasks.unshift(task);
    emitTask(task, 'task_submitted');
    return task;
  }

  function getTask(taskId) {
    recoverExpiredTasks();
    return tasks.find((entry) => entry.task_id === taskId) || null;
  }

  function claimNext({ kind = null, execution_targets = [], worker = {} } = {}) {
    recoverExpiredTasks();
    const task = tasks.find((entry) => {
      if (entry.status !== 'pending') return false;
      if (kind && entry.kind !== kind) return false;
      if (Array.isArray(execution_targets) && execution_targets.length > 0 && !execution_targets.includes(entry.execution_target)) return false;
      return true;
    });
    if (!task) return null;
    const claimedAt = nowIso();
    task.status = 'running';
    task.started_at = task.started_at || claimedAt;
    task.attempts += 1;
    task.lease_expires_at = addMs(claimedAt, defaults.leaseMs);
    task.heartbeat_at = claimedAt;
    task.worker_claim = {
      worker_id: worker.worker_id || 'worker-default',
      worker_type: worker.worker_type || 'generic',
      claimed_at: claimedAt,
      host: worker.host || null,
      platform: worker.platform || null,
      lease_expires_at: task.lease_expires_at,
    };
    task.progress = {
      percent: Math.max(Number(task.progress?.percent || 0), 1),
      stage: 'claimed',
      detail: 'Worker claimed task',
      updated_at: claimedAt,
    };
    appendLog(task, { message: 'Worker claimed task', event_type: 'task_claimed', worker_id: task.worker_claim.worker_id });
    emitTask(task, 'task_claimed');
    return task;
  }

  function heartbeatTask(taskId, worker = {}, progress = null) {
    const task = getTask(taskId);
    if (!task) return null;
    if (task.status !== 'running') return task;
    const heartbeatAt = nowIso();
    task.heartbeat_at = heartbeatAt;
    task.lease_expires_at = addMs(heartbeatAt, defaults.leaseMs);
    if (task.worker_claim) {
      task.worker_claim.last_heartbeat_at = heartbeatAt;
      task.worker_claim.lease_expires_at = task.lease_expires_at;
      if (worker.worker_id) task.worker_claim.worker_id = worker.worker_id;
      if (worker.worker_type) task.worker_claim.worker_type = worker.worker_type;
      if (worker.host) task.worker_claim.host = worker.host;
      if (worker.platform) task.worker_claim.platform = worker.platform;
    }
    if (progress) updateProgress(taskId, progress, { emitLog: false });
    appendLog(task, { message: 'Task heartbeat received', event_type: 'task_heartbeat', worker_id: task.worker_claim?.worker_id || worker.worker_id || null, detail: progress || null });
    emitTask(task, 'task_heartbeat');
    return task;
  }

  function updateProgress(taskId, progress = {}, options = {}) {
    const task = getTask(taskId);
    if (!task) return null;
    const updatedAt = nowIso();
    const nextPercent = progress.percent == null ? Number(task.progress?.percent || 0) : Math.max(0, Math.min(100, Number(progress.percent || 0)));
    task.progress = {
      percent: nextPercent,
      stage: progress.stage || task.progress?.stage || 'running',
      detail: progress.detail || task.progress?.detail || null,
      updated_at: updatedAt,
      metrics: progress.metrics || task.progress?.metrics || null,
    };
    if (options.emitLog !== false) {
      appendLog(task, { message: progress.message || `Task progress updated to ${task.progress.percent}%`, event_type: 'task_progress', detail: task.progress });
    }
    emitTask(task, 'task_progress');
    return task;
  }

  function completeTask(taskId, result = {}) {
    const task = getTask(taskId);
    if (!task) return null;
    task.status = 'completed';
    task.completed_at = nowIso();
    task.result = result;
    task.error = null;
    task.lease_expires_at = null;
    task.heartbeat_at = task.completed_at;
    task.progress = { percent: 100, stage: 'completed', detail: 'Task completed successfully', updated_at: task.completed_at };
    appendLog(task, { message: 'Task completed successfully', event_type: 'task_completed' });
    emitTask(task, 'task_completed');
    return task;
  }

  function failTask(taskId, error, options = {}) {
    const task = getTask(taskId);
    if (!task) return null;
    const retryable = Boolean(options.retryable);
    const at = nowIso();
    const errorMessage = String(error?.message || error || 'Task failed');
    if (retryable && task.attempts < task.max_attempts) {
      task.status = 'pending';
      task.error = errorMessage;
      task.completed_at = null;
      task.lease_expires_at = null;
      task.heartbeat_at = at;
      task.worker_claim = null;
      task.retry_count += 1;
      task.progress = { percent: Number(task.progress?.percent || 0), stage: 'retry_queued', detail: errorMessage, updated_at: at };
      appendLog(task, { level: 'warn', message: `Task failed and was re-queued: ${errorMessage}`, event_type: 'task_requeued' });
      emitTask(task, 'task_requeued');
      return task;
    }
    task.status = 'failed';
    task.completed_at = at;
    task.error = errorMessage;
    task.lease_expires_at = null;
    task.progress = { percent: Number(task.progress?.percent || 0), stage: 'failed', detail: errorMessage, updated_at: at };
    appendLog(task, { level: 'error', message: errorMessage, event_type: 'task_failed' });
    emitTask(task, 'task_failed');
    return task;
  }

  function listTasks(limit = 100, filters = {}) {
    recoverExpiredTasks();
    let results = [...tasks];
    if (filters.kind) results = results.filter((entry) => entry.kind === filters.kind);
    if (filters.status) results = results.filter((entry) => entry.status === filters.status);
    if (filters.execution_target) results = results.filter((entry) => entry.execution_target === filters.execution_target);
    if (filters.source_id) results = results.filter((entry) => entry.source_id === filters.source_id);
    if (filters.dedupe_key) results = results.filter((entry) => entry.dedupe_key === filters.dedupe_key);
    return results.slice(0, limit);
  }

  function listTaskEvents(taskId, limit = 100) {
    const task = getTask(taskId);
    if (!task) return null;
    return [...(task.logs || [])].slice(-(Math.max(Number(limit || 100), 1)));
  }

  return {
    mode: 'memory',
    submitTask,
    getTask,
    claimNext,
    heartbeatTask,
    updateProgress,
    completeTask,
    failTask,
    listTasks,
    listTaskEvents,
    recoverExpiredTasks,
  };
}

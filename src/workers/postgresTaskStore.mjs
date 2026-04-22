import crypto from 'crypto';
import { withPgClient } from '../db/pg.mjs';

function makeTaskId(kind = 'task') {
  return `${kind}-task-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function addMs(dateLike, ms) {
  return new Date(new Date(dateLike).getTime() + Number(ms || 0)).toISOString();
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRow(row) {
  if (!row) return null;
  return {
    task_id: row.task_id,
    kind: row.kind,
    source_id: row.source_id,
    execution_target: row.execution_target,
    status: row.status,
    payload: parseJson(row.payload, {}),
    worker_claim: parseJson(row.worker_claim, null),
    result: parseJson(row.result, null),
    submitted_at: row.submitted_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error: row.error,
    metadata: parseJson(row.metadata, {}),
    dedupe_key: row.dedupe_key || null,
    lease_expires_at: row.lease_expires_at,
    heartbeat_at: row.heartbeat_at,
    timeout_recovered_at: row.timeout_recovered_at,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    retry_count: Number(row.retry_count || 0),
    progress: parseJson(row.progress, {}),
    logs: parseJson(row.logs, []),
  };
}

export function createPostgresTaskStore(runtime = {}, options = {}) {
  const connectionString = runtime.databaseUrl;
  const leaseMs = Math.max(Number(options.leaseMs || runtime.taskLeaseMs || 300000), 1);
  const maxAttempts = Math.max(Number(options.maxAttempts || runtime.taskMaxAttempts || 3), 1);
  const eventBus = options.eventBus || null;
  const telemetry = options.telemetry || null;

  function emitTask(task, event = 'task_updated') {
    if (!task) return;
    const snapshot = JSON.parse(JSON.stringify(task));
    eventBus?.publishTask?.(snapshot.task_id, { event, task: snapshot, at: nowIso() });
    telemetry?.setGauge?.('worker_task_progress_percent', Number(snapshot.progress?.percent || 0), { kind: snapshot.kind, status: snapshot.status });
    telemetry?.inc?.(`worker_task_${event}`, 1, { kind: snapshot.kind, status: snapshot.status });
  }

  async function recoverExpiredTasks() {
    return withPgClient(connectionString, async (client) => {
      const sql = `
        update worker_tasks
        set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
            timeout_recovered_at = $1,
            completed_at = case when attempts >= max_attempts then $1 else completed_at end,
            error = case when attempts >= max_attempts then 'Task lease expired and max attempts reached' else error end,
            retry_count = case when attempts >= max_attempts then retry_count else retry_count + 1 end,
            worker_claim = case when attempts >= max_attempts then worker_claim else null end,
            lease_expires_at = null,
            heartbeat_at = $1,
            progress = case
              when attempts >= max_attempts then jsonb_build_object('percent', coalesce((progress->>'percent')::numeric, 0), 'stage', 'failed', 'detail', 'Task lease expired and max attempts reached', 'updated_at', $1)
              else jsonb_build_object('percent', coalesce((progress->>'percent')::numeric, 0), 'stage', 'requeued_after_timeout', 'detail', 'Lease expired; task returned to queue', 'updated_at', $1)
            end,
            logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'at', $1,
                'level', case when attempts >= max_attempts then 'error' else 'warn' end,
                'message', case when attempts >= max_attempts then 'Task lease expired and max attempts reached' else 'Task lease expired and task was returned to queue' end,
                'event_type', case when attempts >= max_attempts then 'task_timeout_failed' else 'task_timeout_requeued' end
              )
            )
        where status = 'running' and lease_expires_at is not null and lease_expires_at <= $1
        returning *;
      `;
      const result = await client.query(sql, [nowIso()]);
      const recovered = result.rows.map(mapRow);
      for (const task of recovered) {
        emitTask(task, task.status === 'failed' ? 'task_timeout_failed' : 'task_timeout_requeued');
      }
      return recovered;
    });
  }

  async function submitTask(input = {}) {
    const submittedAt = nowIso();
    const task = {
      task_id: String(input.task_id || makeTaskId(input.kind || 'task')),
      kind: String(input.kind || 'generic'),
      source_id: input.source_id || null,
      execution_target: String(input.execution_target || 'queued'),
      status: 'pending',
      payload: input.payload || {},
      worker_claim: null,
      result: null,
      submitted_at: submittedAt,
      started_at: null,
      completed_at: null,
      error: null,
      metadata: input.metadata || {},
      dedupe_key: input.dedupe_key || input.metadata?.dedupe_key || null,
      lease_expires_at: null,
      heartbeat_at: null,
      timeout_recovered_at: null,
      attempts: 0,
      max_attempts: Math.max(Number(input.max_attempts || maxAttempts), 1),
      retry_count: 0,
      progress: { percent: 0, stage: 'submitted', detail: 'Task submitted', updated_at: submittedAt },
      logs: [{ at: submittedAt, level: 'info', message: 'Task submitted', event_type: 'task_submitted' }],
    };
    const inserted = await withPgClient(connectionString, async (client) => {
      const result = await client.query(`
        insert into worker_tasks (
          task_id, kind, source_id, execution_target, status, payload, worker_claim, result,
          submitted_at, started_at, completed_at, error, metadata, dedupe_key, lease_expires_at,
          heartbeat_at, timeout_recovered_at, attempts, max_attempts, retry_count, progress, logs
        ) values (
          $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb
        )
        on conflict do nothing
        returning *
      `, [
        task.task_id, task.kind, task.source_id, task.execution_target, task.status,
        JSON.stringify(task.payload), JSON.stringify(task.worker_claim), JSON.stringify(task.result),
        task.submitted_at, task.started_at, task.completed_at, task.error, JSON.stringify(task.metadata), task.dedupe_key,
        task.lease_expires_at, task.heartbeat_at, task.timeout_recovered_at, task.attempts, task.max_attempts,
        task.retry_count, JSON.stringify(task.progress), JSON.stringify(task.logs),
      ]);
      if (result.rows[0]) return mapRow(result.rows[0]);
      if (task.dedupe_key) {
        const existing = await client.query(`select * from worker_tasks where dedupe_key = $1 and status in ('pending','running') order by submitted_at desc limit 1`, [task.dedupe_key]);
        return mapRow(existing.rows[0]);
      }
      return null;
    });
    if (inserted) emitTask(inserted, 'task_submitted');
    return inserted;
  }

  async function getTask(taskId) {
    await recoverExpiredTasks();
    return withPgClient(connectionString, async (client) => {
      const result = await client.query('select * from worker_tasks where task_id = $1 limit 1', [taskId]);
      return mapRow(result.rows[0]);
    });
  }

  async function claimNext({ kind = null, execution_targets = [], worker = {} } = {}) {
    await recoverExpiredTasks();
    return withPgClient(connectionString, async (client) => {
      await client.query('begin');
      try {
        const params = [];
        let idx = 1;
        let where = `status = 'pending'`;
        if (kind) {
          where += ` and kind = $${idx++}`;
          params.push(kind);
        }
        if (Array.isArray(execution_targets) && execution_targets.length > 0) {
          where += ` and execution_target = any($${idx++})`;
          params.push(execution_targets);
        }
        const selected = await client.query(`select * from worker_tasks where ${where} order by submitted_at asc limit 1 for update skip locked`, params);
        if (!selected.rows[0]) {
          await client.query('rollback');
          return null;
        }
        const row = selected.rows[0];
        const claimedAt = nowIso();
        const workerClaim = {
          worker_id: worker.worker_id || 'worker-default',
          worker_type: worker.worker_type || 'generic',
          claimed_at: claimedAt,
          host: worker.host || null,
          platform: worker.platform || null,
          lease_expires_at: addMs(claimedAt, leaseMs),
        };
        const progress = { percent: 1, stage: 'claimed', detail: 'Worker claimed task', updated_at: claimedAt };
        const logs = parseJson(row.logs, []);
        logs.push({ at: claimedAt, level: 'info', message: 'Worker claimed task', event_type: 'task_claimed', worker_id: workerClaim.worker_id });
        const updated = await client.query(`
          update worker_tasks
          set status='running',
              started_at=coalesce(started_at, $2),
              attempts=attempts + 1,
              worker_claim=$3::jsonb,
              lease_expires_at=$4,
              heartbeat_at=$2,
              progress=$5::jsonb,
              logs=$6::jsonb
          where task_id = $1
          returning *
        `, [row.task_id, claimedAt, JSON.stringify(workerClaim), workerClaim.lease_expires_at, JSON.stringify(progress), JSON.stringify(logs)]);
        await client.query('commit');
        const task = mapRow(updated.rows[0]);
        emitTask(task, 'task_claimed');
        return task;
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
  }

  async function heartbeatTask(taskId, worker = {}, progress = null) {
    const task = await getTask(taskId);
    if (!task) return null;
    if (task.status !== 'running') return task;
    const heartbeatAt = nowIso();
    const workerClaim = {
      ...(task.worker_claim || {}),
      worker_id: worker.worker_id || task.worker_claim?.worker_id || null,
      worker_type: worker.worker_type || task.worker_claim?.worker_type || null,
      host: worker.host || task.worker_claim?.host || null,
      platform: worker.platform || task.worker_claim?.platform || null,
      last_heartbeat_at: heartbeatAt,
      lease_expires_at: addMs(heartbeatAt, leaseMs),
    };
    const nextProgress = progress ? {
      percent: progress.percent == null ? Number(task.progress?.percent || 0) : Math.max(0, Math.min(100, Number(progress.percent || 0))),
      stage: progress.stage || task.progress?.stage || 'running',
      detail: progress.detail || task.progress?.detail || null,
      updated_at: heartbeatAt,
      metrics: progress.metrics || task.progress?.metrics || null,
    } : task.progress;
    const logs = [...(task.logs || []), { at: heartbeatAt, level: 'info', message: 'Task heartbeat received', event_type: 'task_heartbeat', worker_id: workerClaim.worker_id, detail: progress || null }];
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(`
        update worker_tasks
        set worker_claim=$2::jsonb,
            lease_expires_at=$3,
            heartbeat_at=$4,
            progress=$5::jsonb,
            logs=$6::jsonb
        where task_id = $1
        returning *
      `, [taskId, JSON.stringify(workerClaim), workerClaim.lease_expires_at, heartbeatAt, JSON.stringify(nextProgress), JSON.stringify(logs)]);
      const nextTask = mapRow(result.rows[0]);
      emitTask(nextTask, 'task_heartbeat');
      return nextTask;
    });
  }

  async function updateProgress(taskId, progress = {}, options = {}) {
    const task = await getTask(taskId);
    if (!task) return null;
    const updatedAt = nowIso();
    const nextProgress = {
      percent: progress.percent == null ? Number(task.progress?.percent || 0) : Math.max(0, Math.min(100, Number(progress.percent || 0))),
      stage: progress.stage || task.progress?.stage || 'running',
      detail: progress.detail || task.progress?.detail || null,
      updated_at: updatedAt,
      metrics: progress.metrics || task.progress?.metrics || null,
    };
    const logs = options.emitLog === false ? (task.logs || []) : [...(task.logs || []), { at: updatedAt, level: 'info', message: progress.message || `Task progress updated to ${nextProgress.percent}%`, event_type: 'task_progress', detail: nextProgress }];
    return withPgClient(connectionString, async (client) => {
      const result = await client.query('update worker_tasks set progress=$2::jsonb, logs=$3::jsonb where task_id = $1 returning *', [taskId, JSON.stringify(nextProgress), JSON.stringify(logs)]);
      const nextTask = mapRow(result.rows[0]);
      emitTask(nextTask, 'task_progress');
      return nextTask;
    });
  }

  async function completeTask(taskId, resultPayload = {}) {
    const task = await getTask(taskId);
    if (!task) return null;
    const completedAt = nowIso();
    const logs = [...(task.logs || []), { at: completedAt, level: 'info', message: 'Task completed successfully', event_type: 'task_completed' }];
    const progress = { percent: 100, stage: 'completed', detail: 'Task completed successfully', updated_at: completedAt };
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(`update worker_tasks set status='completed', completed_at=$2, result=$3::jsonb, error=null, lease_expires_at=null, heartbeat_at=$2, progress=$4::jsonb, logs=$5::jsonb where task_id = $1 returning *`, [taskId, completedAt, JSON.stringify(resultPayload), JSON.stringify(progress), JSON.stringify(logs)]);
      const nextTask = mapRow(result.rows[0]);
      emitTask(nextTask, 'task_completed');
      return nextTask;
    });
  }

  async function failTask(taskId, error, options = {}) {
    const task = await getTask(taskId);
    if (!task) return null;
    const at = nowIso();
    const errorMessage = String(error?.message || error || 'Task failed');
    const retryable = Boolean(options.retryable) && task.attempts < task.max_attempts;
    const nextStatus = retryable ? 'pending' : 'failed';
    const progress = {
      percent: Number(task.progress?.percent || 0),
      stage: retryable ? 'retry_queued' : 'failed',
      detail: errorMessage,
      updated_at: at,
    };
    const logs = [...(task.logs || []), {
      at,
      level: retryable ? 'warn' : 'error',
      message: retryable ? `Task failed and was re-queued: ${errorMessage}` : errorMessage,
      event_type: retryable ? 'task_requeued' : 'task_failed',
    }];
    return withPgClient(connectionString, async (client) => {
      const result = await client.query(`
        update worker_tasks
        set status=$2,
            completed_at=$3,
            error=$4,
            lease_expires_at=null,
            worker_claim=case when $5 then null else worker_claim end,
            retry_count=case when $5 then retry_count + 1 else retry_count end,
            progress=$6::jsonb,
            logs=$7::jsonb
        where task_id = $1
        returning *
      `, [taskId, nextStatus, retryable ? null : at, errorMessage, retryable, JSON.stringify(progress), JSON.stringify(logs)]);
      return mapRow(result.rows[0]);
    });
  }

  async function listTasks(limit = 100, filters = {}) {
    await recoverExpiredTasks();
    return withPgClient(connectionString, async (client) => {
      const params = [];
      let idx = 1;
      const where = [];
      if (filters.kind) {
        where.push(`kind = $${idx++}`);
        params.push(filters.kind);
      }
      if (filters.status) {
        where.push(`status = $${idx++}`);
        params.push(filters.status);
      }
      if (filters.execution_target) {
        where.push(`execution_target = $${idx++}`);
        params.push(filters.execution_target);
      }
      if (filters.source_id) {
        where.push(`source_id = $${idx++}`);
        params.push(filters.source_id);
      }
      if (filters.dedupe_key) {
        where.push(`dedupe_key = $${idx++}`);
        params.push(filters.dedupe_key);
      }
      params.push(Math.max(Number(limit || 100), 1));
      const sql = `select * from worker_tasks ${where.length ? `where ${where.join(' and ')}` : ''} order by submitted_at desc limit $${idx}`;
      const result = await client.query(sql, params);
      return result.rows.map(mapRow);
    });
  }

  async function listTaskEvents(taskId, limit = 100) {
    const task = await getTask(taskId);
    if (!task) return null;
    return [...(task.logs || [])].slice(-Math.max(Number(limit || 100), 1));
  }

  return {
    mode: 'postgres',
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

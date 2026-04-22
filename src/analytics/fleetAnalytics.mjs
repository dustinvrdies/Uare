import { withPgClient } from '../db/pg.mjs';

function nowIso() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function mean(values = []) { return values.length ? Number((values.reduce((a,b)=>a+Number(b||0),0)/values.length).toFixed(2)) : 0; }
function pct(n, d) { return d ? Number(((Number(n||0)/Number(d))*100).toFixed(2)) : 0; }
function isoBucket(date = new Date()) {
  const d = new Date(date);
  d.setUTCMinutes(0,0,0);
  return d.toISOString();
}

export function deriveAnalyticsRecord(topic = '', payload = {}) {
  const task = payload?.task || payload || {};
  const workerId = payload?.worker_id || task?.worker_claim?.worker_id || null;
  const durationMs = Number(task?.metrics?.duration_ms || task?.duration_ms || task?.result?.metrics?.duration_ms || 0) || 0;
  const queueMs = Number(task?.metrics?.queue_ms || task?.queue_ms || 0) || 0;
  const retries = Number(task?.retry_count || task?.attempts || 0) || 0;
  const success = /completed$/.test(topic) || task?.status === 'completed';
  const failed = /failed$/.test(topic) || task?.status === 'failed';
  const kind = String(task?.kind || payload?.kind || payload?.job_kind || 'unknown');
  const executionTarget = String(task?.execution_target || payload?.execution_target || 'unknown');
  if (!success && !failed) return null;
  return {
    metric_id: String(payload?.metric_id || `metric-${Date.now()}-${Math.random().toString(16).slice(2,8)}`),
    topic: String(topic || 'worker.lifecycle'),
    worker_id: workerId,
    task_id: task?.task_id ? String(task.task_id) : null,
    job_kind: kind,
    project_id: task?.payload?.project_id || payload?.project_id || null,
    execution_target: executionTarget,
    duration_ms: durationMs,
    queue_ms: queueMs,
    retries,
    success,
    created_at: nowIso(),
  };
}

export function createFleetAnalyticsStore() {
  const records = [];

  return {
    mode: 'memory',
    async record(metric = {}) {
      if (!metric) return null;
      records.unshift({ ...clone(metric), created_at: metric.created_at || nowIso() });
      if (records.length > 10000) records.length = 10000;
      return clone(records[0]);
    },
    async list({ limit = 500, since = null, kind = null } = {}) {
      return records
        .filter((row) => (!since || String(row.created_at) >= String(since)) && (!kind || row.job_kind === kind))
        .slice(0, limit)
        .map(clone);
    },
    async summary({ since = null } = {}) {
      const rows = await this.list({ limit: 5000, since });
      const completed = rows.filter((row) => row.success);
      const failed = rows.filter((row) => !row.success);
      const byKind = rows.reduce((acc, row) => {
        const bucket = acc[row.job_kind] || { total: 0, success: 0, failed: 0, avg_duration_ms: 0, avg_queue_ms: 0 };
        bucket.total += 1;
        bucket.success += row.success ? 1 : 0;
        bucket.failed += row.success ? 0 : 1;
        acc[row.job_kind] = bucket;
        return acc;
      }, {});
      for (const kind of Object.keys(byKind)) {
        const scoped = rows.filter((row) => row.job_kind === kind);
        byKind[kind].avg_duration_ms = mean(scoped.map((row) => row.duration_ms));
        byKind[kind].avg_queue_ms = mean(scoped.map((row) => row.queue_ms));
        byKind[kind].failure_rate = pct(byKind[kind].failed, byKind[kind].total);
      }
      const workerEfficiency = Object.values(rows.reduce((acc, row) => {
        const key = row.worker_id || 'unassigned';
        const bucket = acc[key] || { worker_id: key, total: 0, success: 0, failed: 0, avg_duration_ms: 0 };
        bucket.total += 1;
        bucket.success += row.success ? 1 : 0;
        bucket.failed += row.success ? 0 : 1;
        acc[key] = bucket;
        return acc;
      }, {})).map((bucket) => ({
        ...bucket,
        avg_duration_ms: mean(rows.filter((row) => (row.worker_id || 'unassigned') === bucket.worker_id).map((row) => row.duration_ms)),
        success_rate: pct(bucket.success, bucket.total),
      }));

      return {
        window_start: since || null,
        generated_at: nowIso(),
        totals: {
          total: rows.length,
          success: completed.length,
          failed: failed.length,
          failure_rate: pct(failed.length, rows.length),
          retry_rate: pct(rows.filter((row) => Number(row.retries || 0) > 0).length, rows.length),
          avg_duration_ms: mean(rows.map((row) => row.duration_ms)),
          avg_queue_ms: mean(rows.map((row) => row.queue_ms)),
        },
        by_kind: byKind,
        worker_efficiency: workerEfficiency.sort((a, b) => b.success_rate - a.success_rate || a.avg_duration_ms - b.avg_duration_ms),
      };
    },
    async throughput({ hours = 24 } = {}) {
      const since = new Date(Date.now() - (Math.max(Number(hours || 24), 1) * 3600_000)).toISOString();
      const rows = await this.list({ limit: 5000, since });
      const buckets = new Map();
      for (const row of rows) {
        const key = isoBucket(row.created_at);
        const current = buckets.get(key) || { bucket_at: key, total: 0, success: 0, failed: 0 };
        current.total += 1;
        current.success += row.success ? 1 : 0;
        current.failed += row.success ? 0 : 1;
        buckets.set(key, current);
      }
      return [...buckets.values()].sort((a, b) => a.bucket_at.localeCompare(b.bucket_at));
    },
  };
}

export function createPostgresFleetAnalyticsStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;
  const table = runtime.fleetAnalyticsTable || 'fleet_metrics';
  return {
    mode: 'postgres',
    async record(metric = {}) {
      if (!metric) return null;
      const normalized = { ...metric, created_at: metric.created_at || nowIso() };
      await withPgClient(connectionString, async (client) => {
        await client.query(`
          insert into ${table} (metric_id, topic, worker_id, task_id, job_kind, project_id, execution_target, duration_ms, queue_ms, retries, success, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          on conflict (metric_id) do nothing
        `, [normalized.metric_id, normalized.topic, normalized.worker_id, normalized.task_id, normalized.job_kind, normalized.project_id, normalized.execution_target, normalized.duration_ms, normalized.queue_ms, normalized.retries, normalized.success, normalized.created_at]);
      });
      return normalized;
    },
    async list({ limit = 500, since = null, kind = null } = {}) {
      return withPgClient(connectionString, async (client) => {
        const where = [];
        const params = [];
        let idx = 1;
        if (since) { where.push(`created_at >= $${idx++}`); params.push(since); }
        if (kind) { where.push(`job_kind = $${idx++}`); params.push(kind); }
        params.push(Math.max(Number(limit || 500), 1));
        const result = await client.query(`select * from ${table} ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at desc limit $${idx}`, params);
        return result.rows;
      });
    },
    async summary({ since = null } = {}) {
      const rows = await this.list({ limit: 5000, since });
      return createFleetAnalyticsStore().summary.call({ list: async () => rows }, { since });
    },
    async throughput({ hours = 24 } = {}) {
      const since = new Date(Date.now() - (Math.max(Number(hours || 24), 1) * 3600_000)).toISOString();
      const rows = await this.list({ limit: 5000, since });
      return createFleetAnalyticsStore().throughput.call({ list: async () => rows }, { hours });
    },
  };
}

export function createFleetAnalyticsStoreForRuntime(runtime = {}) {
  return runtime.mode === 'postgres' ? createPostgresFleetAnalyticsStore(runtime) : createFleetAnalyticsStore();
}

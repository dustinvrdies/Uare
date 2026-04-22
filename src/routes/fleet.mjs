import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildFleetRoutes(runtime, taskStore, jobStore, eventBus = null, telemetry = null, autonomousWorker = null) {
  const router = Router();

  router.get('/overview', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const [tasks, solverJobs, cadJobs, patentJobs, events, replayStats] = await Promise.all([
        taskStore.listTasks(250, {}),
        jobStore.list('solver', 150, {}),
        jobStore.list('cad', 150, {}),
        jobStore.list('patent', 150, {}),
        eventBus?.replay?.({ include_archive: req.query.include_archive === 'true' }, Number(req.query.event_limit || 50)) || [],
        eventBus?.replayStats?.() || null,
      ]);
      const counts = tasks.reduce((acc, task) => {
        acc.total += 1;
        acc.by_status[task.status] = (acc.by_status[task.status] || 0) + 1;
        acc.by_kind[task.kind] = (acc.by_kind[task.kind] || 0) + 1;
        return acc;
      }, { total: 0, by_status: {}, by_kind: {} });
      return res.json({
        ok: true,
        snapshot_at: new Date().toISOString(),
        worker_status: autonomousWorker?.status?.() || { enabled: false, running: false },
        event_bus: { mode: eventBus?.mode || 'memory', instance_id: eventBus?.instanceId || null },
        telemetry: telemetry?.snapshot?.() || null,
        replay_stats: replayStats,
        task_counts: counts,
        active_tasks: tasks.filter((task) => !['completed', 'failed'].includes(task.status)).slice(0, 50),
        recent_tasks: tasks.slice(0, 50),
        recent_events: events,
        jobs: {
          solver: solverJobs.slice(0, 50),
          cad: cadJobs.slice(0, 50),
          patent: patentJobs.slice(0, 50),
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/stream', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      let closed = false;
      const send = async (eventName = 'update', payload = {}) => {
        if (closed) return;
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const initialEvents = await (eventBus?.replay?.({}, Number(req.query.replay_limit || 25)) || []);
      await send('connected', {
        snapshot_at: new Date().toISOString(),
        event_bus: { mode: eventBus?.mode || 'memory', instance_id: eventBus?.instanceId || null },
        telemetry: telemetry?.snapshot?.() || null,
        replay: initialEvents,
      });
      const unsubscribeAll = eventBus?.subscribeAll?.(({ topic, payload }) => send('event', { topic, payload, at: new Date().toISOString() }));
      const heartbeat = setInterval(() => {
        send('keepalive', { at: new Date().toISOString(), telemetry: telemetry?.snapshot?.() || null }).catch(() => {});
      }, 15000);
      req.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribeAll?.();
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

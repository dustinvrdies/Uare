import { Router } from 'express';
import os from 'os';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildWorkerRoutes(runtime, taskStore, handlers = {}, autonomousWorker = null, eventBus = null, telemetry = null) {
  const router = Router();

  router.get('/status', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      return res.json({
        ok: true,
        worker_store_mode: taskStore.mode || 'memory',
        autonomous_worker: autonomousWorker ? autonomousWorker.status() : { enabled: false, running: false },
        telemetry: telemetry?.snapshot?.() || null,
        event_bus: { mode: eventBus?.mode || 'memory', instance_id: eventBus?.instanceId || null },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });


  router.get('/events', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const events = await (eventBus?.replay?.({
        topic: req.query.topic || null,
        topic_prefix: req.query.topic_prefix || null,
        task_id: req.query.task_id || null,
        kind: req.query.kind || null,
        include_archive: req.query.include_archive === 'true',
        archived_only: req.query.archived_only === 'true',
      }, Number(req.query.limit || 100)) || []);
      return res.json({ ok: true, events });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });


  router.get('/events/stats', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const stats = await (eventBus?.replayStats?.() || null);
      return res.json({ ok: true, stats });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/events/archive', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const result = await (eventBus?.archiveReplay?.({
        topic: req.body?.topic || null,
        topic_prefix: req.body?.topic_prefix || null,
        task_id: req.body?.task_id || null,
        kind: req.body?.kind || null,
        before: req.body?.before || null,
        limit: req.body?.limit || null,
      }) || { archived_count: 0, replay_ids: [] });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/tasks', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const tasks = await taskStore.listTasks(100, {
        kind: req.query.kind || null,
        status: req.query.status || null,
        execution_target: req.query.execution_target || null,
        source_id: req.query.source_id || null,
      });
      return res.json({ ok: true, tasks });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/tasks/:taskId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.getTask(req.params.taskId);
      if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
      return res.json({ ok: true, task });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/tasks/:taskId/events', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const events = await taskStore.listTaskEvents(req.params.taskId, Number(req.query.limit || 100));
      if (!events) return res.status(404).json({ ok: false, error: 'Task not found' });
      return res.json({ ok: true, events });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/tasks/:taskId/stream', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.getTask(req.params.taskId);
      if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
      const accept = String(req.headers.accept || '').toLowerCase();
      const keepOpen = accept.includes('text/event-stream') && req.query?.once !== 'true';
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', keepOpen ? 'keep-alive' : 'close');
      let closed = false;
      const sendSnapshot = async (eventName = 'snapshot', payload = null) => {
        if (closed) return;
        const snapshot = payload?.task || await taskStore.getTask(req.params.taskId);
        const events = await taskStore.listTaskEvents(req.params.taskId, 20);
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify({ task: snapshot, events, telemetry: telemetry?.snapshot?.() || null })}\n\n`);
        if (!snapshot || ['completed', 'failed'].includes(snapshot.status)) {
          closed = true;
          unsubscribe?.();
          res.end();
        }
      };
      await sendSnapshot('connected');
      const unsubscribe = eventBus?.subscribeTask?.(req.params.taskId, async (payload) => {
        await sendSnapshot(payload?.event || 'task_update', payload);
      });
      const heartbeat = setInterval(async () => {
        if (closed) return;
        await sendSnapshot('keepalive');
      }, 15000);
      req.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/claim-next', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.claimNext({
        kind: req.body?.kind || null,
        execution_targets: Array.isArray(req.body?.execution_targets) ? req.body.execution_targets : [],
        worker: {
          worker_id: req.body?.worker?.worker_id || actor.id,
          worker_type: req.body?.worker?.worker_type || 'manual-claim',
          host: req.body?.worker?.host || os.hostname(),
          platform: req.body?.worker?.platform || process.platform,
        },
      });
      if (!task) return res.status(404).json({ ok: false, error: 'No pending task available' });
      return res.json({ ok: true, task });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/tasks/:taskId/heartbeat', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.heartbeatTask(req.params.taskId, {
        worker_id: req.body?.worker?.worker_id || actor.id,
        worker_type: req.body?.worker?.worker_type || 'manual-claim',
        host: req.body?.worker?.host || os.hostname(),
        platform: req.body?.worker?.platform || process.platform,
      }, req.body?.progress || null);
      if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
      return res.json({ ok: true, task });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/tasks/:taskId/progress', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.updateProgress(req.params.taskId, req.body?.progress || {}, { emitLog: true });
      if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
      return res.json({ ok: true, task });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/tasks/:taskId/fail', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.failTask(req.params.taskId, req.body?.error || 'Task failed', { retryable: req.body?.retryable === true });
      if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
      return res.json({ ok: true, task });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/tasks/:taskId/complete', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const task = await taskStore.getTask(req.params.taskId);
      if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
      const handler = task.kind === 'solver' ? handlers.completeSolverTask : task.kind === 'cad' ? handlers.completeCadTask : null;
      if (typeof handler !== 'function') return res.status(400).json({ ok: false, error: `No completion handler registered for task kind ${task.kind}` });
      await taskStore.updateProgress(task.task_id, { percent: 90, stage: 'finalizing', detail: 'Finalizing task result' });
      const outcome = await handler(task, actor, req.body || {});
      await taskStore.completeTask(task.task_id, outcome);
      return res.json({ ok: true, task: await taskStore.getTask(task.task_id), outcome });
    } catch (error) {
      await taskStore.failTask(req.params.taskId, error, { retryable: req.body?.retryable === true });
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

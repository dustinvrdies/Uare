import crypto from 'crypto';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseTransportPayload(raw, logger = console) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      logger.warn?.('event_bus.transport_payload_parse_failed', { error: error.message });
      return null;
    }
  }
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch (error) {
      logger.warn?.('event_bus.transport_payload_parse_failed', { error: error.message });
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

export function createMemoryEventTransportHub() {
  const listeners = new Set();
  return {
    createTransport() {
      return {
        publish(message = {}) {
          for (const listener of listeners) listener(clone(message));
        },
        subscribe(handler) {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
        async close() {},
      };
    },
  };
}

async function createPostgresEventTransport(runtime = {}, logger = console) {
  const { Client } = await import('pg');
  const connectionString = runtime.databaseUrl;
  if (!connectionString) throw new Error('DATABASE_URL is required for postgres event transport');
  const channel = runtime.eventBusPgChannel || 'uare_events';
  const client = new Client({ connectionString });
  const listeners = new Set();
  await client.connect();
  await client.query(`listen ${channel}`);
  client.on('notification', (message) => {
    if (message.channel !== channel) return;
    const payload = parseTransportPayload(message.payload, logger);
    if (!payload) return;
    for (const listener of listeners) listener(clone(payload));
  });
  return {
    async publish(message = {}) {
      await client.query('select pg_notify($1, $2)', [channel, JSON.stringify(message)]);
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    async close() {
      listeners.clear();
      try {
        await client.query(`unlisten ${channel}`);
      } catch {}
      await client.end();
    },
  };
}

async function createRedisEventTransport(runtime = {}, logger = console) {
  const { createClient } = await import('redis');
  const url = runtime.eventBusRedisUrl;
  if (!url) throw new Error('EVENT_BUS_REDIS_URL is required for redis event transport');
  const channel = runtime.eventBusRedisChannel || 'uare_events';
  const publisher = createClient({ url });
  const subscriber = publisher.duplicate();
  const listeners = new Set();
  await publisher.connect();
  await subscriber.connect();
  await subscriber.subscribe(channel, (message) => {
    const payload = parseTransportPayload(message, logger);
    if (!payload) return;
    for (const listener of listeners) listener(clone(payload));
  });
  return {
    async publish(message = {}) {
      await publisher.publish(channel, JSON.stringify(message));
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    async close() {
      listeners.clear();
      try {
        await subscriber.unsubscribe(channel);
      } catch {}
      try {
        await subscriber.quit();
      } catch {
        try { await subscriber.disconnect(); } catch {}
      }
      try {
        await publisher.quit();
      } catch {
        try { await publisher.disconnect(); } catch {}
      }
    },
  };
}

async function createNatsEventTransport(runtime = {}, logger = console) {
  const { connect, StringCodec } = await import('nats');
  const servers = runtime.eventBusNatsServers || runtime.natsServers || '';
  if (!servers) throw new Error('EVENT_BUS_NATS_SERVERS is required for nats event transport');
  const subject = runtime.eventBusNatsSubject || 'uare.events';
  const codec = StringCodec();
  const connection = await connect({ servers });
  const listeners = new Set();
  const subscription = connection.subscribe(subject);
  const loop = (async () => {
    try {
      for await (const message of subscription) {
        const payload = parseTransportPayload(codec.decode(message.data), logger);
        if (!payload) continue;
        for (const listener of listeners) listener(clone(payload));
      }
    } catch (error) {
      logger.warn?.('event_bus.nats_subscription_failed', { error: error.message });
    }
  })();
  return {
    publish(message = {}) {
      connection.publish(subject, codec.encode(JSON.stringify(message)));
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    async close() {
      listeners.clear();
      try { subscription.unsubscribe(); } catch {}
      try { await connection.drain(); } catch {
        try { await connection.close(); } catch {}
      }
      await loop.catch(() => {});
    },
  };
}

export function createTransportFactory(mode = 'memory', runtime = {}, logger = console) {
  const selected = String(mode || 'memory').toLowerCase();
  if (!selected || selected === 'memory') return null;
  if (selected === 'postgres') return () => createPostgresEventTransport(runtime, logger);
  if (selected === 'redis') return () => createRedisEventTransport(runtime, logger);
  if (selected === 'nats') return () => createNatsEventTransport(runtime, logger);
  throw new Error(`Unsupported event transport mode: ${selected}`);
}

export function createEventBus(runtime = {}, logger = console, options = {}) {
  const replayStore = options.replayStore || null;
  const mode = runtime.eventBusMode || 'memory';
  const instanceId = runtime.eventBusInstanceId || `bus-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const taskListeners = new Map();
  const globalListeners = new Set();
  let transport = null;
  let unsubscribeTransport = null;

  function emit(topic, payload) {
    const enriched = clone(payload);
    const taskId = enriched?.task?.task_id || enriched?.task_id || null;
    if (taskId && taskListeners.has(taskId)) {
      for (const cb of taskListeners.get(taskId)) cb(clone(enriched));
    }
    for (const cb of globalListeners) cb({ topic, payload: clone(enriched) });
  }

  async function persist(topic, payload) {
    await replayStore?.append?.({ topic, payload, origin_id: instanceId, published_at: nowIso() });
  }

  async function ingest(message = {}, fromRemote = false) {
    const topic = String(message.topic || 'unknown');
    const payload = clone(message.payload || {});
    if (fromRemote && message.origin_id === instanceId) return;
    emit(topic, payload);
    await persist(topic, payload);
  }

  async function start() {
    if (mode === 'memory') return;
    const transportFactory = options.transportFactory || createTransportFactory(mode, runtime, logger);
    if (!transportFactory) return;
    transport = await transportFactory();
    unsubscribeTransport = transport.subscribe((message) => {
      ingest(message, true).catch((error) => logger.error?.('event_bus.ingest_failed', { error: error.message }));
    });
  }

  async function stop() {
    unsubscribeTransport?.();
    unsubscribeTransport = null;
    if (transport?.close) await transport.close();
    transport = null;
  }

  function subscribeTask(taskId, callback) {
    const key = String(taskId);
    if (!taskListeners.has(key)) taskListeners.set(key, new Set());
    taskListeners.get(key).add(callback);
    return () => taskListeners.get(key)?.delete(callback);
  }

  function subscribeAll(callback) {
    globalListeners.add(callback);
    return () => globalListeners.delete(callback);
  }

  function publish(topic, payload = {}) {
    const message = { topic, payload: clone(payload), origin_id: instanceId, published_at: nowIso() };
    emit(topic, payload);
    persist(topic, payload).catch(() => {});
    transport?.publish?.(message);
  }

  function publishTask(taskId, payload = {}) {
    publish(`task:${taskId}`, payload);
  }

  function publishMetric(payload = {}) {
    publish('metrics', payload);
  }

  async function replay(filters = {}, limit = 100) {
    return replayStore?.list?.(filters, limit) || [];
  }

  async function archiveReplay(filters = {}) {
    return replayStore?.archive?.(filters) || { archived_count: 0, replay_ids: [] };
  }

  async function replayStats() {
    return replayStore?.stats?.() || null;
  }

  return {
    mode,
    instanceId,
    start,
    stop,
    publish,
    publishTask,
    publishMetric,
    subscribeTask,
    subscribeAll,
    replay,
    archiveReplay,
    replayStats,
  };
}

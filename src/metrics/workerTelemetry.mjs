function nowIso() {
  return new Date().toISOString();
}

function keyFor(labels = {}) {
  return JSON.stringify(Object.keys(labels).sort().reduce((acc, key) => {
    acc[key] = labels[key];
    return acc;
  }, {}));
}

export function createWorkerTelemetry(runtime = {}, logger = console, eventBus = null) {
  const counters = new Map();
  const gauges = new Map();
  let lastShipment = null;

  function inc(name, value = 1, labels = {}) {
    const key = `${name}:${keyFor(labels)}`;
    const current = counters.get(key) || { name, labels, value: 0 };
    current.value += Number(value || 0);
    counters.set(key, current);
    eventBus?.publishMetric({ type: 'counter', name, labels, value: current.value, at: nowIso() });
    return current;
  }

  function setGauge(name, value, labels = {}) {
    const key = `${name}:${keyFor(labels)}`;
    const current = { name, labels, value: Number(value || 0), at: nowIso() };
    gauges.set(key, current);
    eventBus?.publishMetric({ type: 'gauge', ...current });
    return current;
  }

  function snapshot() {
    return {
      counters: [...counters.values()],
      gauges: [...gauges.values()],
      shipped_at: lastShipment,
    };
  }

  async function ship() {
    if (!runtime.metricsShipUrl) return { ok: false, skipped: true, reason: 'METRICS_SHIP_URL not configured' };
    try {
      const response = await fetch(runtime.metricsShipUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(runtime.metricsShipToken ? { authorization: `Bearer ${runtime.metricsShipToken}` } : {}),
        },
        body: JSON.stringify({
          service: 'uare-custom-backend',
          at: nowIso(),
          host: runtime.autonomousWorkerId || process.pid,
          metrics: snapshot(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Metrics ship failed with ${response.status}`);
      }
      lastShipment = nowIso();
      logger.info?.('metrics.shipped', { shipped_at: lastShipment, destination: runtime.metricsShipUrl });
      return { ok: true, shipped_at: lastShipment };
    } catch (error) {
      logger.warn?.('metrics.ship_failed', { error: error.message, destination: runtime.metricsShipUrl });
      return { ok: false, error: error.message };
    }
  }

  return { inc, setGauge, snapshot, ship };
}

const state = {
  startedAt: Date.now(),
  requestsTotal: 0,
  requestsByRoute: new Map(),
  statusBuckets: new Map(),
  durationMsTotal: 0,
  inFlight: 0,
  errorsTotal: 0,
  lastError: null,
};

function bucketKey(req, statusCode) {
  const path = req.route?.path || req.path || req.originalUrl || 'unknown';
  const method = req.method || 'GET';
  const family = `${Math.floor(Number(statusCode || 0) / 100)}xx`;
  return `${method} ${path} ${family}`;
}

export function observeRequest(req, res, durationMs) {
  state.requestsTotal += 1;
  state.durationMsTotal += Number(durationMs || 0);
  const key = bucketKey(req, res.statusCode);
  state.requestsByRoute.set(key, (state.requestsByRoute.get(key) || 0) + 1);
  const status = String(res.statusCode || 0);
  state.statusBuckets.set(status, (state.statusBuckets.get(status) || 0) + 1);
  if (res.statusCode >= 500) {
    state.errorsTotal += 1;
    state.lastError = { ts: new Date().toISOString(), requestId: req.requestId || null, path: req.originalUrl || req.url, statusCode: res.statusCode };
  }
}

export function markInFlight(delta) {
  state.inFlight = Math.max(0, state.inFlight + delta);
}

export function snapshotMetrics() {
  const uptimeSeconds = Math.round((Date.now() - state.startedAt) / 1000);
  return {
    ok: true,
    uptimeSeconds,
    requestsTotal: state.requestsTotal,
    inFlight: state.inFlight,
    errorsTotal: state.errorsTotal,
    averageDurationMs: state.requestsTotal ? Math.round(state.durationMsTotal / state.requestsTotal) : 0,
    statusBuckets: Object.fromEntries(state.statusBuckets.entries()),
    requestsByRoute: Object.fromEntries(state.requestsByRoute.entries()),
    lastError: state.lastError,
  };
}

export function prometheusMetrics() {
  const s = snapshotMetrics();
  const lines = [
    '# HELP uare_uptime_seconds Process uptime in seconds',
    '# TYPE uare_uptime_seconds gauge',
    `uare_uptime_seconds ${s.uptimeSeconds}`,
    '# HELP uare_http_requests_total Total HTTP requests',
    '# TYPE uare_http_requests_total counter',
    `uare_http_requests_total ${s.requestsTotal}`,
    '# HELP uare_http_in_flight Current in-flight HTTP requests',
    '# TYPE uare_http_in_flight gauge',
    `uare_http_in_flight ${s.inFlight}`,
    '# HELP uare_http_5xx_total Total HTTP 5xx responses',
    '# TYPE uare_http_5xx_total counter',
    `uare_http_5xx_total ${s.errorsTotal}`,
    '# HELP uare_http_average_duration_ms Average request duration in milliseconds',
    '# TYPE uare_http_average_duration_ms gauge',
    `uare_http_average_duration_ms ${s.averageDurationMs}`,
  ];
  for (const [status, count] of Object.entries(s.statusBuckets)) {
    lines.push(`uare_http_status_total{status="${status}"} ${count}`);
  }
  return `${lines.join('\n')}\n`;
}

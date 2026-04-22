import { markInFlight, observeRequest } from '../ops/metricsRegistry.mjs';

export function requestMetrics(req, res, next) {
  const startedAt = Date.now();
  let done = false;
  markInFlight(1);
  function finish() {
    if (done) return;
    done = true;
    markInFlight(-1);
    observeRequest(req, res, Date.now() - startedAt);
  }
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

import crypto from 'node:crypto';

export function requestLogging(req, res, next) {
  const startedAt = Date.now();
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = req.requestId || requestId;
  res.setHeader('x-request-id', req.requestId);

  res.on('finish', () => {
    const runtime = req.app?.locals?.runtime || {};
    if (runtime.enableRequestLogs === false) return;
    const entry = {
      level: res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info'),
      ts: new Date().toISOString(),
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    };
    console.log(JSON.stringify(entry));
  });
  next();
}

export function attachRequestContext(logger, runtime = {}) {
  return function requestContext(req, res, next) {
    const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startedAt = Date.now();
    res.on('finish', () => {
      if (runtime.enableRequestLogs) {
        logger.info('request.completed', {
          request_id: requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: Date.now() - startedAt
        });
      }
    });

    next();
  };
}

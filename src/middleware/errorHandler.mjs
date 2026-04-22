export function errorHandler(logger, runtime = {}) {
  return function onError(error, req, res, next) {
    if (res.headersSent) return next(error);

    const statusCode = error?.statusCode || error?.status || 500;
    const expose = runtime.exposeErrors || statusCode < 500;
    const message = expose ? (error?.message || 'Internal server error') : 'Internal server error';

    logger.error('request.failed', {
      request_id: req.requestId,
      path: req.path,
      method: req.method,
      status_code: statusCode,
      error: error?.message || 'Unknown error',
      stack: runtime.nodeEnv === 'production' ? undefined : error?.stack,
    });

    res.status(statusCode).json({
      ok: false,
      error: message,
      details: expose ? (error?.details || null) : null,
      request_id: req.requestId || null,
    });
  };
}

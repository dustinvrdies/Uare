export function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: 'Not found',
    request_id: req.requestId || null,
    path: req.originalUrl || req.url,
  });
}

export function securityHeaders(req, res, next) {
  const runtime = req.app?.locals?.runtime || {};
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin-allow-popups');
  res.setHeader('cross-origin-resource-policy', 'cross-origin');
  res.setHeader('cross-origin-embedder-policy', 'unsafe-none');
  res.setHeader('origin-agent-cluster', '?1');
  if (runtime.contentSecurityPolicy) {
    res.setHeader('content-security-policy', runtime.contentSecurityPolicy);
  }
  if (runtime.nodeEnv === 'production') {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
}

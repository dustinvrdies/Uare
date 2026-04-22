function badRequest(message, details = null, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

export function ensureJsonBody(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType || contentType.includes('application/json') || contentType.includes('application/x-www-form-urlencoded')) return next();
  return next(badRequest('Unsupported content type', { allowed: ['application/json', 'application/x-www-form-urlencoded'] }, 415));
}

export function enforceTrustedOrigin(req, _res, next) {
  const runtime = req.app?.locals?.runtime || {};
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!runtime.isProduction && !runtime.trustedOrigins?.length) return next();
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return next();
  const trusted = new Set([...(runtime.trustedOrigins || []), runtime.appBaseUrl].filter(Boolean));
  if (!trusted.size) return next();
  const normalized = (() => {
    try { return new URL(origin).origin; } catch { return String(origin || '').replace(/\/$/, ''); }
  })();
  if (!trusted.has(normalized)) return next(badRequest('Untrusted request origin', { origin: normalized }, 403));
  return next();
}

export function validateBody(schema = {}) {
  return function validator(req, _res, next) {
    try {
      const source = req.body || {};
      const output = {};
      const errors = [];
      for (const [field, rule] of Object.entries(schema)) {
        const value = source[field];
        const exists = value !== undefined && value !== null && value !== '';
        if (rule.required && !exists) {
          errors.push({ field, message: `${field} is required` });
          continue;
        }
        if (!exists) {
          if (Object.prototype.hasOwnProperty.call(rule, 'default')) output[field] = typeof rule.default === 'function' ? rule.default() : rule.default;
          continue;
        }
        let nextValue = value;
        if (rule.type === 'string') {
          nextValue = String(value);
          if (rule.trim !== false) nextValue = nextValue.trim();
          if (rule.maxLength && nextValue.length > rule.maxLength) errors.push({ field, message: `${field} exceeds maximum length` });
          if (rule.minLength && nextValue.length < rule.minLength) errors.push({ field, message: `${field} is too short` });
          if (rule.pattern && !rule.pattern.test(nextValue)) errors.push({ field, message: `${field} is invalid` });
          if (rule.transform) nextValue = rule.transform(nextValue, req);
        } else if (rule.type === 'number') {
          nextValue = Number(value);
          if (!Number.isFinite(nextValue)) errors.push({ field, message: `${field} must be a number` });
        } else if (rule.type === 'boolean') {
          nextValue = value === true || value === 'true' || value === 1 || value === '1';
        } else if (rule.type === 'array') {
          if (!Array.isArray(nextValue)) errors.push({ field, message: `${field} must be an array` });
        } else if (rule.type === 'object') {
          if (typeof nextValue !== 'object' || Array.isArray(nextValue)) errors.push({ field, message: `${field} must be an object` });
        }
        if (rule.enum && !rule.enum.includes(nextValue)) errors.push({ field, message: `${field} must be one of ${rule.enum.join(', ')}` });
        output[field] = nextValue;
      }
      if (errors.length) return next(badRequest('Validation failed', errors));
      req.validatedBody = output;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

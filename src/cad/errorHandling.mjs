/**
 * Error Handling and Validation Hardening
 * Production-grade error handling, recovery, and input validation
 */

// ─── Error Classification ────────────────────────────────────────
export class CadPlannerError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = {}) {
    super(message);
    this.name = 'CadPlannerError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.statusCode = 500;
  }
}

export class ValidationError extends CadPlannerError {
  constructor(message, field = null, details = {}) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    this.field = field;
    this.statusCode = 400;
  }
}

export class NotFoundError extends CadPlannerError {
  constructor(resource, id) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ConflictError extends CadPlannerError {
  constructor(message, details = {}) {
    super(message, 'CONFLICT', details);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

export class RateLimitError extends CadPlannerError {
  constructor(retryAfter = 60) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.retryAfter = retryAfter;
  }
}

// ─── Input Validation Utilities ──────────────────────────────────
export function validatePart(part = {}) {
  const errors = [];
  
  if (!part.id) errors.push({ field: 'id', message: 'Part ID is required' });
  if (!part.type) errors.push({ field: 'type', message: 'Part type is required' });
  if (!part.material) errors.push({ field: 'material', message: 'Material is required' });
  if (!part.process) errors.push({ field: 'process', message: 'Manufacturing process is required' });
  
  const dims = part.dims || {};
  if (Number(dims.x || 0) <= 0) errors.push({ field: 'dims.x', message: 'Length must be > 0' });
  if (Number(dims.y || 0) <= 0) errors.push({ field: 'dims.y', message: 'Width must be > 0' });
  if (Number(dims.z || 0) <= 0) errors.push({ field: 'dims.z', message: 'Height must be > 0' });
  
  // Check for suspicious values (potential injection attacks)
  if (typeof part.id === 'string' && /[<>"`$(){}\[\]]/.test(part.id)) {
    errors.push({ field: 'id', message: 'Part ID contains invalid characters' });
  }
  
  return { valid: errors.length === 0, errors };
}

export function validateAssembly(assembly = {}) {
  const errors = [];
  
  if (!assembly.id) errors.push({ field: 'id', message: 'Assembly ID is required' });
  if (!Array.isArray(assembly.parts) || assembly.parts.length === 0) {
    errors.push({ field: 'parts', message: 'Assembly must contain at least one part' });
  }
  
  // Validate each part
  if (Array.isArray(assembly.parts)) {
    for (let i = 0; i < assembly.parts.length; i++) {
      const partValidation = validatePart(assembly.parts[i]);
      if (!partValidation.valid) {
        errors.push({
          field: `parts[${i}]`,
          message: `Part ${i} has validation errors`,
          details: partValidation.errors,
        });
      }
    }
  }
  
  // Validate interfaces
  if (Array.isArray(assembly.interfaces)) {
    const partIds = new Set((assembly.parts || []).map((p) => p.id));
    for (let i = 0; i < assembly.interfaces.length; i++) {
      const intf = assembly.interfaces[i];
      if (!partIds.has(intf.part_a) || !partIds.has(intf.part_b)) {
        errors.push({
          field: `interfaces[${i}]`,
          message: `Interface references non-existent parts`,
        });
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

export function sanitizeInput(input) {
  if (typeof input === 'string') {
    return input.substring(0, 10000).replace(/[<>`$]/g, ''); // Basic XSS prevention
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : 0;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 1000).map(sanitizeInput);
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      if (key.length <= 256) {
        sanitized[key] = sanitizeInput(value);
      }
    }
    return sanitized;
  }
  return input;
}

// ─── Error Recovery and Retry Logic ──────────────────────────────
export function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const delayMs = options.delayMs || 100;
  const backoffMultiplier = options.backoffMultiplier || 2;
  const retryableErrors = options.retryableErrors || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];
  
  return async function tryExecute() {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isRetryable = retryableErrors.some((code) => error.code?.includes(code) || error.message?.includes(code));
        if (!isRetryable || attempt === maxRetries - 1) {
          throw error;
        }
        const delay = delayMs * Math.pow(backoffMultiplier, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  };
}

// ─── Circuit Breaker Pattern ────────────────────────────────────
export class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextRetryTime = null;
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextRetryTime) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount += 1;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextRetryTime = Date.now() + this.timeout;
    }
  }
}

// ─── Rate Limiter ───────────────────────────────────────────────
export class RateLimiter {
  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map(); // key -> [timestamps]
  }
  
  isAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    let timestamps = this.requests.get(key);
    timestamps = timestamps.filter((t) => t > windowStart);
    this.requests.set(key, timestamps);
    
    if (timestamps.length < this.maxRequests) {
      timestamps.push(now);
      return { allowed: true };
    }
    
    return {
      allowed: false,
      retryAfter: Math.ceil((Math.max(...timestamps) + this.windowMs - now) / 1000),
    };
  }
}

// ─── Comprehensive Health Check ──────────────────────────────────
export function performHealthCheck(services = {}) {
  const checks = {
    memory: {
      status: 'ok',
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    uptime_seconds: Math.round(process.uptime()),
  };
  
  if (services.database) {
    try {
      checks.database = {
        status: services.database.isConnected ? 'ok' : 'warning',
        connection_pool_size: services.database.poolSize || 0,
      };
    } catch {
      checks.database = { status: 'error' };
    }
  }
  
  if (services.cache) {
    try {
      checks.cache = {
        status: services.cache.isHealthy ? 'ok' : 'warning',
        items_cached: services.cache.size || 0,
      };
    } catch {
      checks.cache = { status: 'error' };
    }
  }
  
  const overallStatus = Object.values(checks).every((c) => c.status === 'ok' || !c.status) ? 'healthy' : 'degraded';
  
  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  };
}

export default {
  CadPlannerError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  validatePart,
  validateAssembly,
  sanitizeInput,
  withRetry,
  CircuitBreaker,
  RateLimiter,
  performHealthCheck,
};

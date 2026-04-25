/**
 * Security Hardening Module
 * Authentication, authorization, encryption, audit logging
 */

import crypto from 'crypto';

// ─── Request Signing & Verification ─────────────────────────────
export function signRequest(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

export function verifyRequestSignature(payload, signature, secret) {
  const expected = signRequest(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ─── Encryption Utilities ───────────────────────────────────────
export function encryptSensitiveData(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { iv: iv.toString('hex'), data: encrypted };
}

export function decryptSensitiveData(encrypted, key) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), Buffer.from(encrypted.iv, 'hex'));
  let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ─── JWT-like Token Generation ──────────────────────────────────
export function generateToken(payload, secret, expiresInSeconds = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  const [header, body, signature] = token.split('.');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Invalid token signature');
  }
  
  const claims = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && now > claims.exp) {
    throw new Error('Token expired');
  }
  
  return claims;
}

// ─── RBAC (Role-Based Access Control) ────────────────────────────
export function checkPermission(actor, resource, action, roles = {}) {
  if (!actor || !actor.id) return false;
  if (!actor.roles) return false;
  
  const rolePermissions = {
    admin: ['create', 'read', 'update', 'delete'],
    engineer: ['create', 'read', 'update'],
    reviewer: ['read', 'comment'],
    viewer: ['read'],
  };
  
  // Check if any of the actor's roles have the required permission
  for (const role of actor.roles) {
    const permissions = rolePermissions[role] || [];
    if (permissions.includes(action)) {
      return true;
    }
  }
  
  return false;
}

// ─── Audit Logging ──────────────────────────────────────────────
export function createAuditLog(actor, action, resource, result, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    actor_id: actor?.id || 'unknown',
    actor_type: actor?.type || 'api_client',
    action: action,
    resource: resource,
    resource_id: resource?.id || details.resource_id,
    result: result, // 'success', 'failure', 'denied'
    severity: result === 'denied' ? 'warning' : result === 'failure' ? 'error' : 'info',
    details: sanitizeForLogging(details),
    user_agent: details.user_agent,
    ip_address: details.ip_address,
    request_id: details.request_id,
  };
}

function sanitizeForLogging(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const sanitized = {};
  const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'private_key'];
  
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// ─── Content Security Headers ───────────────────────────────────
export function getSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
}

// ─── Input Sanitization ─────────────────────────────────────────
export function sanitizeFilename(filename) {
  return filename
    .replace(/\0/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '.')
    .substring(0, 255);
}

export function validateUrl(url) {
  try {
    const parsed = new URL(url);
    const allowedProtocols = ['https:', 'http:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function escapeSqlLike(str) {
  return str.replace(/['"\\/]/g, '\\$&');
}

// ─── Dependency Validation ──────────────────────────────────────
export function validateDependencies(assembly = {}) {
  const dependencies = [];
  const parts = Array.isArray(assembly.parts) ? assembly.parts : [];
  const interfaces = Array.isArray(assembly.interfaces) ? assembly.interfaces : [];
  
  for (const intf of interfaces) {
    const partAExists = parts.some((p) => p.id === intf.part_a);
    const partBExists = parts.some((p) => p.id === intf.part_b);
    
    if (!partAExists || !partBExists) {
      throw new Error(`Invalid interface: part ${!partAExists ? intf.part_a : intf.part_b} not found`);
    }
    
    // Detect circular dependencies
    if (intf.part_a === intf.part_b) {
      throw new Error(`Circular dependency: part cannot reference itself`);
    }
  }
  
  return { valid: true, part_count: parts.length, interface_count: interfaces.length };
}

// ─── API Key Management ─────────────────────────────────────────
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function validateApiKey(providedKey, storedHash) {
  const hash = hashApiKey(providedKey);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

export function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Compliance & Audit Trail ───────────────────────────────────
export function generateAuditTrail(events = []) {
  const trail = {
    generated_at: new Date().toISOString(),
    event_count: events.length,
    events: events.slice(-1000).map((e) => ({
      timestamp: e.timestamp,
      actor_id: e.actor_id,
      action: e.action,
      resource: e.resource,
      result: e.result,
      severity: e.severity,
    })),
    summary: {
      success_count: events.filter((e) => e.result === 'success').length,
      failure_count: events.filter((e) => e.result === 'failure').length,
      denied_count: events.filter((e) => e.result === 'denied').length,
      warnings: events.filter((e) => e.severity === 'warning').length,
      critical: events.filter((e) => e.severity === 'critical').length,
    },
  };
  
  return trail;
}

export default {
  signRequest,
  verifyRequestSignature,
  encryptSensitiveData,
  decryptSensitiveData,
  generateToken,
  verifyToken,
  checkPermission,
  createAuditLog,
  getSecurityHeaders,
  sanitizeFilename,
  validateUrl,
  escapeSqlLike,
  validateDependencies,
  hashApiKey,
  validateApiKey,
  generateApiKey,
  generateAuditTrail,
};

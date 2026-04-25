/**
 * Comprehensive Test Suite for Security Hardening Module
 */

import {
  signRequest,
  verifyRequestSignature,
  generateToken,
  verifyToken,
  checkPermission,
  createAuditLog,
  sanitizeFilename,
  validateUrl,
  validateDependencies,
  generateApiKey,
  hashApiKey,
  validateApiKey,
  generateAuditTrail,
} from '../src/cad/securityHardening.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Test Request Signing
console.log('Testing Request Signing...');
const secret = 'test-secret-key';
const payload = { action: 'create_plan', timestamp: Date.now() };
const signature = signRequest(payload, secret);
assert(signature, 'Should generate signature');
assert(verifyRequestSignature(payload, signature, secret), 'Should verify correct signature');
assert(!verifyRequestSignature({ ...payload, extra: 'data' }, signature, secret), 'Should reject modified payload');
console.log('✓ Request Signing passed');

// Test JWT Token Generation
console.log('Testing JWT Token Generation...');
const token = generateToken({ user_id: 123, role: 'admin' }, 'jwt-secret', 3600);
assert(token, 'Should generate token');
const claims = verifyToken(token, 'jwt-secret');
assert(claims.user_id === 123, 'Should preserve claims');
assert(claims.role === 'admin', 'Should preserve role');

try {
  verifyToken(token, 'wrong-secret');
  throw new Error('Should have thrown for wrong secret');
} catch (err) {
  assert(err.message.includes('Invalid token signature'), 'Should reject invalid signature');
}
console.log('✓ JWT Token Generation passed');

// Test RBAC
console.log('Testing RBAC...');
const adminActor = { id: 'admin1', roles: ['admin'] };
const engineerActor = { id: 'eng1', roles: ['engineer'] };
const viewerActor = { id: 'viewer1', roles: ['viewer'] };

assert(checkPermission(adminActor, {}, 'delete'), 'Admin should have all permissions');
assert(checkPermission(engineerActor, {}, 'create'), 'Engineer should have create permission');
assert(!checkPermission(engineerActor, {}, 'delete'), 'Engineer should not have delete permission');
assert(checkPermission(viewerActor, {}, 'read'), 'Viewer should have read permission');
assert(!checkPermission(viewerActor, {}, 'update'), 'Viewer should not have update permission');
console.log('✓ RBAC passed');

// Test Audit Logging
console.log('Testing Audit Logging...');
const auditLog = createAuditLog(
  adminActor,
  'create',
  { id: 'plan-123' },
  'success',
  { ip_address: '192.168.1.1', request_id: 'req-456' }
);
assert(auditLog.timestamp, 'Should have timestamp');
assert(auditLog.actor_id === 'admin1', 'Should record actor');
assert(auditLog.action === 'create', 'Should record action');
assert(auditLog.result === 'success', 'Should record result');
console.log('✓ Audit Logging passed');

// Test Filename Sanitization
console.log('Testing Filename Sanitization...');
assert(sanitizeFilename('plan.json') === 'plan.json', 'Should preserve safe filenames');
assert(!sanitizeFilename('../../../etc/passwd').includes('..'), 'Should prevent path traversal');
assert(!sanitizeFilename('file\0name.txt').includes('\0'), 'Should remove null bytes');
console.log('✓ Filename Sanitization passed');

// Test URL Validation
console.log('Testing URL Validation...');
assert(validateUrl('https://example.com'), 'Should accept https URLs');
assert(validateUrl('http://localhost:3000'), 'Should accept http URLs');
assert(!validateUrl('javascript:alert(1)'), 'Should reject javascript URLs');
assert(!validateUrl('file:///etc/passwd'), 'Should reject file URLs');
console.log('✓ URL Validation passed');

// Test Dependency Validation
console.log('Testing Dependency Validation...');
const validAssembly = {
  parts: [
    { id: 'p1', type: 'plate' },
    { id: 'p2', type: 'bracket' },
  ],
  interfaces: [{ part_a: 'p1', part_b: 'p2', type: 'bolted' }],
};
assert(validateDependencies(validAssembly).valid === true, 'Should validate correct assembly');

try {
  validateDependencies({
    parts: [{ id: 'p1', type: 'plate' }],
    interfaces: [{ part_a: 'p1', part_b: 'p99', type: 'bolted' }],
  });
  throw new Error('Should have thrown for missing part');
} catch (err) {
  assert(err.message.includes('not found'), 'Should detect missing parts');
}
console.log('✓ Dependency Validation passed');

// Test API Key Management
console.log('Testing API Key Management...');
const apiKey = generateApiKey();
assert(apiKey.length === 64, 'API key should be 64 chars (256-bit hex)');
const hashedKey = hashApiKey(apiKey);
assert(validateApiKey(apiKey, hashedKey), 'Should validate correct API key');
assert(!validateApiKey('wrong-key', hashedKey), 'Should reject incorrect API key');
console.log('✓ API Key Management passed');

// Test Audit Trail
console.log('Testing Audit Trail...');
const events = [
  { timestamp: new Date().toISOString(), actor_id: 'a1', action: 'create', resource: 'plan', result: 'success', severity: 'info' },
  { timestamp: new Date().toISOString(), actor_id: 'a2', action: 'delete', resource: 'plan', result: 'denied', severity: 'warning' },
  { timestamp: new Date().toISOString(), actor_id: 'a3', action: 'read', resource: 'plan', result: 'failure', severity: 'error' },
];
const trail = generateAuditTrail(events);
assert(trail.event_count === 3, 'Should count events');
assert(trail.summary.success_count === 1, 'Should count successes');
assert(trail.summary.failure_count === 1, 'Should count failures');
assert(trail.summary.denied_count === 1, 'Should count denials');
console.log('✓ Audit Trail passed');

console.log('\n✓✓✓ All Security Hardening tests passed ✓✓✓');

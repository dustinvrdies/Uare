import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const findings = [];
function checkFile(rel, severity = 'error') {
  const exists = fs.existsSync(path.join(root, rel));
  findings.push({ check: `file:${rel}`, ok: exists, severity, message: exists ? 'present' : 'missing' });
}
function checkPackageScript(script) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const ok = Boolean(pkg.scripts?.[script]);
  findings.push({ check: `script:${script}`, ok, severity: 'error', message: ok ? pkg.scripts[script] : 'missing' });
}
checkFile('docs/DEPLOYMENT.md');
checkFile('docs/OPERATIONS.md');
checkFile('docs/PRODUCTION_VERIFICATION.md');
checkFile('.env.example');
checkFile('scripts/preflightProduction.mjs');
checkFile('scripts/verifyProduction.mjs');
checkFile('schema.sql');
checkPackageScript('preflight:prod');
checkPackageScript('verify:prod');

const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
for (const [needle, name] of [
  ['securityHeaders', 'security headers mounted'],
  ['simpleRateLimit', 'rate limiter mounted'],
  ['requestLogging', 'request logging mounted'],
  ['requestMetrics', 'request metrics mounted'],
  ['notFound', 'json 404 mounted'],
  ['errorHandler', 'error handler mounted'],
  ['buildOpsRoutes(runtime', 'ops readiness router mounted'],
  ['/ops/quality', 'ops quality routes mounted'],
]) {
  const ok = server.includes(needle);
  findings.push({ check: `server:${name}`, ok, severity: 'error', message: ok ? 'present' : 'missing' });
}
const failed = findings.filter((finding) => !finding.ok && finding.severity === 'error');
console.log(JSON.stringify({ ok: failed.length === 0, findings }, null, 2));
if (failed.length) process.exit(1);

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const checks = [];

function add(name, ok, message) {
  checks.push({ name, ok, message });
}

add('package-lock present', fs.existsSync(path.join(root, 'package-lock.json')), 'package-lock.json should exist for repeatable installs');
add('schema present', fs.existsSync(path.join(root, 'schema.sql')), 'schema.sql should exist');
add('.env.example present', fs.existsSync(path.join(root, '.env.example')), '.env.example should exist');
add('tests directory present', fs.existsSync(path.join(root, 'tests')), 'tests should exist');
add('start script present', Boolean(pkg.scripts?.start), 'npm start must be defined');
add('test script present', Boolean(pkg.scripts?.test), 'npm test must be defined');
add('audit script present', Boolean(pkg.scripts?.['audit:prod']), 'npm run audit:prod should be defined');
add('preflight script present', Boolean(pkg.scripts?.['preflight:prod']), 'npm run preflight:prod should be defined');

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);

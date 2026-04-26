#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.dirname(__filename);
const backendDir = repoRoot;
const logsDir = path.join(repoRoot, 'logs');
const stateFile = path.join(repoRoot, '.uare-launch-state.json');
fs.mkdirSync(logsDir, { recursive: true });

const platform = process.platform;
const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const debugLog = path.join(logsDir, `bootstrap-${timestamp}.log`);
const logStream = fs.createWriteStream(debugLog, { flags: 'a' });

let serverChild = null;
let shuttingDown = false;

const argv = new Set(process.argv.slice(2));
const mode = {
  forceInstall: argv.has('--force-install'),
  skipTests: argv.has('--skip-tests'),
  skipBrowser: argv.has('--no-browser'),
  strict: argv.has('--strict'),
};

function log(...args) {
  const line = args.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ');
  console.log(line);
  logStream.write(line + '\n');
}

function commandExists(cmd) {
  const checker = platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(checker, [cmd], { stdio: 'ignore' });
  return res.status === 0;
}

function run(cmd, args, opts = {}) {
  log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || backendDir,
    shell: Boolean(opts.shell),
    stdio: opts.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
  });
  if (opts.capture) {
    if (res.stdout?.trim()) log(res.stdout.trim());
    if (res.stderr?.trim()) log(res.stderr.trim());
  }
  return res;
}

function spawnLogged(cmd, args, opts = {}) {
  log(`> ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd: opts.cwd || backendDir,
    shell: Boolean(opts.shell),
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });
  return child;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canListen(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findOpenPort(preferred) {
  if (await canListen(preferred)) return preferred;
  for (let port = preferred + 1; port <= preferred + 50; port += 1) {
    if (await canListen(port)) return port;
  }
  return preferred;
}

async function isServerAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ops/liveness`);
    return res.ok;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (mode.skipBrowser) return;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (commandExists('xdg-open')) {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    log(`Opened browser: ${url}`);
  } catch (err) {
    log(`Browser auto-open skipped: ${err.message}`);
  }
}

async function waitForHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {}
    await sleep(1200);
  }
  return false;
}

function maybeInstallNode() {
  if (commandExists('node') && (commandExists(npmCmd) || commandExists('npm'))) return true;

  log('Node.js/npm not found. Attempting best-effort installation...');
  const attempts = [];

  if (platform === 'win32') {
    if (commandExists('winget')) attempts.push(['winget', ['install', 'OpenJS.NodeJS.LTS', '--silent', '--accept-package-agreements', '--accept-source-agreements']]);
    if (commandExists('choco')) attempts.push(['choco', ['install', 'nodejs-lts', '-y']]);
  } else if (platform === 'darwin') {
    if (commandExists('brew')) attempts.push(['brew', ['install', 'node']]);
  } else {
    if (commandExists('apt-get')) attempts.push(['sh', ['-lc', 'sudo apt-get update && sudo apt-get install -y nodejs npm']]);
    if (commandExists('dnf')) attempts.push(['sh', ['-lc', 'sudo dnf install -y nodejs npm']]);
    if (commandExists('yum')) attempts.push(['sh', ['-lc', 'sudo yum install -y nodejs npm']]);
  }

  for (const [cmd, args] of attempts) {
    const res = run(cmd, args, { shell: cmd === 'sh' });
    if (res.status === 0 && commandExists('node') && (commandExists(npmCmd) || commandExists('npm'))) {
      log('Node.js installed successfully.');
      return true;
    }
  }

  log('Automatic Node.js install was not possible on this machine.');
  return commandExists('node') && (commandExists(npmCmd) || commandExists('npm'));
}

function ensureNodeAndNpm() {
  if (!maybeInstallNode()) {
    throw new Error('Node.js/npm is required. Install Node.js LTS, then run the launcher again.');
  }
  const nodeVersion = run('node', ['-v'], { capture: true });
  const npmVersion = run(npmCmd, ['-v'], { capture: true });
  const versionText = (nodeVersion.stdout || '').trim().replace(/^v/, '');
  const major = Number(versionText.split('.')[0] || 0);
  if (major && major < 20) {
    throw new Error(`Node.js 20+ is recommended. Found ${versionText}.`);
  }
  log(`Node ${versionText}`);
  log(`npm ${(npmVersion.stdout || '').trim()}`);
  return { nodeVersion: versionText, npmVersion: (npmVersion.stdout || '').trim() };
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(data) {
  fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
}

function ensureEnvFile(port) {
  const envPath = path.join(backendDir, '.env');
  const examplePath = path.join(backendDir, '.env.example');
  let envText = '';
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    log('Created custom_backend/.env from .env.example');
  }
  if (fs.existsSync(envPath)) {
    envText = fs.readFileSync(envPath, 'utf8');
  }
  const defaults = {
    NODE_ENV: 'development',
    BILLING_PROVIDER: 'mock',
    SESSION_SECRET: 'development-session-secret-please-change-1234567890',
    APP_BASE_URL: `http://localhost:${port}`,
    ALLOW_DEV_HEADER_AUTH: 'true',
    PORT: String(port),
  };
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (!new RegExp(`^${key}=`, 'm').test(envText)) {
      envText += (envText.endsWith('\n') || envText.length === 0 ? '' : '\n') + `${key}=${value}\n`;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(envPath, envText, 'utf8');
    log('Updated custom_backend/.env with local launcher defaults');
  }
  return envPath;
}

function ensureDirs() {
  for (const rel of ['data', 'artifacts', 'logs']) {
    fs.mkdirSync(path.join(backendDir, rel), { recursive: true });
  }
}

function shouldInstallDependencies(state, versions) {
  if (mode.forceInstall) return true;
  if (!fs.existsSync(path.join(backendDir, 'node_modules'))) return true;
  if (!state.lockHash) return false;
  const lockHash = fileHash(path.join(backendDir, 'package-lock.json'));
  return !(
    state.lockHash &&
    state.lockHash === lockHash &&
    state.nodeVersion === versions.nodeVersion &&
    state.npmVersion === versions.npmVersion
  );
}

function installDependencies(state, versions) {
  const hasLock = fs.existsSync(path.join(backendDir, 'package-lock.json'));
  if (!shouldInstallDependencies(state, versions)) {
    log('Dependencies look current. Skipping reinstall.');
    const next = {
      ...state,
      lockHash: fileHash(path.join(backendDir, 'package-lock.json')),
      nodeVersion: versions.nodeVersion,
      npmVersion: versions.npmVersion,
    };
    writeState(next);
    return next;
  }
  const preferred = hasLock ? [npmCmd, ['ci']] : [npmCmd, ['install']];
  let res = run(preferred[0], preferred[1]);
  if (res.status !== 0) {
    log('Primary dependency install failed. Retrying with npm install...');
    res = run(npmCmd, ['install']);
  }
  if (res.status !== 0) {
    throw new Error('Dependency installation failed.');
  }
  const next = {
    ...state,
    lockHash: fileHash(path.join(backendDir, 'package-lock.json')),
    nodeVersion: versions.nodeVersion,
    npmVersion: versions.npmVersion,
    lastInstallAt: new Date().toISOString(),
  };
  writeState(next);
  return next;
}

function runOptionalScript(name, env = {}, strict = false) {
  const pkgPath = path.join(backendDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return true;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts?.[name]) return true;
  const res = run(npmCmd, ['run', name], { env });
  if (res.status !== 0) {
    if (strict) throw new Error(`${name} failed.`);
    log(`${name} reported issues. Continuing because this is a smart local start.`);
    return false;
  }
  return true;
}

function shouldRunTests(state) {
  if (mode.skipTests) return false;
  const pkgHash = fileHash(path.join(backendDir, 'package.json'));
  const lockHash = fileHash(path.join(backendDir, 'package-lock.json'));
  return !(state.lastTestPkgHash === pkgHash && state.lastTestLockHash === lockHash);
}

function markTestsPassed(state) {
  const next = {
    ...state,
    lastTestPkgHash: fileHash(path.join(backendDir, 'package.json')),
    lastTestLockHash: fileHash(path.join(backendDir, 'package-lock.json')),
    lastTestsPassedAt: new Date().toISOString(),
  };
  writeState(next);
  return next;
}

async function startServer(port) {
  if (await isServerAlive(port)) {
    const appUrl = `http://localhost:${port}/lab`;
    log(`A UARE server is already running at ${appUrl}`);
    openBrowser(appUrl);
    return;
  }

  log('Starting UARE...');
  serverChild = spawnLogged(npmCmd, ['start'], {
    shell: platform === 'win32',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'mock',
      SESSION_SECRET: process.env.SESSION_SECRET || 'development-session-secret-please-change-1234567890',
      APP_BASE_URL: process.env.APP_BASE_URL || `http://localhost:${port}`,
      ALLOW_DEV_HEADER_AUTH: process.env.ALLOW_DEV_HEADER_AUTH || 'true',
      PORT: String(port),
    },
  });

  serverChild.on('exit', (code) => {
    if (!shuttingDown) log(`UARE exited with code ${code ?? 0}`);
    log(`Debug log saved to ${debugLog}`);
    logStream.end();
  });

  const healthUrl = `http://127.0.0.1:${port}/ops/liveness`;
  const ready = await waitForHttp(healthUrl, 60000);
  if (!ready) {
    throw new Error(`Server start could not be confirmed on port ${port}. Check ${debugLog}`);
  }

  const appUrl = `http://localhost:${port}/lab`;
  log(`UARE is running at ${appUrl}`);
  openBrowser(appUrl);

  const pkgPath = path.join(backendDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.scripts?.['verify:prod']) {
      runOptionalScript('verify:prod', {
        APP_BASE_URL: `http://localhost:${port}`,
        BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'mock',
      }, false);
    }
  }
}

function handleShutdown(signal) {
  shuttingDown = true;
  log(`Received ${signal}, shutting down launcher...`);
  if (serverChild && !serverChild.killed) {
    try { serverChild.kill('SIGTERM'); } catch {}
  }
  logStream.end();
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

try {
  log('=== UARE Smart Launcher ===');
  log(`Platform: ${platform}`);
  log(`OS: ${os.type()} ${os.release()} ${os.arch()}`);
  log(`Repo root: ${repoRoot}`);
  log(`Backend: ${backendDir}`);
  log(`Mode: ${JSON.stringify(mode)}`);

  const versions = ensureNodeAndNpm();
  ensureDirs();

  const preferredPort = Number(process.env.PORT || 8787);
  const port = await findOpenPort(preferredPort);
  if (port !== preferredPort) log(`Preferred port ${preferredPort} was busy. Using ${port} instead.`);

  ensureEnvFile(port);

  let state = readState();
  state = installDependencies(state, versions);

  runOptionalScript('clean:data');
  runOptionalScript('audit:prod');

  runOptionalScript('preflight:prod', {
    NODE_ENV: process.env.NODE_ENV || 'development',
    BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'mock',
    SESSION_SECRET: process.env.SESSION_SECRET || 'development-session-secret-please-change-1234567890',
    APP_BASE_URL: process.env.APP_BASE_URL || `http://localhost:${port}`,
    ALLOW_DEV_HEADER_AUTH: process.env.ALLOW_DEV_HEADER_AUTH || 'true',
    PORT: String(port),
  }, false);

  if (process.env.DATABASE_URL) {
    runOptionalScript('db:migrate', {
      DATABASE_URL: process.env.DATABASE_URL,
    }, false);
  }

  if (shouldRunTests(state)) {
    runOptionalScript('test', {
      NODE_ENV: process.env.NODE_ENV || 'test',
      BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'mock',
      SESSION_SECRET: process.env.SESSION_SECRET || 'test-session-secret-please-change-1234567890',
      ALLOW_DEV_HEADER_AUTH: process.env.ALLOW_DEV_HEADER_AUTH || 'true',
      APP_BASE_URL: process.env.APP_BASE_URL || `http://localhost:${port}`,
      PORT: String(port),
    }, true);
    state = markTestsPassed(state);
  } else {
    log('Package state unchanged since last passing test run. Skipping test rerun.');
  }

  await startServer(port);
} catch (err) {
  log(`ERROR: ${err.message}`);
  log(`Debug log saved to ${debugLog}`);
  console.error('\nUARE could not finish starting automatically.');
  console.error('Read the bootstrap log here:');
  console.error(debugLog);
  logStream.end();
  process.exit(1);
}

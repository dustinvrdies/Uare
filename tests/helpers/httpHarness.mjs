import { spawn } from 'child_process';
import { resolveFromImportMeta } from '../../src/platform/paths.mjs';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, proc, timeoutMs = 15000) {
  const startedAt = Date.now();
  let stderr = '';
  let stdout = '';

  proc.stdout.on('data', (data) => { stdout += String(data); });
  proc.stderr.on('data', (data) => { stderr += String(data); });

  while (Date.now() - startedAt < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(`backend exited early with code ${proc.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ops/liveness`);
      if (response.ok) return { stdout, stderr };
    } catch {}
    await wait(200);
  }

  throw new Error(`backend did not become ready within ${timeoutMs}ms\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

export async function startBackendServer(port = 8899, extraEnv = {}) {
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: resolveFromImportMeta(import.meta.url, '../..'),
    env: {
      ...process.env,
      PORT: String(port),
      CUSTOM_BACKEND_MODE: 'memory',
      ALLOW_DEV_HEADER_AUTH: 'true',
      ARTIFACT_STORAGE_MODE: 'local',
      CAD_KERNEL_ENABLED: 'false',
      BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'mock',
      ...extraEnv,
    },
    stdio: 'pipe',
    windowsHide: true,
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, proc);

  return {
    proc,
    baseUrl,
    async stop() {
      if (proc.exitCode === null) proc.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => proc.once('exit', resolve)),
        wait(3000),
      ]);
    }
  };
}

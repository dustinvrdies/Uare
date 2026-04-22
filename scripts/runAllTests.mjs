import { readdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testsDir = path.join(rootDir, 'tests');

function runNodeTest(relativePath) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [relativePath], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      const durationMs = Date.now() - started;
      if (code === 0) resolve({ durationMs });
      else reject(new Error(`${relativePath} failed with exit code ${code} after ${durationMs}ms`));
    });
    child.on('error', reject);
  });
}

const entries = (await readdir(testsDir))
  .filter((entry) => entry.endsWith('.mjs'))
  .sort((a, b) => a.localeCompare(b));

const started = Date.now();
for (let i = 0; i < entries.length; i += 1) {
  const entry = entries[i];
  console.log(`[${i + 1}/${entries.length}] ${entry}`);
  const result = await runNodeTest(path.join('tests', entry));
  console.log(`✓ ${entry} (${result.durationMs}ms)`);
}

console.log(`runAllTests.mjs passed (${entries.length} test files) in ${Date.now() - started}ms`);

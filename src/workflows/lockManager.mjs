import { withPgClient } from '../db/pg.mjs';

const memoryLocks = new Map();

function advisoryParts(key = '') {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619) >>> 0;
    b ^= (code + i);
    b = Math.imul(b, 2246822519) >>> 0;
  }
  return [a | 0, b | 0];
}

async function withMemoryLock(key, fn) {
  const prior = memoryLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  memoryLocks.set(key, prior.finally(() => gate));
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (memoryLocks.get(key) === gate) memoryLocks.delete(key);
  }
}

export function createWorkflowLockManager(runtime = {}) {
  async function withRunLock(runId, fn) {
    const key = `workflow:${String(runId)}`;
    if (runtime.mode === 'postgres' && runtime.databaseUrl) {
      const [partA, partB] = advisoryParts(key);
      return withPgClient(runtime.databaseUrl, async (client) => {
        await client.query('select pg_advisory_lock($1, $2)', [partA, partB]);
        try {
          return await fn();
        } finally {
          await client.query('select pg_advisory_unlock($1, $2)', [partA, partB]).catch(() => {});
        }
      });
    }
    return withMemoryLock(key, fn);
  }

  return { withRunLock };
}

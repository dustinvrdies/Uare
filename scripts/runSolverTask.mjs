import { runDeterministicSolver } from '../src/solver/deterministicWorker.mjs';

const payload = JSON.parse(process.argv[2] || '{}');
const job = payload?.job || { job_id: payload?.job_id || `solver-${Date.now()}`, payload: payload?.job_payload || {} };
const result = runDeterministicSolver(job);
process.stdout.write(`${JSON.stringify({ result })}\n`);

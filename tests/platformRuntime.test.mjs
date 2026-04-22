import { resolvePythonCommand, buildPythonArgs } from '../src/platform/process.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const command = resolvePythonCommand('');
assert(typeof command === 'string' && command.length > 0, 'expected a python command candidate');
const args = buildPythonArgs(command, 'runner.py', 'plan.json');
assert(Array.isArray(args) && args.includes('runner.py') && args.includes('plan.json'), 'expected python args to include runner and plan');
console.log('platformRuntime.test.mjs passed');

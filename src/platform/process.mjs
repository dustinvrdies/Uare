import { spawnSync } from 'child_process';

function toInvocation(candidate = '') {
  if (candidate && typeof candidate === 'object') {
    return {
      command: String(candidate.command || '').trim(),
      prefixArgs: Array.isArray(candidate.prefixArgs) ? candidate.prefixArgs.map((arg) => String(arg)) : [],
    };
  }
  const command = String(candidate || '').trim();
  return { command, prefixArgs: command === 'py' ? ['-3'] : [] };
}

function moduleProbeCode(requiredModules = []) {
  if (!Array.isArray(requiredModules) || requiredModules.length === 0) {
    return '';
  }
  const imports = requiredModules.map((name) => `import ${String(name)}`).join('; ');
  return `${imports}; print('ok')`;
}

function canRunPython(invocation, requiredModules = []) {
  const command = String(invocation?.command || '').trim();
  if (!command) {
    return false;
  }

  const prefixArgs = Array.isArray(invocation?.prefixArgs) ? invocation.prefixArgs : [];
  const versionProbe = spawnSync(command, [...prefixArgs, '--version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  if (versionProbe.error || versionProbe.status !== 0) {
    return false;
  }

  const code = moduleProbeCode(requiredModules);
  if (!code) {
    return true;
  }

  const moduleProbe = spawnSync(command, [...prefixArgs, '-c', code], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  return !moduleProbe.error && moduleProbe.status === 0;
}

export function resolvePythonInvocation(preferred = '', options = {}) {
  const explicitCandidates = Array.isArray(options?.candidates) ? options.candidates : [];
  const requiredModules = Array.isArray(options?.requiredModules) ? options.requiredModules : [];

  const invocations = [
    toInvocation(preferred),
    ...explicitCandidates.map((value) => toInvocation(value)),
    toInvocation(process.env.PYTHON),
    toInvocation(process.env.PYTHON_BIN),
    ...(process.platform === 'win32'
      ? [
          { command: 'py', prefixArgs: ['-3.11'] },
          { command: 'py', prefixArgs: ['-3.10'] },
          { command: 'py', prefixArgs: ['-3'] },
          toInvocation('python'),
          toInvocation('C:\\Python311\\python.exe'),
          toInvocation('C:\\Python310\\python.exe'),
        ]
      : [toInvocation('python3'), toInvocation('python')]),
  ].filter((entry) => entry.command);

  for (const invocation of invocations) {
    if (canRunPython(invocation, requiredModules)) {
      return invocation;
    }
  }

  for (const invocation of invocations) {
    if (canRunPython(invocation, [])) {
      return invocation;
    }
  }

  return invocations[0] || toInvocation(process.platform === 'win32' ? 'py' : 'python3');
}

export function resolvePythonCommand(preferred = '') {
  return resolvePythonInvocation(preferred).command;
}

export function buildPythonArgs(commandOrInvocation, scriptPath, planPath) {
  const invocation = toInvocation(commandOrInvocation);
  const prefixArgs = invocation.command === 'py' && invocation.prefixArgs.length === 0
    ? ['-3']
    : invocation.prefixArgs;
  if (prefixArgs.length > 0) {
    return [...prefixArgs, scriptPath, planPath];
  }
  return [scriptPath, planPath];
}

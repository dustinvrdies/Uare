
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveFromImportMeta } from '../platform/paths.mjs';
import { buildPythonArgs, resolvePythonInvocation } from '../platform/process.mjs';

function runPython(runtime, artifactStore, executionId, scriptName, logger, pythonBin) {
  const planPath = path.join(artifactStore.executionDir(executionId), 'plan.json');
  const runnerPath = resolveFromImportMeta(import.meta.url, `../../cad_runner/${scriptName}`);
  const requiredModules = scriptName === 'run_occ_kernel.py'
    ? ['OCC.Core.BRepPrimAPI']
    : ['cadquery'];
  const pythonInvocation = resolvePythonInvocation(pythonBin || runtime.cadPythonBin, {
    candidates: scriptName === 'run_occ_kernel.py'
      ? (runtime.occPythonCandidates || runtime.cadPythonCandidates || [])
      : (runtime.cadPythonCandidates || []),
    requiredModules,
  });
  const pythonCommand = pythonInvocation.command;
  const pythonArgs = buildPythonArgs(pythonInvocation, runnerPath, planPath);

  const result = spawnSync(pythonCommand, pythonArgs, {
    cwd: resolveFromImportMeta(import.meta.url, '../..'),
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });

  if (result.error) {
    logger.warn('cad.kernel.spawn_error', {
      execution_id: executionId,
      python_command: pythonCommand,
      python_args: pythonArgs,
      error: result.error.message,
    });
    return { ok: false, reason: result.error.message };
  }

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  if (result.status !== 0) {
    logger.warn('cad.kernel.nonzero_exit', {
      execution_id: executionId,
      python_command: pythonCommand,
      python_args: pythonArgs,
      status: result.status,
      stderr,
    });
    return { ok: false, reason: stderr || stdout || `Cad kernel exited ${result.status}` };
  }

  try {
    return JSON.parse(stdout || '{}');
  } catch {
    logger.warn('cad.kernel.bad_json', { execution_id: executionId, stdout });
    return { ok: false, reason: 'Unable to parse CAD kernel runner output' };
  }
}

export function tryCadKernelExecution(runtime, artifactStore, executionId, logger) {
  if (!runtime.cadKernelEnabled) {
    return { ok: false, skipped: true, reason: 'CAD kernel disabled' };
  }
  const engine = runtime.cadKernelEngine || 'cadquery';
  if (engine === 'occ') {
    return runPython(runtime, artifactStore, executionId, 'run_occ_kernel.py', logger, runtime.occPythonBin || runtime.cadPythonBin);
  }
  return runPython(runtime, artifactStore, executionId, 'run_cadquery.py', logger, runtime.cadPythonBin);
}

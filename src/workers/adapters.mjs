import path from 'path';
import { resolveFromImportMeta } from '../platform/paths.mjs';

function makeEnvelope(kind, executionTarget, payload = {}) {
  return {
    mode: executionTarget,
    executable: executionTarget === 'subprocess',
    handoff: {
      kind,
      execution_target: executionTarget,
      created_at: new Date().toISOString(),
      payload,
    },
  };
}

export function buildExecutionAdapterPlan(kind, executionTarget, payload = {}, runtime = {}) {
  const target = String(executionTarget || 'queued');
  if (target === 'in_process') {
    return {
      mode: 'in_process',
      executable: true,
      handoff: {
        kind,
        execution_target: 'in_process',
        strategy: 'local_inline_execution',
        payload,
      },
    };
  }
  if (target === 'subprocess') {
    const script = kind === 'solver' ? 'runSolverTask.mjs' : 'runCadTask.mjs';
    const scriptPath = resolveFromImportMeta(import.meta.url, `../../scripts/${script}`);
    return {
      ...makeEnvelope(kind, 'subprocess', payload),
      command: process.execPath,
      args: [scriptPath, JSON.stringify(payload)],
      handoff: {
        ...makeEnvelope(kind, 'subprocess', payload).handoff,
        strategy: 'node_subprocess_worker',
      },
    };
  }
  if (target === 'container_handoff') {
    return {
      ...makeEnvelope(kind, 'container_handoff', payload),
      image: runtime.workerContainerImage || 'ghcr.io/uare/worker:latest',
      queue_topic: kind,
      handoff: {
        ...makeEnvelope(kind, 'container_handoff', payload).handoff,
        strategy: 'portable_container_claim',
      },
    };
  }
  if (target === 'gpu_handoff') {
    return {
      ...makeEnvelope(kind, 'gpu_handoff', payload),
      accelerator: runtime.gpuWorkerClass || 'generic-gpu',
      queue_topic: `${kind}-gpu`,
      handoff: {
        ...makeEnvelope(kind, 'gpu_handoff', payload).handoff,
        strategy: 'gpu_queue_claim',
      },
    };
  }
  return {
    ...makeEnvelope(kind, 'queued', payload),
    queue_topic: kind,
    handoff: {
      ...makeEnvelope(kind, 'queued', payload).handoff,
      strategy: 'claim_next_queue',
    },
  };
}

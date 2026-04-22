import { startBackendServer } from './tests/helpers/httpHarness.mjs';

const server = await startBackendServer(8917, {
  CAD_KERNEL_ENABLED: 'true',
  CAD_PYTHON_CANDIDATES: 'C:\\Python311\\python.exe,C:\\Python310\\python.exe',
});

try {
  const payload = {
    plan: {
      engine: 'cadquery',
      ready_for_execution: true,
      manufacturable: { manufacturable: true },
      recipe: {
        parameters: {
          bracket_length_mm: 120,
          bracket_width_mm: 40,
          bracket_height_mm: 30,
          bolt_hole_diameter_mm: 8,
          material_name: 'aluminum_6061',
          process: 'cnc',
        },
      },
      script: 'print("cad user flow")',
    },
  };

  const executeResp = await fetch(server.baseUrl + '/cad/execute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': 'user-demo',
      'x-user-role': 'owner',
    },
    body: JSON.stringify(payload),
  });

  const executeJson = await executeResp.json();
  const m = executeJson?.manifest || {};
  const executionId = m.execution_id || '';

  console.log('EXECUTE_HTTP', executeResp.status);
  console.log('MANIFEST_STATUS', m.status || 'missing');
  console.log('ENGINE', m.engine || 'missing');
  console.log('KERNEL_OK', m?.kernel_execution?.ok ?? 'missing');
  console.log('KERNEL_REASON', m?.kernel_execution?.reason || '');
  console.log('ARTIFACT_COUNT', Array.isArray(m.artifacts) ? m.artifacts.length : 0);
  console.log('EXECUTION_ID', executionId || 'missing');
} finally {
  await server.stop();
}

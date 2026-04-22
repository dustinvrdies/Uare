import { startBackendServer } from './tests/helpers/httpHarness.mjs';

const server = await startBackendServer(8916, { CAD_KERNEL_ENABLED: 'true' });
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
          process: 'cnc'
        }
      },
      script: 'import cadquery as cq\nresult = cq.Workplane("XY").box(10, 10, 10)'
    }
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
  const executionId = executeJson?.manifest?.execution_id || '';

  const statusResp = await fetch(server.baseUrl + '/cad/status/' + executionId);
  const statusJson = await statusResp.json();

  const artifactResp = await fetch(server.baseUrl + '/cad/artifacts/' + executionId + '/manifest.json');
  const artifactText = await artifactResp.text();

  const m = executeJson?.manifest || {};
  const names = Array.isArray(m.artifacts) ? m.artifacts.map((a) => a.filename || a.type) : [];

  console.log('EXECUTE_HTTP', executeResp.status);
  console.log('STATUS_HTTP', statusResp.status);
  console.log('ARTIFACT_HTTP', artifactResp.status);
  console.log('EXECUTION_ID', executionId || 'missing');
  console.log('MANIFEST_STATUS', m.status || 'missing');
  console.log('ENGINE', m.engine || 'missing');
  console.log('KERNEL_OK', m?.kernel_execution?.ok ?? 'missing');
  console.log('KERNEL_SKIPPED', m?.kernel_execution?.skipped ?? 'missing');
  console.log('KERNEL_REASON', m?.kernel_execution?.reason || '');
  console.log('ARTIFACT_COUNT', names.length);
  console.log('HAS_STEP', names.some((n) => String(n).toLowerCase().endsWith('.step')));
  console.log('HAS_STL', names.some((n) => String(n).toLowerCase().endsWith('.stl')));
  console.log('STATUS_MATCHES', statusJson?.manifest?.execution_id === executionId);
  console.log('ARTIFACT_MANIFEST_CONTAINS_ID', artifactText.includes(executionId));
  console.log('ARTIFACT_SAMPLE', JSON.stringify(names.slice(0, 12)));
} finally {
  await server.stop();
}

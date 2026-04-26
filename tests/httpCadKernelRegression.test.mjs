import fs from 'fs';
import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isTransientNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  const message = String(error?.message || '').toLowerCase();
  return code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || message.includes('fetch failed')
    || message.includes('socket hang up');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasFiniteInertiaComponents(metrics) {
  const inertia = metrics?.inertia_proxy_kg_m2;
  return [inertia?.ix, inertia?.iy, inertia?.iz].every((value) => Number.isFinite(value));
}

function resolveCadPythonBin() {
  const candidates = [
    process.env.CAD_PYTHON_BIN,
    process.env.OCC_PYTHON_BIN,
    'C:\\Users\\quant\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'C:\\Python311\\python.exe',
  ].filter(Boolean);

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  assert(match, 'A Python 3.11 CadQuery runtime is required for kernel regression tests');
  return match;
}

async function executeKernelCase(server, shapeCase) {
  const response = await fetch(`${server.baseUrl}/cad/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        parts: [
          {
            id: `part-${shapeCase.type}`,
            name: `Regression-${shapeCase.type}`,
            type: shapeCase.type,
            kind: 'mechanical',
            dims: shapeCase.dims,
            position: [0, 0, 0],
          }
        ]
      }
    })
  });

  const data = await response.json();
  assert(response.ok === true, `POST /cad/execute should succeed for ${shapeCase.type}`);
  assert(data?.manifest?.execution_id, `execution id should be returned for ${shapeCase.type}`);
  assert(data?.manifest?.kernel_execution?.ok === true, `kernel execution should succeed for ${shapeCase.type}`);

  const kernelManifestResponse = await fetch(`${server.baseUrl}/cad/artifacts/${data.manifest.execution_id}/kernel_part_manifest.json`);
  const kernelManifest = await kernelManifestResponse.json();
  const part = Array.isArray(kernelManifest.parts) ? kernelManifest.parts[0] : null;

  assert(kernelManifestResponse.ok === true, `kernel_part_manifest.json should be available for ${shapeCase.type}`);
  assert(part, `kernel_part_manifest.json should include part data for ${shapeCase.type}`);
  return { manifest: data.manifest, part };
}

async function executeKernelCaseWithRetry(server, shapeCase, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await executeKernelCase(server, shapeCase);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw new Error(`shape case ${shapeCase.type} failed on attempt ${attempt}: ${error.message}`);
      }
      await wait(250 * attempt);
    }
  }

  throw lastError;
}

async function executeKernelPlan(server, parts) {
  const response = await fetch(`${server.baseUrl}/cad/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        parts,
      }
    })
  });

  const data = await response.json();
  assert(response.ok === true, 'POST /cad/execute should succeed for regression plan');
  assert(data?.manifest?.execution_id, 'execution id should be returned for regression plan');
  assert(data?.manifest?.kernel_execution?.ok === true, 'kernel execution should succeed for regression plan');

  const kernelManifestResponse = await fetch(`${server.baseUrl}/cad/artifacts/${data.manifest.execution_id}/kernel_part_manifest.json`);
  const kernelManifest = await kernelManifestResponse.json();

  assert(kernelManifestResponse.ok === true, 'kernel_part_manifest.json should be available for regression plan');
  assert(Array.isArray(kernelManifest.parts), 'kernel_part_manifest.json should include parts');
  return kernelManifest.parts;
}

async function executeKernelPlanWithRetry(server, parts, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await executeKernelPlan(server, parts);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw new Error(`kernel metrics plan failed on attempt ${attempt}: ${error.message}`);
      }
      await wait(250 * attempt);
    }
  }

  throw lastError;
}

function assertPositiveBbox(part, shapeType) {
  const bboxValues = Object.values(part?.bbox_mm || {}).filter((value) => Number.isFinite(value));
  assert(bboxValues.filter((value) => value > 0).length >= 3, `${shapeType} should expose a non-empty bbox_mm`);
}

function assertDimensionKeys(part, shapeType, expectedKeys) {
  const dimensions = part?.dimensions_mm || {};
  for (const key of expectedKeys) {
    assert(Number.isFinite(dimensions[key]), `${shapeType} should preserve semantic dimension key ${key}`);
  }
}

const cadPythonBin = resolveCadPythonBin();

const shapeCases = [
  { type: 'con_rod', dims: { ctc: 140, bigEndD: 50, smallEndD: 21, thickness: 20 }, expectedKeys: ['ctc', 'bigEndD', 'smallEndD', 'thickness'] },
  { type: 'engine_block', dims: { width: 465, height: 340, depth: 220, bore: 86, cylinders: 4 }, expectedKeys: ['width', 'height', 'depth', 'bore', 'cylinders'] },
  { type: 'cylinder_head', dims: { width: 380, height: 78, depth: 220, bore: 86, cylinders: 4 }, expectedKeys: ['width', 'height', 'depth', 'bore', 'cylinders'] },
  { type: 'turbocharger', dims: { compressor_diameter: 96, turbine_diameter: 88, length: 170, shaft_diameter: 14 }, expectedKeys: ['compressor_diameter', 'turbine_diameter', 'length', 'shaft_diameter'] },
  { type: 'oil_pump', dims: { outer_diameter: 110, thickness: 36, inner_rotor_diameter: 46, outer_rotor_diameter: 72 }, expectedKeys: ['outer_diameter', 'thickness', 'inner_rotor_diameter', 'outer_rotor_diameter'] },
  { type: 'water_pump', dims: { impeller_diameter: 72, body_diameter: 90, length: 120, hub_diameter: 24 }, expectedKeys: ['impeller_diameter', 'body_diameter', 'length', 'hub_diameter'] },
  { type: 'clutch_disc', dims: { outer_diameter: 240, inner_diameter: 130, thickness: 8, hub_diameter: 26 }, expectedKeys: ['outer_diameter', 'inner_diameter', 'thickness', 'hub_diameter'] },
  { type: 'timing_chain', dims: { pitch: 9.525, link_count: 96, width: 18, roller_diameter: 6.2 }, expectedKeys: ['pitch', 'link_count', 'width', 'roller_diameter'] },
  { type: 'nut_hex', dims: { across_flats: 13, thickness: 8, thread_diameter: 8 }, expectedKeys: ['across_flats', 'thickness', 'thread_diameter'] },
  { type: 'socket_head_screw', dims: { d: 12, L: 85, pitch: 1.75 }, expectedKeys: ['d', 'L', 'pitch'] },
  { type: 'washer', dims: { outer_diameter: 16, inner_diameter: 8.4, thickness: 1.6 }, expectedKeys: ['outer_diameter', 'inner_diameter', 'thickness'] },
  { type: 'dowel_pin', dims: { diameter: 8, length: 20 }, expectedKeys: ['diameter', 'length'] },
];

const kernelServerEnv = {
  CAD_KERNEL_ENABLED: 'true',
  CAD_PYTHON_BIN: cadPythonBin,
  OCC_PYTHON_BIN: cadPythonBin,
};

let dynamicPortCursor = 20000 + (process.pid % 10000);

function nextDynamicPort() {
  dynamicPortCursor += 1;
  return dynamicPortCursor;
}

async function withKernelServer(port, run) {
  const server = await startBackendServer(port, kernelServerEnv);
  try {
    return await run(server);
  } finally {
    await server.stop();
  }
}

try {
  for (let i = 0; i < shapeCases.length; i += 1) {
    const shapeCase = shapeCases[i];
    let casePassed = false;
    let lastCaseError;

    for (let attempt = 0; attempt < 2 && !casePassed; attempt += 1) {
      const port = nextDynamicPort();
      try {
        await withKernelServer(port, async (shapeServer) => {
          const { part } = await executeKernelCaseWithRetry(shapeServer, shapeCase, 3);
          assertPositiveBbox(part, shapeCase.type);
          assertDimensionKeys(part, shapeCase.type, shapeCase.expectedKeys);
        });
        casePassed = true;
      } catch (error) {
        lastCaseError = error;
      }
    }

    if (!casePassed && lastCaseError) {
      throw lastCaseError;
    }
  }

  let metricsPart = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const metricsPort = nextDynamicPort();
    const metricsParts = await withKernelServer(metricsPort, async (metricsServer) => executeKernelPlanWithRetry(metricsServer, [
      {
        id: 'metrics-engine-block',
        name: 'Metrics-EngineBlock',
        type: 'engine_block',
        kind: 'mechanical',
        dims: { width: 465, height: 340, depth: 220, bore: 86, cylinders: 4 },
        position: [0, 0, 0],
      },
      {
        id: 'metrics-pcb',
        name: 'Metrics-PCB',
        type: 'pcb',
        kind: 'electrical_pcb',
        dims: { x: 120, y: 80, z: 1.6 },
        position: [0, 0, 100],
      },
    ], 3));

    metricsPart = metricsParts.find((part) => part?.id === 'metrics-engine-block') || null;
    if (hasFiniteInertiaComponents(metricsPart?.kernel_metrics)) {
      break;
    }
  }

  assert(metricsPart, 'kernel metrics plan should include metrics-engine-block part');

  const kernelMetrics = metricsPart?.kernel_metrics || {};
  const strictlyPositiveMetricFields = [
    'volume_mm3',
    'surface_area_mm2',
    'mass_proxy_kg',
  ];
  for (const field of strictlyPositiveMetricFields) {
    assert(Number.isFinite(kernelMetrics[field]) && kernelMetrics[field] > 0, `kernel metric ${field} should be positive`);
  }

  const nonNegativeMetricFields = [
    'thin_wall_proxy_mm',
    'bbox_fill_ratio',
  ];
  for (const field of nonNegativeMetricFields) {
    assert(Number.isFinite(kernelMetrics[field]), `kernel metric ${field} should be present`);
    assert(kernelMetrics[field] >= 0, `kernel metric ${field} should be non-negative`);
  }

  const inertia = kernelMetrics.inertia_proxy_kg_m2;
  const inertiaComponents = [inertia?.ix, inertia?.iy, inertia?.iz];
  assert(
    inertiaComponents.every((value) => Number.isFinite(value)),
    `kernel metric inertia_proxy_kg_m2 should include ix/iy/iz (keys: ${Object.keys(kernelMetrics).join(',')})`
  );
  assert(
    inertiaComponents.every((value) => value >= 0),
    'kernel metric inertia_proxy_kg_m2 components should be non-negative'
  );

  console.log('httpCadKernelRegression.test.mjs passed');
} catch (error) {
  throw error;
}
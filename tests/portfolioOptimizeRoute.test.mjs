import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(server, runId, headers) {
  let latest = null;
  for (let i = 0; i < 50; i += 1) {
    const response = await fetch(`${server.baseUrl}/workflows/runs/${runId}`, { headers });
    const data = await response.json();
    latest = data.run;
    if (latest?.status === 'completed' || latest?.status === 'failed') break;
    await wait(50);
  }
  return latest;
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8922, {
  PHYSICS_EXECUTION_TARGET: 'in_process',
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
});

async function createRun(body) {
  const response = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert(response.ok === true, `workflow create should succeed: ${JSON.stringify(data)}`);
  return waitForRun(server, data.run.run_id, headers);
}

try {
  const strongRun = await createRun({
    workflow_type: 'cad_tiered_evaluator_pipeline',
    project_id: 'proj-portfolio-a',
    requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis'],
    metadata: { novelty_hint: 0.9 },
    cad_plan: {
      engine: 'cadquery',
      ready_for_execution: true,
      manufacturable: { manufacturable: true },
      recipe: { parameters: { bracket_length_mm: 70, bracket_width_mm: 42, bracket_height_mm: 24, bolt_hole_diameter_mm: 4 } },
      script: 'print("cad")',
    },
    solver_payload: {
      analysis_target: 'structural',
      materials: { youngs_modulus_mpa: 69000, yield_strength_mpa: 280 },
      loads: [{ type: 'force', magnitude_n: 60 }],
      constraints: [{ type: 'fixed', face: 'back' }],
    },
  });

  const weakRun = await createRun({
    workflow_type: 'cad_tiered_evaluator_pipeline',
    project_id: 'proj-portfolio-b',
    requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis'],
    metadata: { novelty_hint: 0.1 },
    cad_plan: {
      engine: 'cadquery',
      ready_for_execution: true,
      manufacturable: { manufacturable: true },
      recipe: { parameters: { channel_length_mm: 300, channel_diameter_mm: 3, bend_count: 5, surface_roughness_mm: 0.05 } },
      script: 'print("cad")',
    },
    solver_payload: {
      analysis_target: 'flow',
      target_flow_rate_lpm: 1.5,
      max_pressure_drop_pa: 10000,
      materials: { fluid_density_kg_m3: 997, dynamic_viscosity_cp: 1 },
    },
  });

  assert(strongRun?.status === 'completed', 'strong run should complete');
  assert(weakRun?.status === 'completed', 'weak run should complete');

  const response = await fetch(`${server.baseUrl}/portfolio/optimize?total_budget_units=120`, { headers });
  const data = await response.json();
  assert(response.ok === true, 'portfolio optimize should succeed');
  assert(data.report?.summary?.family_count >= 2, 'portfolio should include at least two families');
  assert(Array.isArray(data.report?.families), 'portfolio families should be an array');
  assert(data.report.families[0]?.portfolio_priority >= data.report.families[1]?.portfolio_priority, 'families should be sorted by portfolio priority');
  assert(Array.isArray(data.report?.decisions?.budget_allocation), 'budget allocation should be present');
  assert(data.report.decisions.budget_allocation.length >= 1, 'at least one family should receive budget allocation');

  console.log('portfolioOptimizeRoute.test.mjs passed');
} finally {
  await server.stop();
}

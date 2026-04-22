import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8904);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'solver-owner',
    'x-user-role': 'owner',
  };

  const submitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-job-1',
        project_id: 'proj-77',
        solver_type: 'static_structural',
        queue: 'adaptive',
        priority: 'high',
        cad_parameters: { width_mm: 12, thickness_mm: 4.5 },
        simulation_seed: { max_stress_mpa: 18 },
        quality_gates: { manufacturability_score: 88, novelty_score: 74 },
        load_case: { required_capacity_n: 450 },
        learning_context: { recommended_tags: [{ tag: 'ribbed', count: 5 }] },
      },
    }),
  });
  const submitPayload = await submitResponse.json();
  assert(submitResponse.status === 201, 'expected solver submit to create a job');
  assert(submitPayload.job.status === 'queued', 'expected submitted job to be queued');

  const getResponse = await fetch(`${server.baseUrl}/solver/jobs/solver-job-1`, {
    headers: { 'x-user-id': 'solver-owner', 'x-user-role': 'owner' },
  });
  const getPayload = await getResponse.json();
  assert(getResponse.ok, 'expected job lookup to pass');
  assert(getPayload.job.project_id === 'proj-77', 'expected job to retain project id');

  const completeResponse = await fetch(`${server.baseUrl}/solver/jobs/solver-job-1/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      result: {
        status: 'completed',
        feasible: true,
        convergence_score: 86,
        confidence_score: 83,
        max_stress_ratio: 0.72,
        summary: 'Converged with acceptable stress margin',
      },
    }),
  });
  const completePayload = await completeResponse.json();
  assert(completeResponse.ok, 'expected solver completion request to pass');
  assert(completePayload.job.status === 'completed', 'expected completed job status');
  assert(completePayload.learning_event.domain === 'solver', 'expected solver learning event');
  assert(completePayload.learning_event.success_score >= 70, 'expected strong solver learning score');
  assert(completePayload.job.learning_event_id === completePayload.learning_event.event_id, 'expected job linked to learning event');

  const listResponse = await fetch(`${server.baseUrl}/solver/jobs`, {
    headers: { 'x-user-id': 'solver-owner', 'x-user-role': 'owner' },
  });
  const listPayload = await listResponse.json();
  assert(listResponse.ok, 'expected list jobs to pass');
  assert(Array.isArray(listPayload.jobs) && listPayload.jobs.length >= 1, 'expected jobs list');
  assert(listPayload.jobs[0].result?.status === 'completed', 'expected result to be attached to listed job');

  const insightsResponse = await fetch(`${server.baseUrl}/learning/insights?domain=solver&project_id=proj-77`, {
    headers: { 'x-user-id': 'solver-owner' },
  });
  const insightsPayload = await insightsResponse.json();
  assert(insightsResponse.ok, 'expected solver learning insights to be retrievable');
  assert(insightsPayload.summary.totalEvents === 1, 'expected one solver learning event');
  assert(insightsPayload.hints.recommended_tags.some((entry) => entry.tag === 'ribbed'), 'expected solver tag insight');
  assert(insightsPayload.hints.signal_bias.required_capacity_n === 450, 'expected solver signal bias from result');

  console.log('solverRoutes.test.mjs passed');
} finally {
  await server.stop();
}

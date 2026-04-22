function baseStep(name, overrides = {}) {
  return {
    name,
    handler: name,
    retryable: true,
    max_retries: null,
    depends_on: [],
    terminal_on_failure: true,
    fan_in: 'all',
    metadata: {},
    ...overrides,
  };
}

const definitions = {
  cad_solver_pipeline: {
    workflow_type: 'cad_solver_pipeline',
    entry_step: 'cad',
    steps: {
      cad: baseStep('cad', { depends_on: [] }),
      solver: baseStep('solver', { depends_on: ['cad'] }),
    },
  },
  cad_review_solver_pipeline: {
    workflow_type: 'cad_review_solver_pipeline',
    entry_step: 'cad',
    steps: {
      cad: baseStep('cad', { depends_on: [] }),
      review: baseStep('review', { handler: 'review', depends_on: ['cad'] }),
      solver: baseStep('solver', { depends_on: ['review'] }),
    },
  },
  cad_parallel_review_solver_pipeline: {
    workflow_type: 'cad_parallel_review_solver_pipeline',
    entry_step: 'cad',
    steps: {
      cad: baseStep('cad', { depends_on: [] }),
      review_geometry: baseStep('review_geometry', { handler: 'review_geometry', depends_on: ['cad'] }),
      review_manufacturing: baseStep('review_manufacturing', { handler: 'review_manufacturing', depends_on: ['cad'] }),
      solver: baseStep('solver', { depends_on: ['review_geometry', 'review_manufacturing'], fan_in: 'all' }),
    },
  },
  cad_physics_solver_pipeline: {
    workflow_type: 'cad_physics_solver_pipeline',
    entry_step: 'cad',
    steps: {
      cad: baseStep('cad', { depends_on: [] }),
      physics_prescreen: baseStep('physics_prescreen', { handler: 'physics_prescreen', depends_on: ['cad'] }),
      solver: baseStep('solver', { depends_on: ['physics_prescreen'] }),
    },
  },
  cad_tiered_evaluator_pipeline: {
    workflow_type: 'cad_tiered_evaluator_pipeline',
    entry_step: 'cad',
    steps: {
      cad: baseStep('cad', { depends_on: [] }),
      physics_prescreen: baseStep('physics_prescreen', { handler: 'physics_prescreen', depends_on: ['cad'] }),
      mid_fidelity_analysis: baseStep('mid_fidelity_analysis', { handler: 'mid_fidelity_analysis', depends_on: ['physics_prescreen'] }),
      finalist_verification: baseStep('finalist_verification', { handler: 'finalist_verification', depends_on: ['mid_fidelity_analysis'] }),
    },
  },
};

export function getWorkflowDefinition(workflowType = 'cad_solver_pipeline', requestedSteps = ['cad', 'solver'], runtime = {}) {
  const selected = definitions[workflowType] || definitions.cad_solver_pipeline;
  const requested = new Set(Array.isArray(requestedSteps) && requestedSteps.length ? requestedSteps : Object.keys(selected.steps || {}));
  const steps = {};
  for (const [name, step] of Object.entries(selected.steps || {})) {
    if (!requested.has(name)) continue;
    steps[name] = {
      ...step,
      handler: step.handler || name,
      max_retries: Math.max(Number(step.max_retries ?? runtime.workflowStepMaxRetries ?? 2), 0),
      depends_on: (step.depends_on || []).filter((dep) => requested.has(dep)),
    };
  }
  const ordered = Object.keys(selected.steps || {}).filter((name) => steps[name]);
  return {
    workflow_type: selected.workflow_type,
    entry_step: ordered[0] || null,
    ordered_steps: ordered,
    steps,
    edges: ordered.flatMap((name) => (steps[name]?.depends_on || []).map((dep) => ({ from: dep, to: name }))),
  };
}

export function buildInitialStepStatus(definition = {}) {
  const status = {};
  for (const name of definition.ordered_steps || []) status[name] = 'pending';
  return status;
}

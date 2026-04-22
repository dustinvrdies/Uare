import crypto from 'crypto';

export const PHYSICS_DOMAINS = ['structural_static', 'kinematics', 'fluid_basic'];
export const PHYSICS_FIDELITY_TIERS = ['tier_1_fast', 'tier_2_mid', 'tier_3_high'];

export function makePhysicsJobId() {
  return `phys-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function asObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizePhysicsRequest(input = {}) {
  const payload = asObject(input);
  return {
    job_id: payload.job_id ? String(payload.job_id) : makePhysicsJobId(),
    domain: String(payload.domain || 'structural_static'),
    fidelity_tier: String(payload.fidelity_tier || 'tier_2_mid'),
    execution_target: String(payload.execution_target || 'in_process'),
    project_id: payload.project_id || null,
    geometry: asObject(payload.geometry),
    materials: asObject(payload.materials),
    loads: asArray(payload.loads),
    boundary_conditions: asArray(payload.boundary_conditions),
    solver_settings: asObject(payload.solver_settings),
    metadata: asObject(payload.metadata),
  };
}

export function validatePhysicsRequest(input = {}) {
  const payload = normalizePhysicsRequest(input);
  const errors = [];
  if (!PHYSICS_DOMAINS.includes(payload.domain)) errors.push(`Unsupported domain: ${payload.domain}`);
  if (!PHYSICS_FIDELITY_TIERS.includes(payload.fidelity_tier)) errors.push(`Unsupported fidelity tier: ${payload.fidelity_tier}`);
  if (payload.domain === 'structural_static') {
    const params = payload.geometry?.parameters || {};
    const hasParametric = Object.keys(params).length > 0;
    if (!hasParametric) errors.push('geometry.parameters are required for structural_static');
    if (!payload.loads.length) errors.push('loads are required for structural_static');
  }
  if (payload.domain === 'kinematics') {
    const links = asArray(payload.geometry?.links);
    const joints = asArray(payload.geometry?.joints);
    if (!links.length) errors.push('geometry.links are required for kinematics');
    if (!joints.length) errors.push('geometry.joints are required for kinematics');
  }
  if (payload.domain === 'fluid_basic') {
    const params = payload.geometry?.parameters || {};
    const hasParametric = Object.keys(params).length > 0;
    if (!hasParametric) errors.push('geometry.parameters are required for fluid_basic');
    const inletFlow = Number(payload.solver_settings?.target_flow_rate_lpm || payload.metadata?.target_flow_rate_lpm || 0);
    if (inletFlow <= 0) errors.push('solver_settings.target_flow_rate_lpm is required for fluid_basic');
  }
  return {
    ok: errors.length === 0,
    errors,
    request: payload,
  };
}

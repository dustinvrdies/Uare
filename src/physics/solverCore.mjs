function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function structuralStaticSolver(request = {}) {
  const params = request.geometry?.parameters || {};
  const loads = Array.isArray(request.loads) ? request.loads : [];
  const materials = request.materials || {};
  const lengthMm = Math.max(Number(params.bracket_length_mm || params.length_mm || 50), 1);
  const widthMm = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
  const heightMm = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
  const holeMm = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 0), 0);
  const youngsModulusMpa = Math.max(Number(materials.youngs_modulus_mpa || materials.youngs_modulus || 69000), 1000);
  const yieldStrengthMpa = Math.max(Number(materials.yield_strength_mpa || 250), 1);
  const totalForceN = loads.reduce((sum, load) => sum + Number(load?.magnitude_n || 0), 0);
  const holeArea = Math.PI * Math.pow(holeMm / 2, 2);
  const areaMm2 = Math.max((widthMm * heightMm) - holeArea, 1);
  const inertiaMm4 = Math.max((widthMm * Math.pow(heightMm, 3)) / 12, 1);
  const momentNmm = totalForceN * lengthMm;
  const maxStressMpa = Number((((momentNmm * (heightMm / 2)) / inertiaMm4)).toFixed(6));
  const modulusScale = youngsModulusMpa / 1000;
  const maxDisplacementMm = Number((((totalForceN * Math.pow(lengthMm, 3)) / Math.max(3 * modulusScale * inertiaMm4, 1))).toFixed(6));
  const safetyFactor = Number((yieldStrengthMpa / Math.max(maxStressMpa, 0.000001)).toFixed(6));
  const stiffnessProxy = Number(((areaMm2 * heightMm) / lengthMm).toFixed(6));
  const confidence = Number(clamp(0.62 + Math.min(stiffnessProxy / 200, 0.18) + Math.min(safetyFactor / 8, 0.15), 0, 0.98).toFixed(4));
  const passed = safetyFactor >= 1 && maxDisplacementMm <= Math.max(lengthMm * 0.25, 2);
  let failureMode = 'none';
  if (!passed) {
    failureMode = safetyFactor < 1 ? 'yield_risk' : 'excessive_deflection';
  }
  return {
    status: 'completed',
    domain: 'structural_static',
    fidelity_tier: request.fidelity_tier,
    provider: 'uare_physics',
    model: 'structural_static_beam_v1',
    max_stress_mpa: maxStressMpa,
    max_displacement_mm: maxDisplacementMm,
    safety_factor: safetyFactor,
    stiffness_proxy: stiffnessProxy,
    total_force_n: totalForceN,
    section_area_mm2: Number(areaMm2.toFixed(6)),
    failure_mode: failureMode,
    passed,
    confidence,
    actual_cost_units: Number((request.fidelity_tier === 'tier_1_fast' ? 0.5 : request.fidelity_tier === 'tier_3_high' ? 3.5 : 1.5).toFixed(2)),
    actual_duration_ms: request.fidelity_tier === 'tier_1_fast' ? 25 : request.fidelity_tier === 'tier_3_high' ? 250 : 75,
    provenance: {
      engine: 'uare_physics',
      solver_family: 'structural_static',
      model: 'structural_static_beam_v1',
      execution_mode: 'internal',
    },
  };
}

function kinematicsSolver(request = {}) {
  const links = Array.isArray(request.geometry?.links) ? request.geometry.links : [];
  const joints = Array.isArray(request.geometry?.joints) ? request.geometry.joints : [];
  const collisions = Array.isArray(request.geometry?.collision_pairs) ? request.geometry.collision_pairs : [];
  const workspaceTargetMm = Math.max(Number(request.solver_settings?.workspace_target_mm || request.metadata?.workspace_target_mm || 100), 1);
  const cycleTargetMs = Math.max(Number(request.solver_settings?.cycle_target_ms || request.metadata?.cycle_target_ms || 1500), 1);

  const totalLinkLengthMm = Number(links.reduce((sum, link) => sum + Math.max(Number(link?.length_mm || 0), 0), 0).toFixed(6));
  const actuatedJointCount = joints.filter((joint) => String(joint?.actuated || '').toLowerCase() === 'true' || joint?.actuated === true).length;
  const revoluteJointCount = joints.filter((joint) => String(joint?.type || 'revolute') === 'revolute').length;
  const prismaticJointCount = joints.filter((joint) => String(joint?.type || '') === 'prismatic').length;
  const jointCount = joints.length;
  const linkCount = links.length;

  const reachableWorkspaceRatio = Number(clamp((totalLinkLengthMm / workspaceTargetMm) * (0.72 + Math.min(jointCount, 6) * 0.05), 0.05, 1).toFixed(6));
  const collisionPenalty = collisions.length ? Math.min(collisions.length * 0.08, 0.45) : Math.max((jointCount - linkCount) * 0.03, 0);
  const collisionFreeRatio = Number(clamp(0.97 - collisionPenalty, 0.2, 1).toFixed(6));
  const mobilityIndex = Number(clamp((revoluteJointCount + (prismaticJointCount * 1.15)) / Math.max(linkCount, 1), 0.2, 2.5).toFixed(6));
  const cycleTimeMs = Number((Math.max(250, (totalLinkLengthMm * 4.5) + (jointCount * 90) - (actuatedJointCount * 55))).toFixed(3));
  const cycleFeasibility = Number(clamp(cycleTargetMs / Math.max(cycleTimeMs, 1), 0, 1.4).toFixed(6));
  const singularityRisk = Number(clamp(0.12 + Math.max(jointCount - actuatedJointCount, 0) * 0.05 - Math.min(revoluteJointCount * 0.01, 0.08), 0.02, 0.9).toFixed(6));
  const confidence = Number(clamp(0.61 + Math.min(reachableWorkspaceRatio * 0.17, 0.17) + Math.min(collisionFreeRatio * 0.12, 0.12), 0.2, 0.97).toFixed(4));
  const passed = reachableWorkspaceRatio >= 0.65 && collisionFreeRatio >= 0.75 && cycleFeasibility >= 0.8;

  let failureMode = 'none';
  if (!passed) {
    if (reachableWorkspaceRatio < 0.65) failureMode = 'insufficient_workspace';
    else if (collisionFreeRatio < 0.75) failureMode = 'collision_risk';
    else failureMode = 'cycle_time_risk';
  }

  return {
    status: 'completed',
    domain: 'kinematics',
    fidelity_tier: request.fidelity_tier,
    provider: 'uare_physics',
    model: 'kinematics_rigidbody_v1',
    reachable_workspace_ratio: reachableWorkspaceRatio,
    collision_free_ratio: collisionFreeRatio,
    mobility_index: mobilityIndex,
    cycle_time_ms: cycleTimeMs,
    cycle_feasibility: cycleFeasibility,
    singularity_risk: singularityRisk,
    total_link_length_mm: totalLinkLengthMm,
    actuated_joint_count: actuatedJointCount,
    failure_mode: failureMode,
    passed,
    confidence,
    actual_cost_units: Number((request.fidelity_tier === 'tier_1_fast' ? 0.45 : request.fidelity_tier === 'tier_3_high' ? 2.75 : 1.1).toFixed(2)),
    actual_duration_ms: request.fidelity_tier === 'tier_1_fast' ? 20 : request.fidelity_tier === 'tier_3_high' ? 180 : 60,
    provenance: {
      engine: 'uare_physics',
      solver_family: 'kinematics',
      model: 'kinematics_rigidbody_v1',
      execution_mode: 'internal',
    },
  };
}


function fluidBasicSolver(request = {}) {
  const params = request.geometry?.parameters || {};
  const materials = request.materials || {};
  const lengthMm = Math.max(Number(params.channel_length_mm || params.length_mm || 150), 1);
  const diameterMm = Math.max(Number(params.channel_diameter_mm || params.hydraulic_diameter_mm || 8), 0.1);
  const roughnessMm = Math.max(Number(params.surface_roughness_mm || 0.02), 0);
  const bendCount = Math.max(Number(params.bend_count || 0), 0);
  const fluidDensityKgM3 = Math.max(Number(materials.fluid_density_kg_m3 || 997), 0.1);
  const viscosityCps = Math.max(Number(materials.dynamic_viscosity_cp || materials.dynamic_viscosity_cP || 1), 0.01);
  const targetFlowRateLpm = Math.max(Number(request.solver_settings?.target_flow_rate_lpm || request.metadata?.target_flow_rate_lpm || 1), 0.001);
  const targetPressureDropPa = Math.max(Number(request.solver_settings?.max_pressure_drop_pa || request.metadata?.max_pressure_drop_pa || 25000), 1);

  const flowRateM3S = targetFlowRateLpm / 60000;
  const diameterM = diameterMm / 1000;
  const areaM2 = Math.PI * Math.pow(diameterM / 2, 2);
  const velocityMS = flowRateM3S / Math.max(areaM2, 1e-9);
  const reynolds = Number(clamp((fluidDensityKgM3 * velocityMS * diameterM) / Math.max(viscosityCps * 0.001, 1e-9), 10, 5e6).toFixed(3));
  const roughnessRatio = roughnessMm / Math.max(diameterMm, 0.001);
  const frictionFactor = reynolds < 2300
    ? Number((64 / reynolds).toFixed(6))
    : Number(clamp((0.3164 / Math.pow(reynolds, 0.25)) + (roughnessRatio * 0.8), 0.008, 0.2).toFixed(6));
  const lengthM = lengthMm / 1000;
  const dynamicPressure = 0.5 * fluidDensityKgM3 * Math.pow(velocityMS, 2);
  const majorLossPa = frictionFactor * (lengthM / Math.max(diameterM, 1e-9)) * dynamicPressure;
  const minorLossPa = (bendCount * 0.35 + 0.15) * dynamicPressure;
  const pressureDropPa = Number((majorLossPa + minorLossPa).toFixed(6));
  const flowEfficiency = Number(clamp(targetPressureDropPa / Math.max(pressureDropPa, 1), 0, 1.5).toFixed(6));
  const cavitationRisk = Number(clamp((pressureDropPa / Math.max(targetPressureDropPa * 1.6, 1)) + Math.min(velocityMS / 12, 0.25), 0.01, 0.98).toFixed(6));
  const turbulenceIndex = Number(clamp(reynolds / 4000, 0, 3).toFixed(6));
  const liftToDragRatio = Number(clamp((flowEfficiency * 1.8) / Math.max(0.2 + cavitationRisk, 0.05), 0.05, 8).toFixed(6));
  const confidence = Number(clamp(0.58 + Math.min(flowEfficiency * 0.18, 0.18) + Math.min((1 - cavitationRisk) * 0.16, 0.16), 0.2, 0.96).toFixed(4));
  const passed = pressureDropPa <= targetPressureDropPa && cavitationRisk <= 0.55;

  let failureMode = 'none';
  if (!passed) {
    if (pressureDropPa > targetPressureDropPa) failureMode = 'excessive_pressure_drop';
    else failureMode = 'cavitation_risk';
  }

  return {
    status: 'completed',
    domain: 'fluid_basic',
    fidelity_tier: request.fidelity_tier,
    provider: 'uare_physics',
    model: 'fluid_basic_pipe_v1',
    pressure_drop_pa: pressureDropPa,
    flow_rate_m3_s: Number(flowRateM3S.toFixed(9)),
    reynolds_number: reynolds,
    friction_factor: frictionFactor,
    flow_efficiency: flowEfficiency,
    cavitation_risk: cavitationRisk,
    turbulence_index: turbulenceIndex,
    lift_to_drag_ratio: liftToDragRatio,
    velocity_m_s: Number(velocityMS.toFixed(6)),
    hydraulic_diameter_mm: Number(diameterMm.toFixed(6)),
    failure_mode: failureMode,
    passed,
    confidence,
    actual_cost_units: Number((request.fidelity_tier === 'tier_1_fast' ? 0.4 : request.fidelity_tier === 'tier_3_high' ? 2.25 : 0.95).toFixed(2)),
    actual_duration_ms: request.fidelity_tier === 'tier_1_fast' ? 18 : request.fidelity_tier === 'tier_3_high' ? 140 : 45,
    provenance: {
      engine: 'uare_physics',
      solver_family: 'fluid_basic',
      model: 'fluid_basic_pipe_v1',
      execution_mode: 'internal',
    },
  };
}

export function solvePhysicsRequest(request = {}) {
  if (request.domain === 'structural_static') return structuralStaticSolver(request);
  if (request.domain === 'kinematics') return kinematicsSolver(request);
  if (request.domain === 'fluid_basic') return fluidBasicSolver(request);
  throw new Error(`Unsupported physics domain: ${request.domain}`);
}

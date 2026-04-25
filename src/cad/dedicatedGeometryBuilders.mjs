/**
 * Dedicated high-detail geometry builders for complex engine and assembly components.
 * Extends the basic shape library with application-specific, optimized builders.
 */

function buildOilFilter(params = {}) {
  const diameter_mm = Number(params.diameter_mm || 90);
  const height_mm = Number(params.height_mm || 120);
  const thread_pitch_mm = Number(params.thread_pitch_mm || 1.5);
  const bypass_valve_open_psi = Number(params.bypass_valve_open_psi || 5);
  
  const portDiameter_mm = Number(params.port_diameter_mm || 18);
  const canThickness_mm = Number(params.can_thickness_mm || 2.5);
  
  const baseCanVolume_mm3 = Math.PI * Math.pow(diameter_mm / 2, 2) * height_mm * 0.65; // ~65% fill for media
  const mediaCapacity_L = baseCanVolume_mm3 / 1000 / 1000;
  
  return {
    id: params.id || 'oil_filter',
    type: 'oil_filter',
    kind: 'mechanical_component',
    name: params.name || `Oil Filter (${diameter_mm}mm x ${height_mm}mm)`,
    geometry: {
      shape: 'cylinder',
      diameter_mm,
      height_mm,
      material: params.material || 'steel',
      process: params.process || 'deep_draw',
    },
    performance: {
      media_capacity_L: Number(mediaCapacity_L.toFixed(2)),
      bypass_valve_open_psi,
      collapse_pressure_psi: Number((bypass_valve_open_psi * 3.5).toFixed(1)),
      max_flow_gpm: Number((mediaCapacity_L * 3.785 / 5).toFixed(1)),
    },
    threading: {
      port_diameter_mm: portDiameter_mm,
      thread_spec: `M${portDiameter_mm}x${thread_pitch_mm}`,
      pitch_mm: thread_pitch_mm,
      depth_of_engagement_mm: Number((portDiameter_mm * 1.25).toFixed(1)),
    },
    structure: {
      can_thickness_mm: canThickness_mm,
      base_thickness_mm: Number((canThickness_mm * 2).toFixed(2)),
      anti_drainback_valve: true,
      bypass_valve: true,
    },
    manufacturing: {
      estimated_cost_usd: Number((diameter_mm / 30 + height_mm / 50 + 2.5).toFixed(2)),
      lead_time_days: 15,
      min_order_qty: 50,
    },
  };
}

function buildAirIntake(params = {}) {
  const inlet_diameter_mm = Number(params.inlet_diameter_mm || 85);
  const outlet_diameter_mm = Number(params.outlet_diameter_mm || 65);
  const length_mm = Number(params.length_mm || 180);
  const bend_radius_mm = Number(params.bend_radius_mm || 120);
  const filterArea_mm2 = Number(params.filter_area_mm2 || 25000);
  
  const flowCapacity_cfm = Number((filterArea_mm2 / 100 * 1.2).toFixed(0));
  const pressureDrop_Pa = Number((1000 + flowCapacity_cfm / 10).toFixed(0));
  
  return {
    id: params.id || 'air_intake',
    type: 'air_intake',
    kind: 'mechanical_component',
    name: params.name || `Air Intake (${inlet_diameter_mm}mm → ${outlet_diameter_mm}mm)`,
    geometry: {
      shape: 'compound_bend',
      inlet_diameter_mm,
      outlet_diameter_mm,
      bend_radius_mm,
      length_mm,
      material: params.material || 'aluminum_6061',
      process: params.process || 'die_cast',
    },
    aerodynamics: {
      filter_area_mm2: filterArea_mm2,
      flow_capacity_cfm: flowCapacity_cfm,
      flow_capacity_L_min: Number((flowCapacity_cfm * 0.47195).toFixed(0)),
      pressure_drop_Pa: pressureDrop_Pa,
      efficiency_percent: Number(Math.max(60, 95 - pressureDrop_Pa / 50).toFixed(1)),
    },
    structure: {
      wall_thickness_mm: 3.5,
      reinforcement_ribs: true,
      mounting_bosses: 4,
      seal_grooves: true,
    },
    manufacturing: {
      estimated_cost_usd: Number((length_mm / 40 + inlet_diameter_mm / 30 + 3.5).toFixed(2)),
      lead_time_days: 20,
      min_order_qty: 100,
    },
  };
}

function buildExhaustManifold(params = {}) {
  const numCylinders = Number(params.num_cylinders || 4);
  const primaryTubediameter_mm = Number(params.primary_tube_diameter_mm || 45);
  const secondaryTubediameter_mm = Number(params.secondary_tube_diameter_mm || 65);
  const flangeDiameter_mm = Number(params.flange_diameter_mm || 180);
  const maxTemp_C = Number(params.max_temp_C || 900);
  
  const primaryVolume_L = (numCylinders * Math.PI * Math.pow(primaryTubediameter_mm / 2, 2) * 200) / 1_000_000;
  const heatCapacity_kW = Number((numCylinders * 8.5).toFixed(1));
  const thermalStress_MPa = Number((25 + maxTemp_C / 40).toFixed(1));
  
  return {
    id: params.id || 'exhaust_manifold',
    type: 'exhaust_manifold',
    kind: 'mechanical_component',
    name: params.name || `Exhaust Manifold (${numCylinders}-cyl, ${maxTemp_C}°C)`,
    geometry: {
      shape: 'multi_collector',
      num_cylinders: numCylinders,
      primary_tube_diameter_mm: primaryTubediameter_mm,
      secondary_tube_diameter_mm: secondaryTubediameter_mm,
      flange_diameter_mm,
      material: params.material || 'ductile_iron',
      process: params.process || 'sand_cast',
    },
    performance: {
      primary_volume_L: Number(primaryVolume_L.toFixed(2)),
      secondary_volume_L: Number((primaryVolume_L * 1.8).toFixed(2)),
      heat_capacity_kW: heatCapacity_kW,
      max_temperature_C: maxTemp_C,
      thermal_stress_MPa: thermalStress_MPa,
      backpressure_target_kPa: Number((15 + numCylinders * 2).toFixed(1)),
    },
    structure: {
      wall_thickness_mm: 5.5,
      insulation_coating: 'ceramic',
      o_ring_grooves: numCylinders + 1,
      mounting_bosses: 3,
      turbo_flange: params.turbo_flange || false,
    },
    manufacturing: {
      estimated_cost_usd: Number((numCylinders * 15 + flangeDiameter_mm / 8).toFixed(2)),
      lead_time_days: 35,
      min_order_qty: 25,
      casting_weight_kg: Number((numCylinders * 3.5).toFixed(1)),
    },
  };
}

function buildClutchAssembly(params = {}) {
  const discDiameter_mm = Number(params.disc_diameter_mm || 240);
  const numDiscs = Number(params.num_discs || 3);
  const frictionCoeff = Number(params.friction_coefficient || 0.35);
  const clampForce_N = Number(params.clamp_force_N || 18000);
  const maxTorque_Nm = Number((clampForce_N * (discDiameter_mm / 2) * frictionCoeff * numDiscs / 1000).toFixed(0));
  
  const flyWheelInertia_kgm2 = Number((discDiameter_mm * discDiameter_mm / 200000).toFixed(3));
  const slipTorque_Nm = Number((maxTorque_Nm * 1.15).toFixed(0));
  
  return {
    id: params.id || 'clutch_assembly',
    type: 'clutch_assembly',
    kind: 'mechanical_component',
    name: params.name || `Clutch Assembly (${discDiameter_mm}mm, ${numDiscs}-disc)`,
    geometry: {
      shape: 'multi_plate_assembly',
      disc_diameter_mm: discDiameter_mm,
      num_discs: numDiscs,
      stack_height_mm: Number((numDiscs * 3.5 + 8).toFixed(1)),
      material: params.material || 'ductile_iron',
      process: params.process || 'sintering',
    },
    performance: {
      max_torque_Nm: maxTorque_Nm,
      slip_torque_Nm: slipTorque_Nm,
      clamp_force_N,
      friction_coefficient: frictionCoeff,
      engagement_time_s: 0.15,
      heat_dissipation_kW: 8.5,
      flywheel_inertia_kgm2: flyWheelInertia_kgm2,
    },
    structure: {
      pressure_plate: true,
      damper_springs: true,
      release_bearing: 'sealed',
      wear_indicator: true,
      spline_teeth: 23,
    },
    manufacturing: {
      estimated_cost_usd: Number((maxTorque_Nm / 50 + numDiscs * 8).toFixed(2)),
      lead_time_days: 28,
      min_order_qty: 30,
      assembly_time_min: 12,
    },
  };
}

export function buildDedicatedComponent(type = '', params = {}) {
  const builders = {
    oil_filter: buildOilFilter,
    air_intake: buildAirIntake,
    exhaust_manifold: buildExhaustManifold,
    clutch_assembly: buildClutchAssembly,
  };
  
  const builder = builders[String(type).toLowerCase()];
  return builder ? builder(params) : null;
}

export function getDedicatedComponentTypes() {
  return [
    { type: 'oil_filter', label: 'Oil Filter', description: 'Engine oil filtration with bypass valve' },
    { type: 'air_intake', label: 'Air Intake', description: 'Intake manifold with filter housing' },
    { type: 'exhaust_manifold', label: 'Exhaust Manifold', description: 'Multi-collector cast manifold' },
    { type: 'clutch_assembly', label: 'Clutch Assembly', description: 'Multi-plate friction clutch' },
  ];
}

export function augmentAssemblyWithDedicatedComponents(plan = {}) {
  if (!Array.isArray(plan.parts)) return plan;
  
  const augmentedParts = plan.parts.map((part) => {
    if (!part.type) return part;
    const dedicated = buildDedicatedComponent(part.type, part);
    if (!dedicated) return part;
    return { ...part, ...dedicated };
  });
  
  return { ...plan, parts: augmentedParts };
}

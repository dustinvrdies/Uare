/**
 * ENKI ENHANCED SCHEMA
 * Full manufacturing-aware part structure with editing capabilities
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Complete Part Schema with Manufacturing Metadata
 * Every part is REAL — has function, constraints, manufacturing method, tolerances
 */
export const ENHANCED_PART_SCHEMA = {
  // STRUCTURAL IDENTITY
  id: 'part_001',                    // unique ID for edit tracking
  name: 'Part Name — Full Standard Designation',
  description: 'Detailed functional description',
  type: 'bolt_hex|bearing|gear|...',
  quantity: 1,

  // PHYSICAL PROPERTIES
  material: 'steel_4340|aluminum_7075_t6|...',
  density_kg_m3: null,               // auto-filled from material DB
  mass_kg: 0.123,                    // computed or specified
  color: '#5a6a7a',

  // GEOMETRY
  dims: {
    w: 100,                           // width / x
    h: 50,                            // height / z
    d: 30,                            // depth / y
    // Additional properties as needed:
    L: 150,                           // length
    diameter: 25,
    innerD: 20,
    outerD: 30,
    pitch_diameter: 28,
    thread_pitch: 1.5,
    bore: 20,
  },
  position: [0, 0, 0],               // mm, part centroid
  rotation: [0, 0, 0],               // degrees around X, Y, Z

  // ENGINEERING SPECIFICATIONS
  engineering: {
    // Function: what does this part DO?
    function: 'Transmit torque between shafts',
    function_criticality: 'critical|important|auxiliary',

    // Loads this part carries
    loads: {
      axial_force_n: 1000,
      radial_force_n: 500,
      bending_moment_nm: 50,
      torsional_torque_nm: 100,
      contact_pressure_mpa: 1200,
      operating_temperature_c: 85,
      max_temperature_c: 120,
      thermal_shock_cycles: 10000,
    },

    // Material condition & heat treatment
    heat_treatment: 'Q+T (quenched & tempered), HRC 38-42, AMS 6414',
    condition: 'as-drawn|annealed|stress-relieved|hardened',
    yield_strength_actual_mpa: 750,
    ultimate_strength_actual_mpa: 900,
    safety_factor_applied: 2.5,

    // Lubrication & environmental
    lubrication_type: 'SAE 10W-30|Polyrex EM|dry|PTFE dry-film|none',
    corrosion_environment: 'atmospheric|salt-spray|fuel-immersion|cryogenic',
    corrosion_protection: 'zinc-nickel 8μm|hot-dip galv|anodize III 25μm|none',

    // Sealing & contamination control
    sealing_required: false,
    seal_type: 'o-ring AS568|lip seal SKF|gasket|none',
    seal_fluid: 'oil|coolant|fuel|none',
    contamination_ingress_class: 'IP65|sealed|vented|open',
  },

  // MANUFACTURING SPECIFICATIONS
  manufacturing: {
    // Primary process
    primary_process: 'turning|milling|grinding|casting|forging|stamping|additive',
    stock_form: 'bar|billet|sheet|ingot|powder|wire',
    stock_size_mm: '50 × 50 × 100',
    material_utilization_percent: 65,
    estimated_machine_time_min: 45,
    estimated_cost_usd: 12.50,

    // Machining operations
    operations: [
      {
        sequence: 1,
        operation: 'Facing + rough bore turning',
        equipment: 'CNC lathe (12" chuck)',
        spindle_rpm: 800,
        feed_rate_mm_rev: 0.25,
        depth_of_cut_mm: 5,
        tool_material: 'carbide CNMG',
        tool_life_parts: 500,
      },
      {
        sequence: 2,
        operation: 'Finish honing bore',
        equipment: 'Horizontal honing machine',
        spindle_rpm: 600,
        stroke_length_mm: 150,
        hone_stone_grit: 600,
      },
    ],

    // Surface treatment
    surface_treatments: [
      {
        process: 'zinc-nickel plating',
        thickness_um: 8,
        specification: 'AMS 2415 (Type II, Class 1)',
        cost_per_part_usd: 2.10,
      },
      {
        process: 'passivation',
        duration_min: 15,
        temperature_c: 25,
      },
    ],

    // Quality control & inspection
    inspection_method: 'coordinate measurement machine (CMM)',
    first_piece_inspection: true,
    sample_rate_percent: 5,
    testing_required: ['tensile|hardness|fatigue|NDT'],

    // Assembly notes
    assembly_sequence_step: 3,
    assembly_notes: 'Press onto shaft with 50-ton press, monitor load.',
    fit_type: 'shrink-fit H7/p6',
    assembly_aids: 'thermal expansion (150°C heat housing), press jig P-4501',
  },

  // DIMENSIONAL CONTROL
  tolerances: {
    // ISO system
    bore_diameter_mm: '30 H7',
    bore_tolerance_mm: [30.0, 30.021],
    surface_finish_ra_um: 0.4,  // Ra (arithmetic average)
    surface_finish_rz_um: 1.6,  // Rz (peak-to-valley)

    // Critical tolerance stack
    tolerance_stack: {
      description: 'Center distance stack: bore to bore',
      items: [
        { dimension: 'Bore A center ±x', tolerance_mm: 0.05 },
        { dimension: 'Bore B center ±x', tolerance_mm: 0.05 },
        { dimension: 'Housing A bore position', tolerance_mm: 0.03 },
        { dimension: 'Housing B bore position', tolerance_mm: 0.03 },
      ],
      total_stack_worst_case_mm: 0.16,
      total_stack_rss_mm: 0.08,
      design_margin_mm: 0.04,  // clearance or interference allowed
    },

    // Profile & runout
    profile_tolerance_mm: 0.1,
    runout_tolerance_mm: 0.08,
    perpendicularity_tolerance_mm: 0.05,
  },

  // STANDARDS & TRACEABILITY
  standards: {
    designation: 'ISO 4762 M8×25, DIN 931, SAE J429',
    material_standard: 'ASTM A574, ISO 4762',
    process_standard: 'ISO 9001:2015, AS9100D',
    drawing_number: 'DWG-2024-001-A3',
    drawing_revision: 'B',
    revision_date: '2024-01-15',
    engineering_notes: 'Replace every 2 removals. Do not re-torque. Use Loctite 243 if vibration present.',
  },

  // FASTENER-SPECIFIC (if type = bolt/screw/nut/etc)
  fastener: {
    thread_designation: 'M8×1.25',
    thread_type: 'ISO metric|UNC|UNEF|Whitworth',
    length_mm: 25,
    head_type: 'hex|socket|pan|countersunk|flange',
    property_class: '8.8|10.9|12.9|A2-70|A4-80',
    installation_method: 'torque-to-spec|torque-angle|bolt-tension-indicator|snug-fit',
    torque_nm: 25,
    torque_spec: '25 N·m ± 10%, or 80 N·m + 90° + 90°',
    preload_kn: 12.5,
    prevailing_torque: false,
    locking_method: 'Loctite 243|deformed thread|lock washer|none',
  },

  // BEARING-SPECIFIC (if type = bearing)
  bearing: {
    designation: 'SKF 6205-2RS C3',
    bore_mm: 25,
    outer_diameter_mm: 52,
    width_mm: 15,
    type: 'deep_groove_ball|angular_contact_15|angular_contact_25|tapered_roller|needle|thrust',
    sealed: true,  // 2RS = sealed both sides
    preload_type: 'none|light|medium|heavy',
    grease_type: 'Polyrex EM|Kluber ISOFLEX NBU 15|Mobilgrease 28',
    relubrication_interval_hours: 5000,
    dynamic_load_rating_kn: 19.5,
    static_load_rating_kn: 13.3,
    speed_limit_rpm: 6000,
    operating_temperature_c: 80,
    shaft_fit: 'k5',  // ISO fit
    housing_fit: 'H7',
  },

  // GEAR-SPECIFIC (if type = gear)
  gear: {
    type: 'spur|helical|bevel|worm',
    module_mm: 2.5,
    pitch_diameter_mm: 50,
    number_of_teeth: 20,
    face_width_mm: 15,
    pressure_angle_deg: 20,
    helix_angle_deg: 0,  // helical gears only
    center_distance_mm: 75,
    backlash_nominal_mm: 0.065,
    backlash_tolerance_mm: [0.045, 0.11],
    gear_quality_grade: 'AGMA 9|AGMA 8|AGMA 7',
    surface_finish_tooth_flank_ra_um: 0.8,
    contact_stress_mpa: 1150,
    bending_stress_mpa: 450,
    safety_factor_contact: 1.3,
    safety_factor_bending: 1.5,
    material_housing: 'cast_iron_ductile',
    lubrication: 'immersion oil|circulation|grease',
  },

  // ELECTRICAL-SPECIFIC (if type = pcb/resistor/connector/etc)
  electrical: {
    voltage_rating_v: 48,
    current_rating_a: 5,
    power_dissipation_w: 10,
    temperature_rise_c: 15,
    insulation_resistance_mohm: 100,
    dielectric_breakdown_kv: 2.5,
    rms_voltage_rating: '24V RMS',
    connector_type: 'JST-XH|Molex MX-150|TE DT',
    wire_gauge_awg: 18,  // AWG 18 = 0.75 mm²
    wire_insulation: 'XLPE 105°C|PVC 80°C|silicone 200°C',
    wire_color: 'black|red|yellow|green|white|orange|blue',
    solder_alloy: 'SAC305|Sn63Pb37',
    ipc_j_std_001_class: 'II|III',
  },

  // WELD-SPECIFIC (if type = weld_*)
  weld: {
    process: 'GMAW|GTAW|SMAW|FCAW|SAW',
    filler_metal: 'ER70S-6|ER308L|E7018',
    fillet_size_mm: 6,
    fillet_throat_thickness_mm: 4.2,
    weld_length_mm: 180,
    weld_position: '1F|2F|3F|4F|1G|2G|3G|4G',  // flat, horizontal, vertical, overhead
    preheat_temperature_c: 0,
    interpass_temperature_max_c: 250,
    inspection_method: 'visual|magnetic particle (MT)|radiographic (RT)',
    filler_metal_per_unit_length_g_mm: 0.22,
  },

  // GENERAL NOTES & LINKS
  notes: 'Critical joint. Inspect after shipping. Replace if bent >0.5mm. See DWG-001 for context.',
  mating_parts: ['part_002', 'part_003'],  // IDs of parts this connects to
  dependent_edits: {
    // If this part is edited, which others must be recomputed?
    if_diameter_changes: ['part_003', 'part_004'],  // bearing bores, seals
    if_length_changes: ['part_002'],  // mating gear
    if_material_changes: [],  // none in this case
  },

  // EDIT METADATA
  edit_scope: 'part|subsystem|assembly',  // what level can this be edited?
  subsystem_id: 'pump_internals',  // which subsystem does it belong to?
  editable_fields: ['diameter', 'length', 'material', 'heat_treatment', 'surface_finish'],
  locked_fields: ['type'],  // cannot change type after creation
};

/**
 * Assembly-level schema
 */
export const ENHANCED_ASSEMBLY_SCHEMA = {
  assembly: true,
  name: 'Full descriptive name — key specs in title',
  description: 'Operating envelope, peak power/thrust/torque, mass, key performance parameters',
  revision: 'A',
  standard: 'ISO 9001:2015',
  total_mass_kg: 0.000,

  // Performance envelope
  performance: {
    operating_power_w: 1000,
    peak_torque_nm: 100,
    operating_temperature_c: 85,
    max_temperature_c: 120,
    efficiency_percent: 95,
    service_life_hours: 10000,
    duty_cycle: 'continuous|intermittent|emergency',
  },

  // SUBSYSTEMS
  subsystems: [
    {
      id: 'pump_internals',
      name: 'Centrifugal Pump — Internals',
      description: 'Impeller, housing, bearing package, seals',
      parts: ['part_001', 'part_002', 'part_003'],
      function: 'Move coolant at 50 GPM at 2 bar',
      criticality: 'critical',
      can_be_edited_as_unit: true,
      dependent_subsystems: ['pump_motor_coupling'],
    },
  ],

  // BOM with linked data
  bom: [
    {
      line_number: 1,
      part_id: 'part_001',
      nomenclature: 'ISO 4762 M8×25 10.9',
      quantity: 4,
      unit_cost_usd: 0.85,
      extended_cost_usd: 3.40,
      notes: 'Zinc-nickel plated',
    },
  ],

  // Manufacturing notes
  manufacturing: {
    total_machining_hours: 120,
    total_assembly_hours: 45,
    total_inspection_hours: 8,
    total_cost_usd: 1500,
    lead_time_days: 14,
    assembly_sequence: [
      { step: 1, description: 'Insert bearing dowel pins' },
      { step: 2, description: 'Install bearing package' },
      { step: 3, description: 'Torque bearing cap bolts (25 N·m)' },
    ],
  },

  // Simulation & validation
  simulation_data: {
    last_run_timestamp: '2024-01-15T10:30:00Z',
    von_mises_stress_mpa: 450,
    max_stress_location: 'bore corner radius',
    deflection_mm: 0.15,
    thermal_gradient_c: 45,
    validation_status: 'pass|fail|warning',
  },

  parts: [
    // ... array of ENHANCED_PART_SCHEMA objects
  ],

  // EDIT METADATA
  edit_history: [
    { timestamp: '2024-01-15T10:30:00Z', edit_type: 'parameter_change', field: 'impeller_diameter_mm', old_value: 50, new_value: 52, reason: 'Increase flow rate' },
  ],

  bom_notes: 'What IS modeled; what is NOT modeled; key manufacturing notes; critical tolerances',
};

/**
 * Dependency Tracker — tells us which parts must be recomputed when one changes
 */
export class EditDependencyTracker {
  constructor(assembly) {
    this.assembly = assembly;
    this.graph = this._buildDependencyGraph();
  }

  _buildDependencyGraph() {
    const graph = new Map();
    const parts = this.assembly.parts || [];
    parts.forEach((part) => {
      if (!graph.has(part.id)) graph.set(part.id, new Set());
      const deps = part.dependent_edits || {};
      if (deps.if_diameter_changes) deps.if_diameter_changes.forEach((id) => graph.get(part.id).add(id));
      if (deps.if_length_changes) deps.if_length_changes.forEach((id) => graph.get(part.id).add(id));
      if (deps.if_material_changes) deps.if_material_changes.forEach((id) => graph.get(part.id).add(id));
    });
    return graph;
  }

  /**
   * When user edits `partId` in field `fieldName`, what other parts need recomputation?
   */
  getAffectedParts(partId, fieldName) {
    const affected = new Set();
    const queue = [partId];
    const visited = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.graph.get(current) || new Set();
      deps.forEach((depId) => {
        affected.add(depId);
        queue.push(depId);  // transitive closure
      });
    }

    return Array.from(affected);
  }

  /**
   * Which parts depend on this subsystem?
   */
  getSubsystemDependents(subsystemId) {
    const subsystem = (this.assembly.subsystems || []).find((s) => s.id === subsystemId);
    if (!subsystem) return [];
    const parts = subsystem.parts || [];
    const affected = new Set();
    parts.forEach((partId) => {
      this.getAffectedParts(partId, '*').forEach((id) => affected.add(id));
    });
    return Array.from(affected);
  }
}

/**
 * Validation helper — ensure part meets engineering constraints
 */
export function validatePartAgainstConstraints(part, assembly) {
  const errors = [];
  const warnings = [];

  // Stress check
  if (part.engineering && part.engineering.loads) {
    const loads = part.engineering.loads;
    if (loads.contact_pressure_mpa && part.engineering.yield_strength_actual_mpa) {
      const ratio = loads.contact_pressure_mpa / part.engineering.yield_strength_actual_mpa;
      if (ratio > 0.8) warnings.push(`Stress ratio ${ratio.toFixed(2)} approaching yield`);
    }
  }

  // Tolerance stack
  if (part.tolerances && part.tolerances.tolerance_stack) {
    const stack = part.tolerances.tolerance_stack;
    if (stack.total_stack_worst_case_mm > stack.design_margin_mm) {
      errors.push(`Tolerance stack exceeds design margin: ${stack.total_stack_worst_case_mm.toFixed(3)} > ${stack.design_margin_mm.toFixed(3)} mm`);
    }
  }

  // Bearing speed check
  if (part.bearing && part.bearing.speed_limit_rpm) {
    const maxRpm = part.bearing.speed_limit_rpm;
    // Could check against assembly operating speed here
  }

  return { errors, warnings, isValid: errors.length === 0 };
}

export default {
  ENHANCED_PART_SCHEMA,
  ENHANCED_ASSEMBLY_SCHEMA,
  EditDependencyTracker,
  validatePartAgainstConstraints,
};

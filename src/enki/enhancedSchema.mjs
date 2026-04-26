/**
 * Enki V5 Enhanced Part & Assembly Schema
 * Complete manufacturing metadata, validation, and dependency tracking
 */

export const ENHANCED_PART_SCHEMA = {
  // ─── Core Identification ───
  id: 'string (snake_case, unique per assembly)',
  name: 'string (engineering name + standard designation)',
  type: 'string (part_type from whitelist)',
  assembly: 'boolean (true = this is a sub-assembly)',
  
  // ─── Geometry & Mass ───
  dims: '{ w, h, d, or custom dimensions } — all in mm',
  position: '[x, y, z] — geometric centroid in mm',
  rotation: '[rx, ry, rz] — Euler angles in degrees',
  color: '#rrggbb',
  mass_kg: 'number',
  quantity: 'integer (1 by default)',
  
  // ─── Material & Process ───
  material: 'exact material grade (e.g., "steel_4340", "aluminum_7075_t6")',
  surface_finish: 'Ra microns (e.g., "Ra 0.4 μm")',
  tolerance: 'ISO tolerance (e.g., "H7/k6")',
  
  // ─── Manufacturing Metadata ───
  standard: 'ISO/DIN/SAE designation',
  process: 'turning | milling | casting | welding | forging | extrusion | etc.',
  heat_treatment: 'full spec if applicable (e.g., "Q&T 42–48 HRC, AMS 6415")',
  coating: 'surface treatment (e.g., "hard anodize 25 μm", "zinc-nickel 8 μm")',
  
  // ─── Engineering Loads & Performance ───
  engineering_loads: {
    static_force_n: 'nominal',
    dynamic_force_n: 'peak',
    torque_nm: 'if rotating',
    thermal_min_c: 'minimum service temp',
    thermal_max_c: 'maximum service temp',
    pressure_max_bar: 'if pressurized',
  },
  
  // ─── Part-Specific Fields ───
  fastener_spec: '{ thread_spec: "M8×1.25", head_type: "hex", property_class: "8.8", torque_nm: 25 }',
  bearing_spec: '{ type: "ball", bore_mm: 30, od_mm: 62, width_mm: 16, load_rating_kn: 19.5, speed_rpm: 6000 }',
  gear_spec: '{ module: 3, num_teeth: 72, pitch_diameter: 216, helix_angle: 15, surface_finish: "Ra 0.8 μm", quality_grade: 6 }',
  weld_spec: '{ process: "GMAW", filler: "ER70S-6", fillet_size: 6, position: "1F" }',
  seal_spec: '{ type: "o_ring", as568_number: 234, compound: "Viton", pressure_max_bar: 10 }',
  
  // ─── Tolerances & Fit ───
  tolerance_stack: '[{ feature: "bearing_bore", value_mm: 0.03, cumulative_mm: 0.08 }]',
  fit_type: 'clearance | transition | interference',
  
  // ─── Design Margins ───
  safety_factor: 'computed or specified (target ≥ 1.5 for static)',
  fatigue_life_cycles: 'if cycling load',
  
  // ─── Documentation ───
  notes: 'engineering notes, material condition, assembly sequence, critical dimensions',
  
  // ─── Change Tracking ───
  revision: 'letter (A, B, C, ...)',
  mro: 'maintenance, repair, overhaul notes',
};

export const ENHANCED_ASSEMBLY_SCHEMA = {
  assembly: true,
  name: 'Full descriptive name',
  description: 'Operating envelope, performance specs, mass',
  revision: 'A',
  standard: 'ISO 9001:2015',
  total_mass_kg: 0.0,
  
  // ─── Subsystem Hierarchy ───
  subsystems: [
    {
      id: 'sub_001',
      name: 'Subsystem Name',
      description: 'Functional unit description',
      part_ids: ['part1', 'part2', 'part3'],
      mass_kg: 0.0,
      engineering_function: 'e.g., "power transmission, structure, sealing"',
    },
  ],
  
  // ─── All Parts ───
  parts: [
    // ... ENHANCED_PART_SCHEMA entries ...
  ],
  
  // ─── Bill of Materials ───
  bom: [
    { part_id: 'p001', name: 'Part Name', quantity: 4, unit_cost_usd: 12.50, total_cost_usd: 50.00 },
  ],
  
  // ─── Manufacturing Notes ───
  bom_notes: 'Completeness statement: what IS modeled; what is NOT; key manufacturing constraints',
  manufacturing_notes: 'assembly sequence, critical torques, rework procedures',
  assembly_sequence: [
    { step: 1, description: 'Install base plate', parts: ['base_001'] },
    { step: 2, description: 'Install bearings', parts: ['brg_001', 'brg_002'] },
  ],
  
  // ─── Simulation & Testing ───
  simulation_data: {
    fea_results: { max_stress_mpa: 450, max_deflection_mm: 0.5, safety_factor_min: 2.1 },
    thermal_results: { max_temp_c: 85, min_temp_c: -5 },
    physics_results: { natural_frequency_hz: 125.3 },
  },
};

/**
 * Edit Dependency Tracker
 * Tracks cascading effects: if part X changes, which parts must be recomputed?
 */
export class EditDependencyTracker {
  constructor(assembly = {}) {
    this.assembly = assembly;
    this.graph = this.buildDependencyGraph();
  }
  
  buildDependencyGraph() {
    const parts = Array.isArray(this.assembly.parts) ? this.assembly.parts : [];
    const graph = {}; // graph[partId] = Set of partIds that depend on it
    
    for (const part of parts) {
      if (!graph[part.id]) graph[part.id] = new Set();
      
      // Scan notes for mating references
      const notes = String(part.notes || '').toLowerCase();
      for (const other of parts) {
        if (other.id === part.id) continue;
        if (notes.includes(other.id) || notes.includes(other.name?.toLowerCase())) {
          graph[part.id].add(other.id);
        }
      }
      
      // Structural hierarchy: if part is in subsystem, other parts in same subsystem depend on it
      const subs = Array.isArray(this.assembly.subsystems) ? this.assembly.subsystems : [];
      for (const sub of subs) {
        if (Array.isArray(sub.part_ids) && sub.part_ids.includes(part.id)) {
          for (const otherId of sub.part_ids) {
            if (otherId !== part.id) {
              graph[part.id].add(otherId);
            }
          }
        }
      }
    }
    
    return graph;
  }
  
  /**
   * Get all parts affected by changing partId (transitive closure)
   */
  getAffectedParts(partId) {
    const visited = new Set();
    const queue = [partId];
    
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      
      const deps = this.graph[current] || new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          queue.push(dep);
        }
      }
    }
    
    visited.delete(partId); // don't include the changed part itself
    return Array.from(visited);
  }
}

/**
 * Validation against manufacturing constraints
 */
export function validatePartAgainstConstraints(part, constraints = {}) {
  const errors = [];
  const warnings = [];
  
  // Tolerance stack validation
  if (Array.isArray(part.tolerance_stack)) {
    const cumulative = part.tolerance_stack.reduce((sum, t) => sum + t.cumulative_mm, 0);
    if (cumulative > (constraints.max_stack_mm || 0.15)) {
      warnings.push(`Tolerance stack ${cumulative} mm exceeds typical max ${constraints.max_stack_mm || 0.15} mm — review fit strategy`);
    }
  }
  
  // Surface finish achievability
  if (part.surface_finish) {
    const ra_match = String(part.surface_finish).match(/Ra\s*([\d.]+)/i);
    if (ra_match) {
      const ra = parseFloat(ra_match[1]);
      if (part.process === 'casting' && ra < 3.2) {
        warnings.push(`Ra ${ra} μm unrealistic for casting process — typical ≥ 3.2 μm`);
      }
      if (part.process === 'turning' && ra < 0.4) {
        warnings.push(`Ra ${ra} μm may require superfinishing after grinding`);
      }
    }
  }
  
  // Bearing load rating check
  if (part.bearing_spec && part.engineering_loads) {
    const load = part.engineering_loads.static_force_n || 0;
    const rating = (part.bearing_spec.load_rating_kn || 0) * 1000;
    if (load > rating) {
      errors.push(`Dynamic load ${load} N exceeds bearing rating ${rating} N`);
    }
  }
  
  // Stress ratio check
  if (part.engineering_loads && part.material) {
    const stress = (part.engineering_loads.static_force_n || 0) / (part.dims?.area_mm2 || 1000);
    const yieldApprox = 300; // placeholder
    const ratio = stress / yieldApprox;
    if (ratio > 0.67) {
      warnings.push(`Stress ratio ${ratio.toFixed(2)} > 0.67 — recommend FEA validation`);
    }
  }
  
  return { errors, warnings, valid: errors.length === 0 };
}

/**
 * Edit history tracking
 */
export class EditHistory {
  constructor() {
    this.edits = [];
  }
  
  record(partId, changes) {
    this.edits.push({
      timestamp: new Date().toISOString(),
      partId,
      changes,
      revision: `rev_${this.edits.length + 1}`,
    });
  }
  
  getHistory() {
    return this.edits;
  }
  
  undo() {
    if (this.edits.length > 0) {
      return this.edits.pop();
    }
    return null;
  }
}

export const PART_TYPE_WHITELIST = [
  // Structural
  'plate', 'beam', 'bracket', 'housing', 'ibeam', 'strut', 'column', 'gusset', 'rib', 'web_plate', 'flange', 'dome', 'tank',
  // Rotary
  'gear', 'shaft', 'bearing', 'spring', 'turbine_disk', 'flywheel', 'impeller', 'pulley', 'sprocket', 'coupling',
  // Fluid
  'piston', 'nozzle', 'pipe_straight', 'pipe_elbow', 'pipe_tee', 'valve_body', 'orifice',
  // Fasteners
  'bolt_hex', 'nut_hex', 'washer', 'screw_socket', 'screw_pan', 'screw_countersunk', 'rivet', 'dowel_pin', 'roll_pin', 'snap_ring', 'circlip', 'parallel_key', 'woodruff_key', 'shim', 'stud', 'thread_insert',
  // Welds
  'weld_fillet', 'weld_butt', 'weld_spot', 'weld_plug',
  // Seals
  'o_ring', 'gasket', 'lip_seal', 'v_ring', 'back_up_ring',
  // Electrical
  'pcb', 'resistor', 'capacitor', 'inductor', 'ic_dip', 'ic_smd', 'connector_header', 'wire_segment', 'solder_joint', 'bus_bar', 'transformer', 'relay', 'fuse_holder', 'terminal_block', 'crystal', 'diode', 'transistor', 'led',
  // Thermal
  'heat_sink', 'heat_pipe', 'fin_array', 'tec_module',
  // Specialty
  'ablator', 'tile', 'mli_insulation', 'cable_tie', 'heat_shrink', 'foam_fill', 'label', 'handle',
];

export const MATERIAL_GRADES = [
  // Steels
  'steel', 'steel_1018', 'steel_4130', 'steel_4340', 'steel_17_4ph', 'stainless_304', 'stainless_316', 'stainless_316l', 'tool_steel_d2', 'tool_steel_h13', 'spring_steel', 'cast_iron', 'cast_iron_ductile',
  // Aluminums
  'aluminum', 'aluminum_2024_t3', 'aluminum_6061_t6', 'aluminum_7075_t6', 'aluminum_7050_t7451', 'aluminum_cast_a380',
  // Titaniums
  'titanium_cp2', 'titanium_6al4v', 'titanium_6al4v_eli',
  // High temp
  'inconel_625', 'inconel_718', 'hastelloy_c276', 'haynes_188', 'waspalloy', 'rene_80',
  // Non-ferrous
  'copper', 'copper_c110', 'copper_c17200', 'brass', 'bronze', 'magnesium_az31b',
  // Electronics
  'solder_sac305', 'solder_snpb63', 'copper_pcb', 'fr4', 'fr4_tg170',
  // Polymers
  'abs', 'nylon', 'nylon_pa66', 'peek', 'ptfe', 'pom_delrin', 'polycarbonate', 'silicone', 'nbr_rubber', 'viton', 'epoxy',
  // Composites
  'carbon_fiber', 'carbon_fiber_t800', 'cfrp_quasi_iso', 'fiberglass', 'nomex_honeycomb',
  // Specialty
  'pica_x', 'rcc', 'mli_insulation', 'aerogel', 'graphene_composite', 'solder', 'pcb_copper',
];

/**
 * ENKI GENERATION INTEGRATION
 * Ties LLM-generated assembly plans with manufacturing constraints & sim feedback
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ENHANCED_PART_SCHEMA, EditDependencyTracker, validatePartAgainstConstraints } from './enkiEnhancedSchema.mjs';
import { SimFeedbackAnalyzer, formatSuggestionsForEnki } from './simFeedbackEngine.mjs';

/**
 * Enrich LLM-generated assembly with manufacturing metadata
 * Fills in missing fields, validates tolerances, ensures all parts are REAL
 */
export function enrichAssemblyWithManufacturingData(assembly, materialDatabase) {
  if (!assembly || !assembly.parts) return assembly;

  const enriched = Object.assign({}, assembly);
  enriched.parts = assembly.parts.map((part, idx) => enrichPart(part, idx, materialDatabase));

  // Build subsystems if not present
  if (!enriched.subsystems) {
    enriched.subsystems = _inferSubsystems(enriched);
  }

  // Validate all parts against constraints
  enriched.validation_report = enriched.parts.map((part) => ({
    part_id: part.id,
    part_name: part.name,
    validation: validatePartAgainstConstraints(part, enriched),
  }));

  return enriched;
}

/**
 * Enrich a single part with manufacturing data
 */
export function enrichPart(part, idx, materialDatabase) {
  const p = Object.assign({}, part);

  // Ensure basic ID
  p.id = p.id || `part_${String(idx + 1).padStart(4, '0')}`;

  // Fill in material properties from database
  if (p.material && materialDatabase && materialDatabase[p.material]) {
    const matProps = materialDatabase[p.material];
    if (!p.engineering) p.engineering = {};
    if (!p.engineering.yield_strength_actual_mpa) {
      p.engineering.yield_strength_actual_mpa = matProps.yield_strength_mpa;
    }
    if (!p.engineering.ultimate_strength_actual_mpa) {
      p.engineering.ultimate_strength_actual_mpa = matProps.tensile_strength_mpa;
    }
    if (!p.mass_kg && p.dims && matProps.density_kg_m3) {
      p.mass_kg = _estimatePartMass(p.dims, matProps.density_kg_m3);
    }
  }

  // Infer manufacturing operations if not specified
  if (!p.manufacturing || !p.manufacturing.operations) {
    p.manufacturing = p.manufacturing || {};
    p.manufacturing.operations = _inferOperationsFromPartType(p.type, p.dims);
  }

  // Infer tolerances if not specified
  if (!p.tolerances) {
    p.tolerances = _inferTolerancesFromPartType(p.type, p.dims);
  }

  // Infer dependent edits (which parts are affected if this one changes)
  if (!p.dependent_edits) {
    p.dependent_edits = _inferDependentEditsFromType(p.type);
  }

  // Ensure engineering properties
  if (!p.engineering) p.engineering = {};
  if (!p.engineering.loads) {
    p.engineering.loads = _inferLoadsFromPartType(p.type);
  }

  return p;
}

/**
 * Estimate mass based on dimensions and material density
 */
function _estimatePartMass(dims, densityKgM3) {
  if (!dims) return 0;

  // Very rough estimate: assume cylindrical or rectangular prism
  let volumeM3 = 0;

  if (dims.diameter && dims.L) {
    // Cylinder
    const radiusM = (dims.diameter / 2) / 1000;
    const lengthM = dims.L / 1000;
    volumeM3 = Math.PI * radiusM * radiusM * lengthM;
  } else if (dims.w && dims.h && dims.d) {
    // Rectangular prism
    volumeM3 = (dims.w / 1000) * (dims.h / 1000) * (dims.d / 1000);
  }

  return volumeM3 * densityKgM3;
}

/**
 * Infer manufacturing operations based on part type
 */
function _inferOperationsFromPartType(type, dims) {
  const ops = [];

  if (type === 'shaft' || type === 'bolt_hex') {
    ops.push({
      sequence: 1,
      operation: 'Rough turning',
      equipment: 'CNC lathe',
      spindle_rpm: 1500,
      feed_rate_mm_rev: 0.3,
      depth_of_cut_mm: 3,
      tool_material: 'carbide',
    });
    ops.push({
      sequence: 2,
      operation: 'Finish turning',
      equipment: 'CNC lathe',
      spindle_rpm: 2500,
      feed_rate_mm_rev: 0.15,
      depth_of_cut_mm: 0.5,
      tool_material: 'carbide',
    });
  } else if (type === 'bearing') {
    ops.push({
      sequence: 1,
      operation: 'Precision bore',
      equipment: 'Horizontal boring mill',
      spindle_rpm: 800,
    });
  } else if (type === 'gear') {
    ops.push({
      sequence: 1,
      operation: 'Rough mill blank',
      equipment: 'CNC mill',
      spindle_rpm: 1200,
    });
    ops.push({
      sequence: 2,
      operation: 'Hobbing (gear teeth)',
      equipment: 'Gear hobber',
      spindle_rpm: 600,
    });
  } else if (type === 'bracket' || type === 'housing') {
    ops.push({
      sequence: 1,
      operation: 'Milling (all faces)',
      equipment: 'CNC mill',
      spindle_rpm: 2000,
    });
    ops.push({
      sequence: 2,
      operation: 'Drilling hole pattern',
      equipment: 'CNC drill',
      spindle_rpm: 3000,
    });
  }

  return ops;
}

/**
 * Infer tolerances based on part type and dimensions
 */
function _inferTolerancesFromPartType(type, dims) {
  const tolerances = {
    surface_finish_ra_um: 1.6,
    profile_tolerance_mm: 0.1,
    runout_tolerance_mm: 0.08,
    perpendicularity_tolerance_mm: 0.05,
    tolerance_stack: {
      description: 'Generic stack',
      items: [],
      total_stack_worst_case_mm: 0.1,
      total_stack_rss_mm: 0.05,
      design_margin_mm: 0.05,
    },
  };

  if (type === 'bearing' || type === 'shaft') {
    tolerances.surface_finish_ra_um = 0.4;  // tighter for bearing surfaces
    tolerances.bore_diameter_mm = 'H7';
    tolerances.tolerance_stack.design_margin_mm = 0.02;
  } else if (type === 'gear') {
    tolerances.surface_finish_ra_um = 0.8;
    tolerances.tolerance_stack.design_margin_mm = 0.03;
  } else if (type === 'bracket') {
    tolerances.surface_finish_ra_um = 3.2;  // looser for non-critical parts
    tolerances.tolerance_stack.design_margin_mm = 0.2;
  }

  return tolerances;
}

/**
 * Infer which parts are affected if this one is edited
 */
function _inferDependentEditsFromType(type) {
  // This will be overridden by real dependency tracking in the EditDependencyTracker
  // But provide sensible defaults

  const deps = {
    if_diameter_changes: [],
    if_length_changes: [],
    if_material_changes: [],
  };

  if (type === 'shaft') {
    deps.if_diameter_changes = [];  // typically finds its own bearings
    deps.if_length_changes = [];
  } else if (type === 'bearing') {
    deps.if_diameter_changes = [];  // affects shaft bore mating
  } else if (type === 'gear') {
    deps.if_diameter_changes = [];  // affects meshing gear, center distance
  }

  return deps;
}

/**
 * Infer typical loads for a part based on its type and context
 */
function _inferLoadsFromPartType(type) {
  const loads = {
    axial_force_n: 0,
    radial_force_n: 0,
    bending_moment_nm: 0,
    torsional_torque_nm: 0,
    contact_pressure_mpa: 0,
    operating_temperature_c: 85,
    max_temperature_c: 120,
    thermal_shock_cycles: 0,
  };

  if (type === 'shaft') {
    loads.torsional_torque_nm = 100;
    loads.radial_force_n = 500;
    loads.bending_moment_nm = 50;
  } else if (type === 'bearing') {
    loads.radial_force_n = 1000;
    loads.contact_pressure_mpa = 1200;
  } else if (type === 'gear') {
    loads.torsional_torque_nm = 100;
    loads.contact_pressure_mpa = 1500;
  } else if (type === 'bracket') {
    loads.bending_moment_nm = 20;
    loads.axial_force_n = 500;
  }

  return loads;
}

/**
 * Infer subsystems from part names and types
 */
function _inferSubsystems(assembly) {
  const subsystems = [];
  const byFunctionality = {};

  (assembly.parts || []).forEach((part) => {
    const name = String(part.name || '').toLowerCase();
    let category = 'general';

    if (/pump|impeller|volute/.test(name)) category = 'pump_assembly';
    else if (/motor|coil|winding/.test(name)) category = 'motor_assembly';
    else if (/bearing|journal|race/.test(name)) category = 'bearing_package';
    else if (/gear|pinion|wheel/.test(name)) category = 'gearbox';
    else if (/piston|rod|crank|valve/.test(name)) category = 'engine_internals';
    else if (/pcb|resistor|capacitor|ic/.test(name)) category = 'electronics';
    else if (/weld|gasket|seal|o.?ring/.test(name)) category = 'fastening_sealing';
    else if (/bolt|screw|nut|washer/.test(name)) category = 'fasteners';

    if (!byFunctionality[category]) {
      byFunctionality[category] = [];
    }
    byFunctionality[category].push(part.id);
  });

  Object.entries(byFunctionality).forEach(([category, partIds]) => {
    if (partIds.length > 0) {
      subsystems.push({
        id: category,
        name: _humanizeSubsystemName(category),
        description: `${category} subsystem`,
        parts: partIds,
        function: _describeSubsystemFunction(category),
        criticality: _inferCriticality(category),
        can_be_edited_as_unit: true,
        dependent_subsystems: [],
      });
    }
  });

  return subsystems;
}

function _humanizeSubsystemName(category) {
  const names = {
    pump_assembly: 'Pump Assembly',
    motor_assembly: 'Motor Assembly',
    bearing_package: 'Bearing Package',
    gearbox: 'Gearbox',
    engine_internals: 'Engine Internals',
    electronics: 'Electronics & PCB',
    fastening_sealing: 'Fastening & Sealing',
    fasteners: 'Fasteners',
    general: 'General Components',
  };
  return names[category] || category;
}

function _describeSubsystemFunction(category) {
  const funcs = {
    pump_assembly: 'Move fluid or gas',
    motor_assembly: 'Convert electrical energy to mechanical motion',
    bearing_package: 'Support rotating shafts with low friction',
    gearbox: 'Transmit and modify rotational speed/torque',
    engine_internals: 'Convert fuel energy to mechanical power',
    electronics: 'Process signals and control system behavior',
    fastening_sealing: 'Join and seal components',
    fasteners: 'Mechanically join parts',
  };
  return funcs[category] || 'General mechanical function';
}

function _inferCriticality(category) {
  const critical = ['engine_internals', 'bearing_package', 'pump_assembly', 'gearbox'];
  return critical.includes(category) ? 'critical' : 'important';
}

/**
 * Process sim results and generate Enki suggestions
 */
export function analyzeCycleAndGenerateSuggestions(assembly, simResults) {
  if (!simResults) {
    return {
      suggestions: [],
      issues: [],
      summary: { status: 'no_sim_data', message: 'No simulation results to analyze.' },
    };
  }

  const analyzer = new SimFeedbackAnalyzer(assembly, simResults);
  const result = analyzer.analyze();

  // Convert to Enki-friendly format
  return {
    suggestions: result.suggestions,
    issues: result.issues,
    summary: result.summary,
    narrative: formatSuggestionsForEnki(result.suggestions, result.issues),
  };
}

/**
 * Apply edit changes to assembly, recomputing affected parts
 */
export function applyEditToAssembly(assembly, editRequest) {
  const { selected_parts, edits, edit_mode } = editRequest;

  if (!Array.isArray(selected_parts) || !edits) {
    return { success: false, error: 'Invalid edit request' };
  }

  const edited = Object.assign({}, assembly);
  edited.parts = (assembly.parts || []).map((p) => {
    if (!selected_parts.includes(p.id)) {
      return p;
    }

    // Apply edits
    const updated = Object.assign({}, p);
    Object.entries(edits).forEach(([field, value]) => {
      // Handle nested properties
      if (field.includes('.')) {
        const [category, subfield] = field.split('.');
        if (!updated[category]) updated[category] = {};
        updated[category][subfield] = value;
      } else if (field === 'diameter' || field === 'length' || field === 'width' || field === 'height') {
        if (!updated.dims) updated.dims = {};
        updated.dims[field] = value;
      } else {
        updated[field] = value;
      }
    });

    return updated;
  });

  // Track edit history
  if (!edited.edit_history) edited.edit_history = [];
  edited.edit_history.push({
    timestamp: new Date().toISOString(),
    edit_mode,
    selected_parts,
    edits,
  });

  return {
    success: true,
    updated_assembly: edited,
    affected_parts: selected_parts,
    message: `${selected_parts.length} part(s) edited successfully.`,
  };
}

/**
 * Validate entire assembly for manufacturability
 */
export function validateAssemblyForManufacturability(assembly) {
  const issues = [];
  const warnings = [];

  (assembly.parts || []).forEach((part) => {
    const { errors, warnings: partWarnings } = validatePartAgainstConstraints(part, assembly);
    errors.forEach((err) => issues.push({ part_id: part.id, part_name: part.name, error: err }));
    partWarnings.forEach((warn) => warnings.push({ part_id: part.id, part_name: part.name, warning: warn }));
  });

  return {
    total_issues: issues.length,
    total_warnings: warnings.length,
    issues,
    warnings,
    status: issues.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARNING' : 'PASS',
  };
}

export default {
  enrichAssemblyWithManufacturingData,
  enrichPart,
  analyzeCycleAndGenerateSuggestions,
  applyEditToAssembly,
  validateAssemblyForManufacturability,
};

/**
 * Enki V5 Integration Pipeline
 * Enrichment, validation, edit application, and simulation analysis
 */

import { validatePartAgainstConstraints, EditDependencyTracker, MATERIAL_GRADES, PART_TYPE_WHITELIST } from './enhancedSchema.mjs';
import { SimFeedbackAnalyzer, formatSuggestionsForEnki } from './simFeedbackEngine.mjs';

/**
 * Material Property Database
 */
const MATERIAL_DATABASE = {
  steel_4340: {
    density_kg_m3: 7850,
    youngs_modulus_gpa: 200,
    yield_strength_mpa: 1650,
    tensile_strength_mpa: 1860,
    fatigue_limit_mpa: 750,
    thermal_conductivity_w_mk: 42,
    thermal_expansion_1_k: 1.2e-5,
    machinability_rating: 0.65,
    weldability_rating: 0.6,
    corrosion_resistance: 'moderate (needs coating)',
    cost_per_kg_usd: 8.50,
  },
  aluminum_7075_t6: {
    density_kg_m3: 2810,
    youngs_modulus_gpa: 71,
    yield_strength_mpa: 505,
    tensile_strength_mpa: 570,
    fatigue_limit_mpa: 160,
    thermal_conductivity_w_mk: 130,
    thermal_expansion_1_k: 2.3e-5,
    machinability_rating: 0.75,
    weldability_rating: 0.3,
    corrosion_resistance: 'moderate (anodize recommended)',
    cost_per_kg_usd: 15.00,
  },
  stainless_316l: {
    density_kg_m3: 8000,
    youngs_modulus_gpa: 193,
    yield_strength_mpa: 170,
    tensile_strength_mpa: 485,
    fatigue_limit_mpa: 250,
    thermal_conductivity_w_mk: 16,
    thermal_expansion_1_k: 1.6e-5,
    machinability_rating: 0.4,
    weldability_rating: 0.85,
    corrosion_resistance: 'excellent (marine/cryogenic)',
    cost_per_kg_usd: 18.00,
  },
  titanium_6al4v: {
    density_kg_m3: 4430,
    youngs_modulus_gpa: 103,
    yield_strength_mpa: 880,
    tensile_strength_mpa: 950,
    fatigue_limit_mpa: 580,
    thermal_conductivity_w_mk: 7.4,
    thermal_expansion_1_k: 8.6e-6,
    machinability_rating: 0.3,
    weldability_rating: 0.5,
    corrosion_resistance: 'excellent (biocompatible)',
    cost_per_kg_usd: 65.00,
  },
  carbon_fiber: {
    density_kg_m3: 1600,
    youngs_modulus_gpa_longitudinal: 230,
    youngs_modulus_gpa_transverse: 15,
    yield_strength_mpa_longitudinal: 3500,
    yield_strength_mpa_transverse: 60,
    thermal_conductivity_w_mk: 4.0,
    machinability_rating: 0.6,
    weldability_rating: 0.0,
    corrosion_resistance: 'excellent (non-metallic)',
    cost_per_kg_usd: 25.00,
    note: 'Anisotropic — strength depends on fiber orientation',
  },
};

/**
 * Enrich assembly with manufacturing data
 */
export function enrichAssemblyWithManufacturingData(assembly, materialDB = MATERIAL_DATABASE) {
  if (!assembly || !Array.isArray(assembly.parts)) {
    return assembly;
  }
  
  const enriched = JSON.parse(JSON.stringify(assembly));
  
  enriched.parts = enriched.parts.map(part => {
    const enrichedPart = { ...part };
    
    // ─── Add material properties ───
    if (enrichedPart.material && materialDB[enrichedPart.material]) {
      enrichedPart.material_properties = materialDB[enrichedPart.material];
    }
    
    // ─── Infer manufacturing operations ───
    enrichedPart.estimated_mass_kg = estimateMass(enrichedPart, materialDB);
    enrichedPart.estimated_operations = inferOperationsFromPartType(enrichedPart.type, enrichedPart.material);
    
    // ─── Generate ISO tolerances if not specified ───
    if (!enrichedPart.tolerance) {
      enrichedPart.tolerance = inferToleranceFromPartType(enrichedPart.type);
    }
    
    // ─── Infer engineering loads from part type ───
    if (!enrichedPart.engineering_loads) {
      enrichedPart.engineering_loads = inferLoadsFromPartType(enrichedPart.type, enrichedPart.material);
    }
    
    // ─── Add cost estimate ───
    enrichedPart.estimated_cost_usd = estimateCost(enrichedPart, materialDB);
    
    return enrichedPart;
  });
  
  // Update BOM
  enriched.total_mass_kg = enriched.parts.reduce((sum, p) => sum + (p.estimated_mass_kg || p.mass_kg || 0), 0);
  enriched.estimated_assembly_cost_usd = enriched.parts.reduce((sum, p) => sum + (p.estimated_cost_usd || 0), 0);
  
  return enriched;
}

/**
 * Estimate part mass from geometry
 */
function estimateMass(part, materialDB) {
  if (part.mass_kg) return part.mass_kg;
  
  const density = (materialDB[part.material]?.density_kg_m3 || 2700) / 1e6; // convert to kg/mm³
  const dims = part.dims || {};
  
  let volume_mm3 = 0;
  if (dims.w && dims.h && dims.d) {
    volume_mm3 = dims.w * dims.h * dims.d * 0.5; // approximate solid fill
  } else if (dims.diameter && dims.length) {
    volume_mm3 = Math.PI * (dims.diameter / 2) ** 2 * dims.length * 0.6; // shaft/tube
  }
  
  return volume_mm3 * density;
}

/**
 * Infer manufacturing operations from part type
 */
function inferOperationsFromPartType(type, material) {
  const ops = [];
  
  if (['shaft', 'bearing', 'gear'].includes(type)) {
    ops.push('turning', 'grinding', 'inspection');
  }
  if (['plate', 'bracket', 'housing'].includes(type)) {
    ops.push('milling', 'drilling', 'finishing');
  }
  if (type.includes('weld')) {
    ops.push('welding', 'visual_inspection', 'mpi');
  }
  if (['gear'].includes(type)) {
    ops.push('hobbing', 'shaving', 'grinding');
  }
  
  // Add heat treatment if needed
  if (['steel_4340', 'steel_4130'].includes(material)) {
    ops.push('heat_treatment');
  }
  
  // Add coating
  if (['aluminum_7075_t6', 'aluminum_6061_t6'].includes(material)) {
    ops.push('anodize');
  }
  
  return ops;
}

/**
 * Infer ISO tolerance from part type
 */
function inferToleranceFromPartType(type) {
  if (['bearing', 'shaft'].includes(type)) return 'H7/k6';
  if (['gear'].includes(type)) return 'H7/h6';
  if (['bracket', 'plate'].includes(type)) return 'IT10';
  return 'IT11';
}

/**
 * Infer engineering loads from part type
 */
function inferLoadsFromPartType(type, material) {
  const loads = {};
  
  if (['shaft', 'bearing', 'gear'].includes(type)) {
    loads.static_force_n = 500;
    loads.dynamic_force_n = 1000;
    loads.torque_nm = 50;
  }
  
  if (material?.includes('thermal')) {
    loads.thermal_min_c = -40;
    loads.thermal_max_c = 85;
  }
  
  return loads;
}

/**
 * Estimate cost
 */
function estimateCost(part, materialDB) {
  const mass = part.estimated_mass_kg || part.mass_kg || 0.1;
  const matCost = materialDB[part.material]?.cost_per_kg_usd || 10;
  const matCostTotal = mass * matCost;
  const machiningCost = part.estimated_operations?.length * 25 || 50;
  
  return matCostTotal + machiningCost;
}

/**
 * Validate assembly for manufacturability
 */
export function validateAssemblyForManufacturability(assembly) {
  const report = {
    status: 'PASS',
    parts_validated: 0,
    errors: [],
    warnings: [],
  };
  
  if (!Array.isArray(assembly.parts)) {
    return report;
  }
  
  for (const part of assembly.parts) {
    const validation = validatePartAgainstConstraints(part);
    report.parts_validated++;
    
    if (validation.errors.length > 0) {
      report.status = 'FAIL';
      report.errors.push(...validation.errors.map(e => `${part.name || part.id}: ${e}`));
    }
    
    report.warnings.push(...validation.warnings.map(w => `${part.name || part.id}: ${w}`));
  }
  
  return report;
}

/**
 * Apply edit to assembly and track dependencies
 */
export function applyEditToAssembly(assembly, editRequest) {
  const { partId, changes } = editRequest;
  
  const edited = JSON.parse(JSON.stringify(assembly));
  const part = edited.parts?.find(p => p.id === partId);
  
  if (!part) {
    throw new Error(`Part ${partId} not found`);
  }
  
  // Apply changes
  Object.assign(part, changes);
  
  // Re-enrich affected parts
  const tracker = new EditDependencyTracker(edited);
  const affectedIds = tracker.getAffectedParts(partId);
  
  for (const affId of affectedIds) {
    const affPart = edited.parts.find(p => p.id === affId);
    if (affPart) {
      affPart.needs_recompute = true;
    }
  }
  
  return {
    assembly: edited,
    affected_parts: affectedIds,
    edit_id: `edit_${Date.now()}`,
  };
}

/**
 * Analyze simulation cycle and generate suggestions for Enki
 */
export function analyzeCycleAndGenerateSuggestions(assembly, simResults) {
  const analyzer = new SimFeedbackAnalyzer(assembly, simResults);
  const feedback = analyzer.analyze();
  
  return {
    status: feedback.summary.status,
    narrative: feedback.narrative,
    suggestions: formatSuggestionsForEnki(feedback),
    raw_feedback: feedback,
  };
}

export { MATERIAL_DATABASE };

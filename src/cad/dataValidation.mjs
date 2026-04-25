/**
 * Data validation tier: schema enforcement, bill of materials generation, and design rule checking (DRC).
 * Ensures data integrity and generates manufacturing documentation.
 */

const partSchema = {
  id: { type: 'string', required: true, min_length: 1 },
  name: { type: 'string', required: false },
  type: { type: 'string', required: true },
  kind: { type: 'string', required: false },
  material: { type: 'string', required: true },
  process: { type: 'string', required: true },
  dims: {
    type: 'object',
    required: true,
    properties: {
      x: { type: 'number', required: true, min: 0.1 },
      y: { type: 'number', required: true, min: 0.1 },
      z: { type: 'number', required: true, min: 0.1 },
    },
  },
  position: { type: 'array', required: false, length: 3 },
  quantity: { type: 'number', required: false, min: 1 },
};

const assemblySchema = {
  id: { type: 'string', required: true },
  name: { type: 'string', required: false },
  parts: { type: 'array', required: true, min_length: 1 },
  interfaces: { type: 'array', required: false },
  units: { type: 'string', required: false, enum: ['mm', 'in', 'cm'] },
};

function validateAgainstSchema(obj, schema) {
  const errors = [];
  
  for (const [field, constraint] of Object.entries(schema)) {
    const value = obj[field];
    
    if (constraint.required && (value === undefined || value === null)) {
      errors.push(`${field}: required field missing`);
      continue;
    }
    
    if (value === undefined || value === null) continue;
    
    if (constraint.type === 'string' && typeof value !== 'string') {
      errors.push(`${field}: must be string, got ${typeof value}`);
    }
    if (constraint.type === 'number' && typeof value !== 'number') {
      errors.push(`${field}: must be number, got ${typeof value}`);
    }
    if (constraint.type === 'array' && !Array.isArray(value)) {
      errors.push(`${field}: must be array, got ${typeof value}`);
    }
    if (constraint.type === 'object' && typeof value !== 'object') {
      errors.push(`${field}: must be object, got ${typeof value}`);
    }
    
    if (constraint.min && value < constraint.min) {
      errors.push(`${field}: must be >= ${constraint.min}, got ${value}`);
    }
    if (constraint.min_length && String(value).length < constraint.min_length) {
      errors.push(`${field}: must have length >= ${constraint.min_length}`);
    }
    if (constraint.enum && !constraint.enum.includes(value)) {
      errors.push(`${field}: must be one of [${constraint.enum.join(', ')}], got ${value}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

export function validatePlan(plan = {}) {
  const errors = [];
  const warnings = [];
  
  const assemblyValidation = validateAgainstSchema(plan, assemblySchema);
  errors.push(...assemblyValidation.errors);
  
  if (Array.isArray(plan.parts)) {
    for (let i = 0; i < plan.parts.length; i++) {
      const partValidation = validateAgainstSchema(plan.parts[i], partSchema);
      partValidation.errors.forEach((err) => {
        errors.push(`parts[${i}]: ${err}`);
      });
    }
  }
  
  if (plan.parts?.length < 1) warnings.push('Assembly has no parts');
  if (plan.parts?.length > 500) warnings.push('Assembly is very large (>500 parts), may impact performance');
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function generateBillOfMaterials(plan = {}, options = {}) {
  const parts = plan.parts || [];
  
  // Aggregate by material and process
  const aggregated = {};
  for (const part of parts) {
    const key = `${part.material}|${part.process}`;
    if (!aggregated[key]) {
      aggregated[key] = {
        material: part.material || 'unknown',
        process: part.process || 'unknown',
        quantity: 0,
        parts: [],
      };
    }
    aggregated[key].quantity += part.quantity || 1;
    aggregated[key].parts.push(part.id || 'unnamed');
  }
  
  const bom = Object.values(aggregated).map((row, idx) => ({
    line_item: idx + 1,
    material: row.material,
    process: row.process,
    quantity: row.quantity,
    unit: 'pcs',
    part_ids: row.parts,
    description: `${row.material} ${row.process} components`,
  }));
  
  const totalQty = bom.reduce((sum, row) => sum + row.quantity, 0);
  const uniqueMaterials = new Set(bom.map((r) => r.material)).size;
  const uniqueProcesses = new Set(bom.map((r) => r.process)).size;
  
  return {
    generated_at: new Date().toISOString(),
    bom: bom,
    summary: {
      total_line_items: bom.length,
      total_quantity: totalQty,
      unique_materials: uniqueMaterials,
      unique_processes: uniqueProcesses,
      part_count: parts.length,
    },
  };
}

export function runDesignRuleChecks(plan = {}, rules = {}) {
  const parts = plan.parts || [];
  const violations = [];
  const warnings = [];
  const passed = [];
  
  // Rule 1: Minimum feature size
  const minFeatureRules = rules.min_feature_mm || { cnc: 0.5, '3d_print': 0.4, casting: 1.5 };
  for (const part of parts) {
    const process = part.process || 'cnc';
    const limit = minFeatureRules[process] || 0.5;
    const minDim = Math.min(part.dims?.x || limit, part.dims?.y || limit, part.dims?.z || limit);
    if (minDim < limit) {
      violations.push({
        rule: 'min_feature_size',
        part_id: part.id || 'unknown',
        message: `Minimum dimension ${minDim}mm violates ${process} limit of ${limit}mm`,
        severity: 'error',
      });
    }
  }
  
  // Rule 2: Wall thickness
  const minWallThickness = rules.min_wall_thickness_mm || 0.8;
  for (const part of parts) {
    if (part.wall_thickness && part.wall_thickness < minWallThickness) {
      warnings.push({
        rule: 'wall_thickness',
        part_id: part.id || 'unknown',
        message: `Wall thickness ${part.wall_thickness}mm is below recommended ${minWallThickness}mm`,
        severity: 'warning',
      });
    }
  }
  
  // Rule 3: Material-process compatibility
  const incompatible = {
    titanium: ['3d_print'],
    copper: ['injection_molding'],
  };
  for (const part of parts) {
    const material = part.material || 'steel';
    const process = part.process || 'cnc';
    if (incompatible[material]?.includes(process)) {
      violations.push({
        rule: 'material_process_compatibility',
        part_id: part.id || 'unknown',
        message: `${material} is not compatible with ${process}`,
        severity: 'error',
      });
    }
  }
  
  // Rule 4: Quantity reasonableness
  for (const part of parts) {
    const qty = part.quantity || 1;
    if (qty < 1 || qty > 10000) {
      warnings.push({
        rule: 'quantity_check',
        part_id: part.id || 'unknown',
        message: `Unusual quantity ${qty}; verify intentionality`,
        severity: 'warning',
      });
    }
  }
  
  if (violations.length === 0 && warnings.length === 0) {
    passed.push({ rule: 'all_checks', message: 'All design rules passed', severity: 'info' });
  }
  
  return {
    drc_report: {
      timestamp: new Date().toISOString(),
      violations,
      warnings,
      passed,
    },
    summary: {
      error_count: violations.length,
      warning_count: warnings.length,
      pass_count: passed.length,
      drc_status: violations.length === 0 ? 'PASS' : 'FAIL',
    },
  };
}

export function generateManufacturingDocumentation(plan = {}) {
  const parts = plan.parts || [];
  
  const docs = {
    part_list: parts.map((p, idx) => ({
      index: idx + 1,
      id: p.id || `part-${idx}`,
      name: p.name || `Part ${idx + 1}`,
      material: p.material,
      process: p.process,
      dimensions: p.dims,
      quantity: p.quantity || 1,
    })),
    bom: generateBillOfMaterials(plan),
    drc_report: runDesignRuleChecks(plan),
  };
  
  return {
    documentation: docs,
    export_formats: ['json', 'csv', 'xlsx', 'pdf'],
    generated_at: new Date().toISOString(),
  };
}

export function validateAndNormalize(plan = {}) {
  const validation = validatePlan(plan);
  
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }
  
  const normalized = {
    ...plan,
    parts: (plan.parts || []).map((p) => ({
      ...p,
      quantity: Math.max(1, Number(p.quantity || 1)),
      position: Array.isArray(p.position) ? p.position : [0, 0, 0],
    })),
  };
  
  return {
    success: true,
    plan: normalized,
    warnings: validation.warnings,
  };
}

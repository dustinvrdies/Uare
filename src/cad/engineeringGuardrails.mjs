function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositive(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value, 0) * factor) / factor;
}

function unitScale(unit = 'mm') {
  switch (String(unit || 'mm').toLowerCase()) {
    case 'mm':
      return 1;
    case 'cm':
      return 10;
    case 'm':
      return 1000;
    case 'in':
    case 'inch':
    case 'inches':
      return 25.4;
    case 'ft':
    case 'foot':
    case 'feet':
      return 304.8;
    default:
      return 1;
  }
}

function normalizeDims(rawDims = {}, scale = 1) {
  const dims = {};
  for (const [key, value] of Object.entries(rawDims || {})) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    dims[key] = round(numeric * scale, 4);
  }
  return dims;
}

function inferEnvelope(dims = {}) {
  const x = toPositive(dims.x ?? dims.length ?? dims.width ?? dims.outer_diameter ?? dims.diameter ?? dims.ctc, 50);
  const y = toPositive(dims.y ?? dims.width ?? dims.depth ?? dims.outer_diameter ?? dims.diameter ?? dims.thickness, 50);
  const z = toPositive(dims.z ?? dims.height ?? dims.length ?? dims.depth ?? dims.thickness, 20);
  return { x, y, z };
}

function getPositionVector(part = {}, scale = 1) {
  if (Array.isArray(part?.position)) {
    return [
      toNumber(part.position[0], 0) * scale,
      toNumber(part.position[1], 0) * scale,
      toNumber(part.position[2], 0) * scale,
    ];
  }
  const tr = (part?.transform_mm && typeof part.transform_mm === 'object') ? part.transform_mm : {};
  return [
    toNumber(tr.x, 0) * scale,
    toNumber(tr.y, 0) * scale,
    toNumber(tr.z, 0) * scale,
  ];
}

function makeAabb(part = {}) {
  const pos = getPositionVector(part, 1);
  const dims = inferEnvelope(part.dims || part.dimensions_mm || {});
  const px = toNumber(pos[0], 0);
  const py = toNumber(pos[1], 0);
  const pz = toNumber(pos[2], 0);
  return {
    min: [px - dims.x / 2, py - dims.y / 2, pz - dims.z / 2],
    max: [px + dims.x / 2, py + dims.y / 2, pz + dims.z / 2],
  };
}

function intersects(a, b) {
  return !(
    a.max[0] <= b.min[0] || a.min[0] >= b.max[0]
    || a.max[1] <= b.min[1] || a.min[1] >= b.max[1]
    || a.max[2] <= b.min[2] || a.min[2] >= b.max[2]
  );
}

function axisIndex(axis = 'x') {
  const value = String(axis || 'x').toLowerCase();
  if (value === 'y') return 1;
  if (value === 'z') return 2;
  return 0;
}

function overlapAmount(minA, maxA, minB, maxB) {
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function normalizeMaterial(material = '') {
  const value = String(material || '').trim().toLowerCase();
  if (!value) return 'steel';
  if (value.includes('aluminum') || value.includes('aluminium') || value.includes('6061')) return 'aluminum_6061';
  if (value.includes('stainless')) return 'stainless_steel';
  if (value.includes('steel')) return 'steel';
  if (value.includes('titanium')) return 'titanium';
  if (value.includes('fr4') || value.includes('pcb')) return 'fr4';
  if (value === 'pla') return 'pla';
  if (value === 'abs') return 'abs';
  if (value.includes('nylon') || value.includes('pa')) return 'nylon';
  return value;
}

function getMaterialProps(material = 'steel') {
  const table = {
    aluminum_6061: { density_g_cm3: 2.7, yield_mpa: 276, cost_usd_per_kg: 5.8 },
    steel: { density_g_cm3: 7.85, yield_mpa: 250, cost_usd_per_kg: 1.6 },
    stainless_steel: { density_g_cm3: 8.0, yield_mpa: 290, cost_usd_per_kg: 4.2 },
    titanium: { density_g_cm3: 4.5, yield_mpa: 830, cost_usd_per_kg: 35.0 },
    fr4: { density_g_cm3: 1.85, yield_mpa: 120, cost_usd_per_kg: 8.5 },
    pla: { density_g_cm3: 1.24, yield_mpa: 60, cost_usd_per_kg: 18.0 },
    abs: { density_g_cm3: 1.05, yield_mpa: 45, cost_usd_per_kg: 16.0 },
    nylon: { density_g_cm3: 1.14, yield_mpa: 70, cost_usd_per_kg: 24.0 },
  };
  return table[normalizeMaterial(material)] || { density_g_cm3: 2.7, yield_mpa: 180, cost_usd_per_kg: 6.0 };
}

function normalizeProcess(process = '') {
  const value = String(process || '').trim().toLowerCase();
  if (!value) return 'cnc';
  if (value.includes('print')) return '3d_print';
  if (value.includes('sheet')) return 'sheet_metal';
  if (value.includes('cast')) return 'casting';
  if (value.includes('mold')) return 'injection_molding';
  if (value.includes('pcb')) return 'pcb_fab';
  if (value.includes('laser')) return 'laser_cut';
  return value;
}

function processConstraints(process = 'cnc') {
  const table = {
    cnc: { min_feature_mm: 0.5, min_wall_mm: 0.8, setup_usd: 45, mm3_per_min: 18000 },
    '3d_print': { min_feature_mm: 0.4, min_wall_mm: 0.8, setup_usd: 8, mm3_per_min: 9000 },
    sheet_metal: { min_feature_mm: 0.7, min_wall_mm: 0.6, setup_usd: 30, mm3_per_min: 25000 },
    casting: { min_feature_mm: 1.5, min_wall_mm: 2.0, setup_usd: 120, mm3_per_min: 40000 },
    injection_molding: { min_feature_mm: 0.5, min_wall_mm: 1.2, setup_usd: 180, mm3_per_min: 50000 },
    pcb_fab: { min_feature_mm: 0.15, min_wall_mm: 0.15, setup_usd: 20, mm3_per_min: 100000 },
    laser_cut: { min_feature_mm: 0.25, min_wall_mm: 0.5, setup_usd: 25, mm3_per_min: 30000 },
  };
  return table[process] || table.cnc;
}

function materialProcessCompatibility(material = 'steel', process = 'cnc') {
  const normalizedMaterial = normalizeMaterial(material);
  const normalizedProcess = normalizeProcess(process);
  const allow = {
    aluminum_6061: ['cnc', 'casting', 'sheet_metal', 'laser_cut'],
    steel: ['cnc', 'casting', 'sheet_metal', 'laser_cut'],
    stainless_steel: ['cnc', 'casting', 'sheet_metal', 'laser_cut'],
    titanium: ['cnc'],
    fr4: ['pcb_fab', 'laser_cut'],
    pla: ['3d_print', 'injection_molding'],
    abs: ['3d_print', 'injection_molding'],
    nylon: ['3d_print', 'injection_molding', 'cnc'],
  };
  const options = allow[normalizedMaterial] || ['cnc'];
  return {
    compatible: options.includes(normalizedProcess),
    suggested_processes: options,
  };
}

function inferPartFamily(part = {}) {
  const shape = String(part.type || part.shape || '').toLowerCase();
  if (['shaft', 'pin', 'dowel_pin', 'axle', 'roller'].includes(shape)) return 'shaft_like';
  if (['plate', 'washer', 'disc', 'clutch_disc'].includes(shape)) return 'plate_like';
  if (['bracket', 'housing', 'box', 'engine_block', 'cylinder_head'].includes(shape)) return 'structural_block';
  if (String(part.kind || '').toLowerCase().includes('electrical')) return 'electrical_component';
  return 'generic';
}

function computeStrengthProxy(part = {}, dims = {}, material = {}) {
  const x = toPositive(dims.x, 1);
  const y = toPositive(dims.y, 1);
  const z = toPositive(dims.z, 1);
  const longest = Math.max(x, y, z);
  const shortest = Math.max(Math.min(x, y, z), 0.01);
  const slenderness = longest / shortest;
  const materialStrength = toPositive(material.yield_mpa, 120);
  const family = inferPartFamily(part);
  const familyFactor = family === 'shaft_like'
    ? 0.95
    : family === 'plate_like'
      ? 0.9
      : family === 'structural_block'
        ? 1.0
        : family === 'electrical_component'
          ? 0.7
          : 0.85;

  const score = Math.max(0, Math.min(100,
    (materialStrength / 10) * familyFactor - Math.max(0, slenderness - 8) * 3,
  ));

  return {
    part_family: family,
    slenderness_ratio: round(slenderness, 4),
    material_yield_mpa: round(materialStrength, 2),
    strength_score: round(score, 2),
  };
}

function analyzeInterference(parts = []) {
  const matrix = [];
  for (let i = 0; i < parts.length; i += 1) {
    const a = parts[i];
    const aBox = makeAabb(a);
    for (let j = i + 1; j < parts.length; j += 1) {
      const b = parts[j];
      const bBox = makeAabb(b);
      const ox = overlapAmount(aBox.min[0], aBox.max[0], bBox.min[0], bBox.max[0]);
      const oy = overlapAmount(aBox.min[1], aBox.max[1], bBox.min[1], bBox.max[1]);
      const oz = overlapAmount(aBox.min[2], aBox.max[2], bBox.min[2], bBox.max[2]);
      const volume = round(ox * oy * oz, 4);
      matrix.push({
        a: a.id || `part-${i}`,
        b: b.id || `part-${j}`,
        intersects: volume > 0,
        overlap_mm: { x: round(ox, 4), y: round(oy, 4), z: round(oz, 4) },
        overlap_volume_mm3: volume,
      });
    }
  }
  return matrix;
}

function analyzeToleranceStackup(parts = [], interfaces = []) {
  const fitLibrary = {
    'h7/g6': { target_clearance_mm: 0.015, tolerance_a_mm: 0.01, tolerance_b_mm: 0.01, fit_class: 'transition' },
    'h7/f7': { target_clearance_mm: 0.03, tolerance_a_mm: 0.015, tolerance_b_mm: 0.015, fit_class: 'clearance' },
    'h8/f7': { target_clearance_mm: 0.05, tolerance_a_mm: 0.02, tolerance_b_mm: 0.02, fit_class: 'clearance' },
    'h7/p6': { target_clearance_mm: -0.02, tolerance_a_mm: 0.01, tolerance_b_mm: 0.01, fit_class: 'interference' },
    'locational_clearance': { target_clearance_mm: 0.1, tolerance_a_mm: 0.03, tolerance_b_mm: 0.03, fit_class: 'clearance' },
    'locational_transition': { target_clearance_mm: 0.0, tolerance_a_mm: 0.02, tolerance_b_mm: 0.02, fit_class: 'transition' },
  };

  const map = new Map(parts.map((part, index) => [String(part.id || `part-${index}`), part]));
  const results = [];

  for (const iface of interfaces || []) {
    const idA = String(iface?.part_a || iface?.a || '');
    const idB = String(iface?.part_b || iface?.b || '');
    const partA = map.get(idA);
    const partB = map.get(idB);
    if (!partA || !partB) {
      results.push({ id: iface?.id || null, valid: false, reason: 'unknown_parts' });
      continue;
    }

    const axis = axisIndex(iface?.axis || 'x');
    const boxA = makeAabb(partA);
    const boxB = makeAabb(partB);
    const centerA = (boxA.min[axis] + boxA.max[axis]) / 2;
    const centerB = (boxB.min[axis] + boxB.max[axis]) / 2;
    const halfA = (boxA.max[axis] - boxA.min[axis]) / 2;
    const halfB = (boxB.max[axis] - boxB.min[axis]) / 2;
    const availableClearance = Math.abs(centerB - centerA) - (halfA + halfB);
    const fitCode = String(iface?.fit_code || iface?.fit || '').toLowerCase();
    const fitDefaults = fitLibrary[fitCode] || null;
    const tolA = Math.max(0, toNumber(iface?.tolerance_a_mm, fitDefaults?.tolerance_a_mm ?? 0));
    const tolB = Math.max(0, toNumber(iface?.tolerance_b_mm, fitDefaults?.tolerance_b_mm ?? 0));
    const worstCaseClearance = availableClearance - (tolA + tolB);
    const target = toNumber(iface?.target_clearance_mm, fitDefaults?.target_clearance_mm ?? 0);
    const valid = worstCaseClearance >= target;

    results.push({
      id: iface?.id || `${idA}-${idB}-${axis}`,
      type: iface?.type || 'clearance',
      fit_code: fitCode || null,
      fit_class: fitDefaults?.fit_class || String(iface?.type || 'clearance').toLowerCase(),
      axis: ['x', 'y', 'z'][axis],
      part_a: idA,
      part_b: idB,
      available_clearance_mm: round(availableClearance, 4),
      worst_case_clearance_mm: round(worstCaseClearance, 4),
      target_clearance_mm: round(target, 4),
      valid,
      tolerance_budget_mm: round(tolA + tolB, 4),
    });
  }

  return results;
}

function analyzePartEngineering(part = {}, defaultProcess = 'cnc') {
  const dims = inferEnvelope(part.dims || part.dimensions_mm || {});
  const process = normalizeProcess(part.process || defaultProcess);
  const processSpec = processConstraints(process);
  const materialKey = normalizeMaterial(part.material || 'steel');
  const material = getMaterialProps(materialKey);
  const compatibility = materialProcessCompatibility(materialKey, process);

  const minFeature = Math.min(dims.x, dims.y, dims.z);
  const processOk = minFeature >= processSpec.min_feature_mm;
  const wallOk = minFeature >= processSpec.min_wall_mm;
  const volumeMm3 = dims.x * dims.y * dims.z;
  const fillFactor = String(part.kind || '').toLowerCase().includes('electrical') ? 0.35 : 0.62;
  const effectiveVolumeMm3 = volumeMm3 * fillFactor;
  const massKg = (effectiveVolumeMm3 / 1000) * material.density_g_cm3 / 1000;
  const strength = computeStrengthProxy(part, dims, material);

  const machineMinutes = Math.max(0.3, effectiveVolumeMm3 / processSpec.mm3_per_min);
  const machineRatePerMinute = process === 'cnc' ? 1.2 : process === '3d_print' ? 0.4 : 0.9;
  const manufacturingCost = processSpec.setup_usd + machineMinutes * machineRatePerMinute + massKg * material.cost_usd_per_kg;

  return {
    part_id: part.id || null,
    process,
    material: materialKey,
    dimensions_mm: { x: round(dims.x, 4), y: round(dims.y, 4), z: round(dims.z, 4) },
    min_feature_mm: round(minFeature, 4),
    process_min_feature_mm: processSpec.min_feature_mm,
    process_min_wall_mm: processSpec.min_wall_mm,
    process_checks: {
      min_feature_ok: processOk,
      wall_ok: wallOk,
    },
    compatibility,
    estimated_volume_mm3: round(effectiveVolumeMm3, 3),
    estimated_mass_kg: round(massKg, 6),
    estimated_cost_usd: round(manufacturingCost, 4),
    strength_proxy: strength,
  };
}

function aggregateMassProperties(partAnalytics = [], parts = []) {
  const partMap = new Map(parts.map((part, index) => [String(part.id || `part-${index}`), part]));
  let totalMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = 0;
  for (const row of partAnalytics) {
    const mass = toPositive(row.estimated_mass_kg, 0);
    const part = partMap.get(String(row.part_id || ''));
    const pos = getPositionVector(part, 1);
    totalMass += mass;
    weightedX += mass * toNumber(pos[0], 0);
    weightedY += mass * toNumber(pos[1], 0);
    weightedZ += mass * toNumber(pos[2], 0);
  }
  return {
    total_mass_kg: round(totalMass, 6),
    center_of_mass_mm: totalMass > 0
      ? { x: round(weightedX / totalMass, 4), y: round(weightedY / totalMass, 4), z: round(weightedZ / totalMass, 4) }
      : { x: 0, y: 0, z: 0 },
  };
}

export function applyEngineeringGuardrails(plan = {}) {
  const basePlan = plan && typeof plan === 'object' ? { ...plan } : {};
  const warnings = [];
  const critical = [];
  const globalUnit = String(basePlan.units || basePlan.unit || 'mm');

  const parts = Array.isArray(basePlan.parts) ? basePlan.parts : [];
  const normalizedParts = parts.map((part, index) => {
    const safePart = part && typeof part === 'object' ? { ...part } : {};
    const partUnit = String(safePart.unit || safePart.units || globalUnit);
    const scale = unitScale(partUnit);
    const normalized = normalizeDims(safePart.dims || safePart.dimensions_mm || {}, scale);

    const envelope = inferEnvelope(normalized);
    const maxDim = Math.max(envelope.x, envelope.y, envelope.z);
    const minDim = Math.min(envelope.x, envelope.y, envelope.z);

    if (maxDim > 10000) {
      critical.push({ type: 'dimension_out_of_bounds', part_index: index, part_id: safePart.id || null, max_dimension_mm: maxDim });
    } else if (maxDim > 3000) {
      warnings.push({ type: 'very_large_dimension', part_index: index, part_id: safePart.id || null, max_dimension_mm: maxDim });
    }

    if (minDim < 0.1) {
      warnings.push({ type: 'thin_feature_risk', part_index: index, part_id: safePart.id || null, min_dimension_mm: minDim });
    }

    const position = getPositionVector(safePart, scale);
    return {
      ...safePart,
      dims: normalized,
      dimensions_mm: normalized,
      units: 'mm',
      unit: 'mm',
      position,
      transform_mm: {
        x: toNumber(position[0], 0),
        y: toNumber(position[1], 0),
        z: toNumber(position[2], 0),
      },
    };
  });

  const interferenceMatrix = analyzeInterference(normalizedParts);
  const collisions = interferenceMatrix.filter((entry) => entry.intersects);

  if (collisions.length > 0) {
    warnings.push({ type: 'part_overlap_detected', count: collisions.length });
    if (collisions.length > Math.max(1, Math.floor(normalizedParts.length / 2))) {
      critical.push({ type: 'severe_interference', count: collisions.length });
    }
  }

  const recipe = basePlan.recipe && typeof basePlan.recipe === 'object' ? { ...basePlan.recipe } : null;
  const params = recipe && recipe.parameters && typeof recipe.parameters === 'object' ? { ...recipe.parameters } : {};
  const recipeScale = unitScale(String(params.unit || params.units || globalUnit));
  const normalizedParams = normalizeDims(params, recipeScale);
  if (Object.keys(normalizedParams).length > 0) {
    normalizedParams.units = 'mm';
  }

  const defaultProcess = normalizeProcess(normalizedParams.process || basePlan?.process || 'cnc');
  const partAnalytics = normalizedParts.map((part) => analyzePartEngineering(part, defaultProcess));
  for (const row of partAnalytics) {
    if (!row.process_checks.min_feature_ok || !row.process_checks.wall_ok) {
      warnings.push({
        type: 'process_min_feature_violation',
        part_id: row.part_id,
        process: row.process,
        min_feature_mm: row.min_feature_mm,
        required_min_feature_mm: row.process_min_feature_mm,
      });
    }
    if (!row.compatibility.compatible) {
      critical.push({
        type: 'material_process_incompatible',
        part_id: row.part_id,
        material: row.material,
        process: row.process,
        suggested_processes: row.compatibility.suggested_processes,
      });
    }
    if (row.strength_proxy.strength_score < 35) {
      warnings.push({
        type: 'low_strength_proxy',
        part_id: row.part_id,
        strength_score: row.strength_proxy.strength_score,
        slenderness_ratio: row.strength_proxy.slenderness_ratio,
      });
    }
  }

  const toleranceStackup = analyzeToleranceStackup(normalizedParts, basePlan.interfaces || basePlan.mates || []);
  const failedInterfaces = toleranceStackup.filter((entry) => entry.valid === false);
  if (failedInterfaces.length > 0) {
    critical.push({ type: 'tolerance_stackup_failure', count: failedInterfaces.length });
  }

  const massProperties = aggregateMassProperties(partAnalytics, normalizedParts);
  const estimatedCostUsd = round(partAnalytics.reduce((sum, row) => sum + toNumber(row.estimated_cost_usd, 0), 0), 4);
  const averageStrengthScore = partAnalytics.length
    ? round(partAnalytics.reduce((sum, row) => sum + toNumber(row.strength_proxy?.strength_score, 0), 0) / partAnalytics.length, 3)
    : 0;

  const severity = critical.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'ok';
  let manufacturabilityScore = 100;
  manufacturabilityScore -= critical.length * 25;
  manufacturabilityScore -= warnings.length * 8;
  manufacturabilityScore -= Math.max(0, collisions.length - 1) * 1.5;
  manufacturabilityScore -= Math.max(0, failedInterfaces.length) * 4;
  manufacturabilityScore = Math.max(0, Math.min(100, manufacturabilityScore));

  const normalizedPlan = {
    ...basePlan,
    units: 'mm',
    unit: 'mm',
    parts: normalizedParts,
    recipe: recipe
      ? {
          ...recipe,
          parameters: {
            ...params,
            ...normalizedParams,
          },
        }
      : basePlan.recipe,
  };

  return {
    normalizedPlan,
    report: {
      severity,
      warnings,
      critical,
      collision_pairs: collisions,
      interference_matrix: interferenceMatrix,
      tolerance_stackup: toleranceStackup,
      manufacturability_score: manufacturabilityScore,
      part_count: normalizedParts.length,
      analysis: {
        process: defaultProcess,
        estimated_cost_usd: estimatedCostUsd,
        mass_properties: massProperties,
        average_strength_score: averageStrengthScore,
        part_metrics: partAnalytics,
      },
      unit_normalization: {
        input_unit: globalUnit,
        output_unit: 'mm',
      },
    },
  };
}

export function synthesizeAutoRepairPlan(plan = {}, report = {}) {
  function clonePlan(input = {}) {
    return JSON.parse(JSON.stringify(input || {}));
  }

  function scoreReport(localReport = {}) {
    const criticalCount = Array.isArray(localReport?.critical) ? localReport.critical.length : 0;
    const warningCount = Array.isArray(localReport?.warnings) ? localReport.warnings.length : 0;
    const manufacturability = toNumber(localReport?.manufacturability_score, 0);
    return manufacturability - (criticalCount * 100) - (warningCount * 5);
  }

  function repairMaterialProcess(inputPlan, localReport) {
    const candidate = clonePlan(inputPlan);
    const fixes = [];
    for (const issue of localReport?.critical || []) {
      if (issue?.type !== 'material_process_incompatible') continue;
      const target = (candidate.parts || []).find((part) => String(part?.id || '') === String(issue.part_id || ''));
      if (!target) continue;
      const nextProcess = Array.isArray(issue.suggested_processes) ? issue.suggested_processes[0] : null;
      if (!nextProcess) continue;
      const fromProcess = target.process || null;
      target.process = nextProcess;
      fixes.push({ type: 'process_swap_for_material_compatibility', part_id: target.id || null, from_process: fromProcess, to_process: nextProcess });
    }
    return { repairedPlan: candidate, fixes };
  }

  function repairTolerancesAndSpacing(inputPlan, localReport) {
    const candidate = clonePlan(inputPlan);
    const fixes = [];

    const interfaces = Array.isArray(candidate.interfaces)
      ? candidate.interfaces
      : Array.isArray(candidate.mates)
        ? candidate.mates
        : [];
    if (interfaces.length) {
      for (const iface of interfaces) {
        const previous = toNumber(iface?.target_clearance_mm, 0);
        iface.target_clearance_mm = Math.max(previous, 0.2);
      }
      fixes.push({ type: 'relaxed_clearance_targets', count: interfaces.length, min_target_clearance_mm: 0.2 });
    }

    const partsById = new Map((candidate.parts || []).map((part, index) => [String(part.id || `part-${index}`), part]));
    for (const overlap of localReport?.collision_pairs || []) {
      const moving = partsById.get(String(overlap?.b || ''));
      if (!moving) continue;
      const shift = toPositive(overlap?.overlap_mm?.x, 0) + 0.5;
      if (!Array.isArray(moving.position)) moving.position = [0, 0, 0];
      moving.position[0] = toNumber(moving.position[0], 0) + shift;
      fixes.push({ type: 'deoverlap_shift_x', part_id: moving.id || null, shift_mm: round(shift, 4) });
    }

    return { repairedPlan: candidate, fixes };
  }

  function repairMinFeatures(inputPlan, localReport) {
    const candidate = clonePlan(inputPlan);
    const fixes = [];
    const partsById = new Map((candidate.parts || []).map((part, index) => [String(part.id || `part-${index}`), part]));
    for (const issue of localReport?.warnings || []) {
      if (issue?.type !== 'process_min_feature_violation') continue;
      const target = partsById.get(String(issue.part_id || ''));
      if (!target) continue;
      const dims = target.dims || target.dimensions_mm || {};
      const minRequired = Math.max(toNumber(issue.required_min_feature_mm, 0.5), 0.5);
      for (const key of Object.keys(dims)) {
        if (!Number.isFinite(Number(dims[key]))) continue;
        if (Number(dims[key]) < minRequired) dims[key] = minRequired;
      }
      target.dims = dims;
      fixes.push({ type: 'raised_min_features', part_id: target.id || null, min_dimension_mm: minRequired });
    }
    return { repairedPlan: candidate, fixes };
  }

  const basePlan = plan && typeof plan === 'object' ? plan : {};
  const strategies = [
    { name: 'material_process_repair', fn: repairMaterialProcess },
    { name: 'tolerance_and_spacing_repair', fn: repairTolerancesAndSpacing },
    { name: 'feature_floor_repair', fn: repairMinFeatures },
  ];

  const candidates = [];
  for (const strategy of strategies) {
    const out = strategy.fn(basePlan, report || {});
    const evaluated = applyEngineeringGuardrails(out.repairedPlan || basePlan);
    candidates.push({
      strategy: strategy.name,
      repaired_plan: out.repairedPlan,
      applied_fixes: out.fixes || [],
      report: evaluated.report,
      score: scoreReport(evaluated.report),
    });
  }

  const ranked = candidates.sort((a, b) => b.score - a.score);
  const best = ranked[0] || {
    repaired_plan: clonePlan(basePlan),
    applied_fixes: [],
    report: report || {},
    score: scoreReport(report || {}),
    strategy: 'none',
  };

  const rerunHints = {
    recommended: (best.applied_fixes || []).length > 0,
    reason: (best.applied_fixes || []).length > 0
      ? 'auto_repair_candidate_available'
      : 'manual_intervention_required',
    guidance: (best.applied_fixes || []).length > 0
      ? 'Rerun CAD execution with returned repaired_plan or set allow_auto_repair=true.'
      : 'Review critical guardrails and provide engineering_override_token only if intentionally bypassing constraints.',
  };

  return {
    repaired_plan: best.repaired_plan,
    applied_fixes: best.applied_fixes,
    selected_strategy: best.strategy,
    selected_report: best.report,
    candidate_repairs: ranked.map((candidate) => ({
      strategy: candidate.strategy,
      score: candidate.score,
      manufacturability_score: candidate.report?.manufacturability_score,
      severity: candidate.report?.severity,
      fix_count: Array.isArray(candidate.applied_fixes) ? candidate.applied_fixes.length : 0,
    })),
    rerun_hints: rerunHints,
  };
}

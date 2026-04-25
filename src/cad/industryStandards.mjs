/**
 * Industry Standards Module
 * Implements ISO, DFM, DFA, and tolerance stack-up per ANSI/ASME Y14.5
 * Production-grade engineering standards compliance
 */

// ─── ISO 286 Tolerance Classes ───────────────────────────────────────
const IsoToleranceClasses = {
  IT01: 0.3, IT0: 0.5, IT1: 0.8, IT2: 1.2, IT3: 2, IT4: 3.2,
  IT5: 5.2, IT6: 8.4, IT7: 13.5, IT8: 22, IT9: 36, IT10: 58,
  IT11: 95, IT12: 150, IT13: 250, IT14: 400, IT15: 650, IT16: 1000,
};

const FundamentalDeviations = {
  // Holes (lowercase letters)
  a: (dn) => -270 - 1.6 * dn,
  b: (dn) => -140 - 0.85 * dn,
  c: (dn) => -50 - 0.8 * dn,
  d: (dn) => -20 - 0.4 * dn,
  e: (dn) => -11 - 0.4 * dn,
  f: (dn) => -5.5 - 0.25 * dn,
  g: (dn) => -2.5 - 0.4 * dn,
  h: (dn) => 0,
  js: (dn, it) => -it / 2,
  k: (dn, it) => it / 2,
  m: (dn, it) => it / 2 + 0.4 * Math.sqrt(dn),
  n: (dn, it) => it / 2 + 0.8 * Math.sqrt(dn),
  p: (dn, it) => it / 2 + 1.2 * Math.sqrt(dn),
  r: (dn, it) => it / 2 + 1.6 * Math.sqrt(dn),
  s: (dn, it) => it / 2 + 2.0 * Math.sqrt(dn),
  t: (dn, it) => it / 2 + 2.4 * Math.sqrt(dn),
  u: (dn, it) => it / 2 + 2.8 * Math.sqrt(dn),
  v: (dn, it) => it / 2 + 3.2 * Math.sqrt(dn),
  x: (dn, it) => it / 2 + 4.0 * Math.sqrt(dn),
  y: (dn, it) => it / 2 + 4.8 * Math.sqrt(dn),
  z: (dn, it) => it / 2 + 5.6 * Math.sqrt(dn),
};

// ─── DFM (Design for Manufacturability) Rules ───────────────────────
export function evaluateDfm(part = {}) {
  const warnings = [];
  const passes = [];
  
  const dims = part.dims || {};
  const material = String(part.material || '').toLowerCase();
  const process = String(part.process || '').toLowerCase();
  
  // Rule 1: Minimum feature size
  const minFeatures = {
    cnc: 0.5, '3d_print': 0.4, casting: 1.5, injection_molding: 0.8, 
    stamping: 0.3, welding: 1.0, forging: 2.0,
  };
  
  const minDim = Math.min(dims.x || 100, dims.y || 100, dims.z || 100);
  const processMin = minFeatures[process] || 0.5;
  if (minDim < processMin) {
    warnings.push({
      rule: 'min_feature_size',
      severity: 'critical',
      message: `Minimum dimension ${minDim}mm violates ${process} limit of ${processMin}mm`,
      recommended_action: 'increase_part_size_or_change_process',
    });
  } else {
    passes.push({ rule: 'min_feature_size', status: 'pass' });
  }
  
  // Rule 2: Wall thickness
  const minWallThickness = process === 'injection_molding' ? 1.2 : 0.8;
  if (part.wall_thickness && part.wall_thickness < minWallThickness) {
    warnings.push({
      rule: 'wall_thickness',
      severity: 'warning',
      message: `Wall thickness ${part.wall_thickness}mm below recommended ${minWallThickness}mm`,
      recommended_action: 'increase_wall_thickness',
    });
  } else {
    passes.push({ rule: 'wall_thickness', status: 'pass' });
  }
  
  // Rule 3: Aspect ratio
  const maxAspectRatio = process === '3d_print' ? 8 : process === 'injection_molding' ? 4 : 10;
  const maxDim = Math.max(dims.x || 1, dims.y || 1, dims.z || 1);
  const minDimAspect = Math.min(dims.x || 1, dims.y || 1, dims.z || 1);
  const aspectRatio = maxDim / Math.max(minDimAspect, 0.1);
  if (aspectRatio > maxAspectRatio) {
    warnings.push({
      rule: 'aspect_ratio',
      severity: 'warning',
      message: `Aspect ratio ${aspectRatio.toFixed(2)} exceeds recommended ${maxAspectRatio} for ${process}`,
      recommended_action: 'add_reinforcing_ribs_or_split_geometry',
    });
  } else {
    passes.push({ rule: 'aspect_ratio', status: 'pass' });
  }
  
  // Rule 4: Draft angle (for molding/casting)
  if (['injection_molding', 'casting', 'forging'].includes(process)) {
    if (!part.draft_angle || part.draft_angle < 1) {
      warnings.push({
        rule: 'draft_angle',
        severity: 'warning',
        message: `Draft angle should be minimum 1-2° for ${process}`,
        recommended_action: 'add_draft_to_vertical_surfaces',
      });
    } else {
      passes.push({ rule: 'draft_angle', status: 'pass' });
    }
  }
  
  // Rule 5: Hole-to-edge distance
  if (Array.isArray(part.holes)) {
    for (const hole of part.holes) {
      const minDistance = 1.5 * (hole.diameter || 5);
      if ((hole.edge_distance || 0) < minDistance) {
        warnings.push({
          rule: 'hole_edge_distance',
          severity: 'warning',
          message: `Hole too close to edge (${hole.edge_distance}mm vs minimum ${minDistance}mm)`,
          recommended_action: 'move_hole_away_from_edge',
        });
      }
    }
  }
  
  return { warnings, passes, dfm_score: passes.length / (passes.length + warnings.length) };
}

// ─── DFA (Design for Assembly) Rules ──────────────────────────────
export function evaluateDfa(assembly = {}) {
  const warnings = [];
  const passes = [];
  
  const parts = Array.isArray(assembly.parts) ? assembly.parts : [];
  const interfaces = Array.isArray(assembly.interfaces) ? assembly.interfaces : [];
  
  // Rule 1: Part count rationalization
  if (parts.length > 50) {
    warnings.push({
      rule: 'part_count',
      severity: 'warning',
      message: `Large part count (${parts.length}) increases assembly complexity and cost`,
      target: parts.length,
      recommended_max: 30,
      recommended_action: 'consolidate_parts_or_use_subassemblies',
    });
  } else {
    passes.push({ rule: 'part_count', status: 'pass' });
  }
  
  // Rule 2: Interface types (favor snap, minimize fasteners)
  const fastenerCount = interfaces.filter((i) => i.type === 'bolted' || i.type === 'threaded').length;
  if (fastenerCount > parts.length * 0.3) {
    warnings.push({
      rule: 'fastener_ratio',
      severity: 'warning',
      message: `High fastener ratio (${fastenerCount}/${parts.length}). Consider snap fits or welding.`,
      recommended_action: 'replace_fasteners_with_snap_or_press_fits',
    });
  } else {
    passes.push({ rule: 'fastener_ratio', status: 'pass' });
  }
  
  // Rule 3: Accessibility
  for (const intf of interfaces) {
    if (intf.type === 'bolted' && !intf.accessible) {
      warnings.push({
        rule: 'fastener_accessibility',
        severity: 'warning',
        message: `Fastener ${intf.id} not easily accessible for assembly/maintenance`,
        recommended_action: 'redesign_to_improve_access_or_use_alternative_joint',
      });
    }
  }
  
  // Rule 4: Symmetry and orientation
  const asymmetricParts = parts.filter((p) => !p.symmetric_feature || p.orientation_time_s > 3);
  if (asymmetricParts.length > parts.length * 0.2) {
    warnings.push({
      rule: 'part_symmetry',
      severity: 'info',
      message: `Multiple asymmetric parts may slow assembly. Consider design symmetry.`,
      recommended_action: 'add_alignment_features_or_increase_symmetry',
    });
  }
  
  passes.push({ rule: 'design_for_assembly', status: 'evaluated' });
  
  return { warnings, passes, dfa_score: passes.length / (passes.length + Math.max(warnings.length, 1)) };
}

// ─── ANSI/ASME Y14.5 Tolerancing ─────────────────────────────────
export function analyzeToleranceStackup(chain = []) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { valid: false, error: 'Invalid tolerance chain' };
  }
  
  // Worst-case stackup
  let worstCaseAccumulated = 0;
  let rssAccumulated = 0;
  
  for (const link of chain) {
    const tol = Number(link.tolerance_mm || 0);
    worstCaseAccumulated += tol;
    rssAccumulated += tol * tol;
  }
  
  rssAccumulated = Math.sqrt(rssAccumulated);
  
  return {
    chain_length: chain.length,
    worst_case_stackup_mm: worstCaseAccumulated,
    root_sum_square_mm: rssAccumulated,
    recommended: rssAccumulated, // RSS typically used for cost optimization
    chain_elements: chain.map((link) => ({
      dimension_mm: link.dimension_mm,
      tolerance_mm: link.tolerance_mm,
      tolerance_class: link.tolerance_class || 'unspecified',
    })),
  };
}

// ─── Fit Analysis (ISO 286) ──────────────────────────────────────
export function analyzeFit(hole = {}, shaft = {}) {
  const holeBasic = hole.basic_size_mm || 10;
  const shaftBasic = shaft.basic_size_mm || 10;
  
  if (holeBasic !== shaftBasic) {
    return { valid: false, error: 'Hole and shaft basic sizes must match for standard fits' };
  }
  
  const nominalSize = holeBasic;
  const holeIt = IsoToleranceClasses[hole.tolerance_class || 'IT7'] || 13.5;
  const shaftIt = IsoToleranceClasses[shaft.tolerance_class || 'IT7'] || 13.5;
  
  const holeFd = FundamentalDeviations[hole.fundamental_deviation || 'h'];
  const shaftFd = FundamentalDeviations[shaft.fundamental_deviation || 'h'];
  
  const holeMin = nominalSize + (holeFd ? holeFd(nominalSize) : 0);
  const holeMax = holeMin + holeIt;
  const shaftMin = nominalSize + (shaftFd ? shaftFd(nominalSize) : 0);
  const shaftMax = shaftMin + shaftIt;
  
  const maxClearance = holeMax - shaftMin;
  const minClearance = holeMin - shaftMax;
  const maxInterference = shaftMax - holeMin;
  
  let fitType = 'clearance';
  if (minClearance < 0) fitType = 'transition';
  if (maxClearance < 0) fitType = 'interference';
  
  return {
    nominal_size_mm: nominalSize,
    fit_type: fitType,
    hole: { min: holeMin, max: holeMax, tolerance_class: hole.tolerance_class || 'IT7' },
    shaft: { min: shaftMin, max: shaftMax, tolerance_class: shaft.tolerance_class || 'IT7' },
    clearance_range: { min: minClearance, max: maxClearance },
    interference_range: { min: 0, max: maxInterference },
  };
}

// ─── Surface Finish (ISO 1302) ──────────────────────────────────
const SurfaceFinishGrades = {
  N1: 0.025, N2: 0.05, N3: 0.1, N4: 0.2, N5: 0.4, N6: 0.8, N7: 1.6,
  N8: 3.2, N9: 6.3, N10: 12.5, N11: 25, N12: 50,
};

export function recommendSurfaceFinish(part = {}, contactType = 'friction') {
  const material = String(part.material || '').toLowerCase();
  const process = String(part.process || '').toLowerCase();
  
  const finishRecommendations = {
    friction: 'N6', // 0.8μm Ra
    bearing: 'N5',  // 0.4μm Ra
    seal: 'N5',
    optical: 'N2', // 0.05μm Ra
    thermal: 'N7',
    aesthetic: 'N4',
  };
  
  const grade = finishRecommendations[contactType] || 'N6';
  
  return {
    contact_type: contactType,
    recommended_grade: grade,
    roughness_ra_um: SurfaceFinishGrades[grade],
    material: material,
    process: process,
    typical_processes: {
      N2: 'polishing, lapping',
      N4: 'grinding',
      N6: 'boring, turning, planing',
      N8: 'milling, sawing',
      N10: 'casting, forging',
    },
  };
}

// ─── Material Selection per standards ────────────────────────────
export function evaluateMaterialStandards(part = {}) {
  const material = String(part.material || '').toLowerCase();
  const process = String(part.process || '').toLowerCase();
  
  const materialStandards = {
    aluminum_6061: { spec: 'ASTM B221', properties: { yield_mpa: 275, tensile_mpa: 310 }, recyclable: true },
    steel: { spec: 'ASTM A36', properties: { yield_mpa: 250, tensile_mpa: 400 }, recyclable: true },
    titanium: { spec: 'ASTM B348', properties: { yield_mpa: 880, tensile_mpa: 950 }, recyclable: true },
    stainless_304: { spec: 'ASTM A276', properties: { yield_mpa: 205, tensile_mpa: 515 }, recyclable: true },
    copper: { spec: 'ASTM B36', properties: { yield_mpa: 70, tensile_mpa: 200 }, recyclable: true },
    brass: { spec: 'ASTM B36', properties: { yield_mpa: 150, tensile_mpa: 300 }, recyclable: true },
    plastic: { spec: 'ASTM D4169', properties: {}, recyclable: true },
    nylon: { spec: 'ASTM D4169', properties: { tensile_mpa: 65 }, recyclable: true },
  };
  
  const std = materialStandards[material] || { spec: 'custom', recyclable: true };
  
  return {
    material: material,
    standard: std.spec,
    properties: std.properties || {},
    recyclable: std.recyclable || false,
    oem_certified: false,
    compliance_check: 'verify_with_supplier',
  };
}

// ─── Environmental/Regulatory Compliance ─────────────────────────
export function evaluateCompliance(assembly = {}, region = 'global') {
  const regulations = {
    global: ['RoHS 3', 'REACH'],
    us: ['FDA', 'FCC'],
    eu: ['CE marking', 'ATEX'],
    china: ['CCC', 'CNAS'],
    asia: ['KC', 'VCCI'],
  };
  
  const applicableRegs = regulations[region] || regulations.global;
  
  return {
    region,
    applicable_standards: applicableRegs,
    material_compliance: assembly.parts?.map((p) => ({
      part_id: p.id,
      material: p.material,
      rohs_compliant: !['lead', 'cadmium', 'mercury'].some((s) => String(p.material).includes(s)),
      reach_compliant: true, // Assume compliant unless known otherwise
    })),
    required_documentation: ['test_reports', 'material_certs', 'assembly_docs', 'safety_analysis'],
  };
}

// ─── Cost & Manufacturing Leadtime Estimate ──────────────────────
export function estimateManufacturingCost(part = {}, volume = 1000) {
  const material = String(part.material || '').toLowerCase();
  const process = String(part.process || '').toLowerCase();
  
  // Approximate material costs ($/kg)
  const materialCosts = {
    steel: 0.5,
    aluminum_6061: 2,
    titanium: 15,
    copper: 8,
    plastic: 1.5,
    nylon: 2,
  };
  
  // Approximate setup + hourly process costs
  const processCosts = {
    cnc: { setup: 200, hourly: 150 },
    '3d_print': { setup: 50, hourly: 50 },
    casting: { setup: 1000, hourly: 80 },
    injection_molding: { setup: 3000, hourly: 30 },
    stamping: { setup: 5000, hourly: 20 },
    welding: { setup: 100, hourly: 60 },
  };
  
  const matCost = (materialCosts[material] || 1) * (part.mass_kg || 0.5);
  const procCost = processCosts[process] || { setup: 100, hourly: 100 };
  const unitCost = matCost + (procCost.setup / volume) + (procCost.hourly * 0.5); // Est 0.5 hr per part
  
  return {
    material_cost_usd: matCost.toFixed(2),
    process_cost_per_unit_usd: ((procCost.setup / volume) + (procCost.hourly * 0.5)).toFixed(2),
    total_cost_per_unit_usd: unitCost.toFixed(2),
    volume: volume,
    estimated_leadtime_weeks: volume > 10000 ? 8 : volume > 1000 ? 4 : 2,
  };
}

// ─── Assembly-Level Quality Metrics ──────────────────────────────
export function calculateQualityMetrics(assembly = {}) {
  const parts = Array.isArray(assembly.parts) ? assembly.parts : [];
  const interfaces = Array.isArray(assembly.interfaces) ? assembly.interfaces : [];
  
  const dfm = parts.map(evaluateDfm);
  const dfa = evaluateDfa(assembly);
  
  const avgDfmScore = dfm.length ? dfm.reduce((s, x) => s + x.dfm_score, 0) / dfm.length : 0;
  
  return {
    assembly_quality_index: ((avgDfmScore * 0.4) + (dfa.dfa_score * 0.4) + 0.2).toFixed(3),
    dfm_average_score: avgDfmScore.toFixed(3),
    dfa_score: dfa.dfa_score.toFixed(3),
    part_count: parts.length,
    interface_count: interfaces.length,
    estimated_assembly_time_hours: (parts.length * 0.25 + interfaces.length * 0.1).toFixed(2),
    maintainability_score: 0.8, // Placeholder
  };
}

export default {
  IsoToleranceClasses,
  FundamentalDeviations,
  SurfaceFinishGrades,
  evaluateDfm,
  evaluateDfa,
  analyzeToleranceStackup,
  analyzeFit,
  recommendSurfaceFinish,
  evaluateMaterialStandards,
  evaluateCompliance,
  estimateManufacturingCost,
  calculateQualityMetrics,
};

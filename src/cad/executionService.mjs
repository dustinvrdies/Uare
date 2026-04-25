import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildBoxStl, buildAssemblyStl } from './stlBuilder.mjs';
import { buildSvgPreview } from './svgPreviewBuilder.mjs';
import { buildHtmlPreview } from './htmlPreviewBuilder.mjs';
import { buildObjMesh, buildStepEnvelope, buildGlbBox, buildGlbAssembly } from './geometryExchangeBuilder.mjs';
import { buildAssemblyDocument, buildViewerManifest } from './assemblyDocumentBuilder.mjs';
import { exportKiCadProject, exportEasyEdaProject, importEcadPayload } from '../electrical/ecadIntegration.mjs';
import { runSpiceSimulation } from '../electrical/spiceSimulation.mjs';
import { buildGerberBundle, buildAssemblyInstructions } from '../electrical/gerberBuilder.mjs';
import { tryCadKernelExecution } from './kernelRunner.mjs';
import { validateExecutionArtifacts } from './geometryValidator.mjs';
import { compareGeometryFromManifest } from './geometryComparator.mjs';
import { applyEngineeringGuardrails, synthesizeAutoRepairPlan } from './engineeringGuardrails.mjs';
import { resolvePythonInvocation } from '../platform/process.mjs';

function readExecutionJson(artifactStore, executionId, filename, fallback = null) {
  try {
    const raw = artifactStore.readText(executionId, filename);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function buildEngineeringManifest(plan = {}, assemblyDocument = {}, kernelManifest = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  const kernelParts = Array.isArray(kernelManifest.parts) ? kernelManifest.parts : [];
  const partMap = new Map(kernelParts.map((part) => [part.id, part]));
  const domains = [...new Set(parts.flatMap((part) => part.engineering_profile?.domains || []))];
  return {
    generated_at: new Date().toISOString(),
    platform_target: 'engineering_grade',
    capability_scope: {
      parametric_geometry: true,
      material_profiles: true,
      simulation_metadata: true,
      ai_design_exploration: true,
      cross_domain_ready: true,
    },
    domains,
    execution_intent: {
      engine: plan?.engine || 'cadquery',
      ready_for_execution: Boolean(plan?.ready_for_execution),
      manufacturable: Boolean(plan?.manufacturable?.manufacturable || plan?.manufacturability?.manufacturable),
    },
    parts: parts.map((part) => ({
      id: part.id,
      name: part.name,
      type: part.shape,
      kind: part.kind,
      material: part.material,
      material_profile: part.material_profile || null,
      material_alternatives: part.material_alternatives || [],
      appearance: part.appearance || null,
      engineering_profile: part.engineering_profile || null,
      kernel_metrics: partMap.get(part.id)?.kernel_metrics || null,
      bbox_mm: partMap.get(part.id)?.bbox_mm || part.dimensions_mm || null,
    })),
  };
}

function buildMaterialReport(assemblyDocument = {}, kernelManifest = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  const kernelParts = Array.isArray(kernelManifest.parts) ? kernelManifest.parts : [];
  const kernelMap = new Map(kernelParts.map((part) => [part.id, part]));
  return {
    generated_at: new Date().toISOString(),
    parts: parts.map((part) => ({
      id: part.id,
      name: part.name,
      material: part.material,
      material_profile: part.material_profile || null,
      alternatives: part.material_alternatives || [],
      reactions: part.engineering_profile?.reactions || null,
      kernel_metrics: kernelMap.get(part.id)?.kernel_metrics || null,
    })),
  };
}

function buildDesignExploration(assemblyDocument = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  return {
    generated_at: new Date().toISOString(),
    autonomous_search_enabled: true,
    candidates: parts.map((part) => ({
      id: part.id,
      name: part.name,
      domains: part.engineering_profile?.domains || [],
      recommended_mutations: [
        'resize_for_mass_efficiency',
        'evaluate_material_alternatives',
        'add_feature_timeline_detail',
      ],
      recommended_simulations: part.engineering_profile?.simulation_recommendations || [],
    })),
  };
}

function buildInventionFeed(manifest = {}, assemblyDocument = {}, engineeringManifest = {}, designExploration = {}) {
  return {
    generated_at: new Date().toISOString(),
    execution_id: manifest.execution_id,
    type: 'cad_invention_update',
    headline: `Engineering concept generated with ${engineeringManifest.parts?.length || 0} parts`,
    domains: engineeringManifest.domains || [],
    summary: {
      engine: manifest.engine,
      kernel_ok: Boolean(manifest.kernel_execution?.ok),
      manufacturable: Boolean(manifest.manufacturable),
      part_count: Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts.length : 0,
    },
    linked_artifacts: (manifest.artifacts || []).map((artifact) => ({ type: artifact.type, filename: artifact.filename, url: artifact.url || null })),
    next_actions: [
      'run domain-specific simulation set',
      'evaluate AI-generated material alternatives',
      'publish blueprint and manufacturing package review',
    ],
    exploration: designExploration,
  };
}

function sha256(text = '') {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function makeExecutionId() {
  return `cad-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function estimateCadSummary(plan = {}) {
  const params = plan?.recipe?.parameters || {};
  const material = params.material || {};
  const length = Math.max(Number(params.bracket_length_mm || 120), 1);
  const width = Math.max(Number(params.bracket_width_mm || 40), 1);
  const height = Math.max(Number(params.bracket_height_mm || 30), 1);
  const thickness = Math.max(Number(params.wall_thickness_mm || 4), 0.5);
  const density = Math.max(Number(material.density || 2.7), 0.1);
  const stockVolumeMm3 = length * width * height;
  const estimatedSolidFraction = 0.18 + Math.min(thickness / Math.max(width, 1), 0.22);
  const estimatedPartVolumeMm3 = stockVolumeMm3 * estimatedSolidFraction;
  const estimatedMassG = estimatedPartVolumeMm3 * density / 1000;
  const materialCostUsd = estimatedMassG * (params.process === '3d_print' ? 0.035 : 0.02);
  const stockFootprintMm2 = length * width;
  const estimatedFaceAreaMm2 = 2 * ((length * width) + (length * height) + (width * height));
  const materialWasteRatio = clamp(1 - (estimatedPartVolumeMm3 / Math.max(stockVolumeMm3, 1)), 0, 1);
  return {
    estimated_stock_volume_mm3: round(stockVolumeMm3, 2),
    estimated_part_volume_mm3: round(estimatedPartVolumeMm3, 2),
    estimated_mass_g: round(estimatedMassG, 2),
    estimated_material_cost_usd: round(materialCostUsd, 2),
    estimated_stock_footprint_mm2: round(stockFootprintMm2, 2),
    estimated_surface_area_mm2: round(estimatedFaceAreaMm2 * estimatedSolidFraction, 2),
    estimated_cut_path_mm: round((length * 2) + (width * 2) + (height * 4), 2),
    material_waste_ratio: round(materialWasteRatio, 4),
    process: params.process || 'cnc',
    material_name: params.material_name || null,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function deepCloneJson(value = {}) {
  return JSON.parse(JSON.stringify(value || {}));
}

function extractPartDims(part = {}) {
  const dims = part?.dimensions_mm || part?.dims || {};
  return {
    x: normalizeDimensionValue(dims.x ?? dims.length ?? dims.width ?? dims.outer_diameter ?? dims.diameter, 40),
    y: normalizeDimensionValue(dims.y ?? dims.width ?? dims.depth ?? dims.outer_diameter ?? dims.diameter, 30),
    z: normalizeDimensionValue(dims.z ?? dims.height ?? dims.thickness ?? dims.length, 20),
  };
}

function extractPartPosition(part = {}) {
  if (Array.isArray(part?.position)) {
    return [
      Number.isFinite(Number(part.position[0])) ? Number(part.position[0]) : 0,
      Number.isFinite(Number(part.position[1])) ? Number(part.position[1]) : 0,
      Number.isFinite(Number(part.position[2])) ? Number(part.position[2]) : 0,
    ];
  }
  const t = part?.transform_mm || {};
  return [
    Number.isFinite(Number(t.x)) ? Number(t.x) : 0,
    Number.isFinite(Number(t.y)) ? Number(t.y) : 0,
    Number.isFinite(Number(t.z)) ? Number(t.z) : 0,
  ];
}

function partAabb(part = {}) {
  const dims = extractPartDims(part);
  const pos = extractPartPosition(part);
  return {
    min: [pos[0] - (dims.x / 2), pos[1] - (dims.y / 2), pos[2] - (dims.z / 2)],
    max: [pos[0] + (dims.x / 2), pos[1] + (dims.y / 2), pos[2] + (dims.z / 2)],
  };
}

function intersectsAabb(a = {}, b = {}) {
  return !(
    a.max[0] <= b.min[0] || a.min[0] >= b.max[0]
    || a.max[1] <= b.min[1] || a.min[1] >= b.max[1]
    || a.max[2] <= b.min[2] || a.min[2] >= b.max[2]
  );
}

function detectOverlaps(parts = []) {
  const overlaps = [];
  for (let i = 0; i < parts.length; i += 1) {
    const a = partAabb(parts[i]);
    for (let j = i + 1; j < parts.length; j += 1) {
      const b = partAabb(parts[j]);
      if (intersectsAabb(a, b)) overlaps.push([i, j]);
    }
  }
  return overlaps;
}

function autoLayoutPlan(plan = {}, options = {}) {
  const candidate = deepCloneJson(plan || {});
  const parts = Array.isArray(candidate?.parts) ? candidate.parts : [];
  if (parts.length <= 1) {
    return { applied: false, reason: 'single_part_or_empty', plan: candidate, overlap_count_before: 0, overlap_count_after: 0 };
  }

  const mates = Array.isArray(candidate?.interfaces)
    ? candidate.interfaces
    : Array.isArray(candidate?.mates)
      ? candidate.mates
      : [];
  if (mates.length > 0) {
    return { applied: false, reason: 'constraints_defined', plan: candidate, overlap_count_before: detectOverlaps(parts).length, overlap_count_after: detectOverlaps(parts).length };
  }

  const overlapsBefore = detectOverlaps(parts).length;
  if (overlapsBefore === 0) {
    return { applied: false, reason: 'no_overlap_detected', plan: candidate, overlap_count_before: 0, overlap_count_after: 0 };
  }

  const clearance = Math.max(2, Number(options.clearanceMm || 12));
  const rowPitch = Math.max(60, Number(options.rowPitchMm || 140));
  const cursorByRow = new Map();
  const rowIndexByKind = new Map();

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] || {};
    const kind = String(part.kind || part.type || 'general').toLowerCase();
    if (!rowIndexByKind.has(kind)) rowIndexByKind.set(kind, rowIndexByKind.size);
    const row = rowIndexByKind.get(kind);
    const dims = extractPartDims(part);
    const prevCursor = Number(cursorByRow.get(row) || 0);
    const x = prevCursor + (dims.x / 2);
    const y = row * rowPitch;
    const currentPos = extractPartPosition(part);
    const z = Number.isFinite(Number(currentPos[2])) && Number(currentPos[2]) !== 0
      ? Number(currentPos[2])
      : (dims.z / 2);

    part.position = [round(x, 3), round(y, 3), round(z, 3)];
    if (part.transform_mm && typeof part.transform_mm === 'object') {
      part.transform_mm.x = part.position[0];
      part.transform_mm.y = part.position[1];
      part.transform_mm.z = part.position[2];
    }

    const nextCursor = x + (dims.x / 2) + clearance;
    cursorByRow.set(row, nextCursor);
  }

  const overlapsAfter = detectOverlaps(parts).length;
  return {
    applied: true,
    reason: 'deoverlap_layout_applied',
    plan: candidate,
    overlap_count_before: overlapsBefore,
    overlap_count_after: overlapsAfter,
    rows: rowIndexByKind.size,
    clearance_mm: clearance,
    row_pitch_mm: rowPitch,
  };
}

function inferPartFeatureTemplates(part = {}) {
  const shape = String(part?.shape || part?.type || '').toLowerCase();
  const kind = String(part?.kind || '').toLowerCase();
  const dims = extractPartDims(part);
  const features = [];

  if (shape === 'gear') {
    features.push({
      template: 'involute_like_teeth',
      estimated_tooth_count: Math.max(10, Math.round(Math.min(dims.x, dims.y) / 3)),
      face_width_mm: round(dims.z, 3),
    });
  }
  if (shape === 'flange' || shape === 'plate') {
    features.push({
      template: 'bolt_circle',
      hole_count: 4,
      pcd_mm: round(Math.min(dims.x, dims.y) * 0.7, 3),
      hole_diameter_mm: round(Math.max(2, Math.min(dims.x, dims.y) * 0.08), 3),
    });
  }
  if (shape === 'shaft' || shape === 'tube' || shape === 'cylinder') {
    features.push({
      template: 'coaxial_bore_or_keyway',
      bore_mm: round(Math.max(1, Math.min(dims.x, dims.y) * 0.45), 3),
      keyway_width_mm: round(Math.max(1, Math.min(dims.x, dims.y) * 0.12), 3),
    });
  }
  if (shape === 'bracket' || shape === 'housing' || shape === 'box') {
    features.push({
      template: 'stiffening_ribs',
      rib_count: 2,
      rib_thickness_mm: round(Math.max(1, dims.z * 0.12), 3),
      wall_target_mm: round(Math.max(2, Math.min(dims.x, dims.y) * 0.08), 3),
    });
  }
  if (kind.includes('electrical')) {
    features.push({
      template: 'pcb_mounting_and_fiducials',
      mounting_hole_count: 4,
      fiducial_count: 3,
      clearance_keepout_mm: 1.5,
    });
  }

  return {
    part_id: part?.id || null,
    part_name: part?.name || null,
    shape: shape || 'unknown',
    kind: kind || 'unknown',
    dimensions_mm: dims,
    feature_templates: features,
  };
}

function buildPartFeatureManifest(assemblyDocument = {}, layoutMetadata = null) {
  const parts = Array.isArray(assemblyDocument?.parts) ? assemblyDocument.parts : [];
  const entries = parts.map((part) => inferPartFeatureTemplates(part));
  return {
    generated_at: new Date().toISOString(),
    part_count: entries.length,
    layout: layoutMetadata || null,
    entries,
  };
}

function partPresetFactory(domain = 'general', index = 0) {
  const suffix = index + 1;
  if (domain === 'automotive') {
    return {
      id: `auto_part_${suffix}`,
      name: index === 0 ? 'Control Arm Bracket' : index === 1 ? 'Drive Shaft Sleeve' : 'Rotor Hub',
      kind: index === 2 ? 'rotor' : 'mechanical',
      shape: index === 0 ? 'bracket' : index === 1 ? 'tube' : 'flange',
      material: index === 2 ? 'high_carbon_steel' : '6061_t6_aluminum',
      dimensions_mm: index === 0
        ? { x: 180, y: 70, z: 45 }
        : index === 1
          ? { x: 70, y: 70, z: 220 }
          : { x: 140, y: 140, z: 22 },
      position: [index * 220, 0, 0],
      metadata: { tolerance: 0.12, process: 'cnc', domain },
    };
  }
  if (domain === 'aerospace') {
    return {
      id: `aero_part_${suffix}`,
      name: index === 0 ? 'Wing Rib Segment' : index === 1 ? 'Bulkhead Ring' : 'Actuator Mount',
      kind: 'mechanical',
      shape: index === 0 ? 'bracket' : index === 1 ? 'flange' : 'housing',
      material: index === 2 ? 'ti_6al_4v' : '7075_t6_aluminum',
      dimensions_mm: index === 0
        ? { x: 260, y: 90, z: 28 }
        : index === 1
          ? { x: 180, y: 180, z: 24 }
          : { x: 160, y: 120, z: 85 },
      position: [index * 260, 0, 0],
      metadata: { tolerance: 0.08, process: '5axis_mill', domain },
    };
  }
  if (domain === 'robotics') {
    return {
      id: `robotics_part_${suffix}`,
      name: index === 0 ? 'Joint Housing' : index === 1 ? 'Harmonic Coupler' : 'Sensor Mast Clamp',
      kind: index === 2 ? 'electrical_mechanical' : 'mechanical',
      shape: index === 0 ? 'housing' : index === 1 ? 'gear' : 'bracket',
      material: index === 2 ? 'polycarbonate_gf' : 'anodized_aluminum',
      dimensions_mm: index === 0
        ? { x: 120, y: 90, z: 110 }
        : index === 1
          ? { x: 95, y: 95, z: 28 }
          : { x: 70, y: 48, z: 60 },
      position: [index * 170, 0, 0],
      metadata: { tolerance: 0.1, process: 'cnc', domain },
    };
  }
  if (domain === 'powertrain') {
    return {
      id: `powertrain_part_${suffix}`,
      name: index === 0 ? 'Planet Carrier' : index === 1 ? 'Torque Sleeve' : 'Pump Cavity Housing',
      kind: 'mechanical',
      shape: index === 0 ? 'gear' : index === 1 ? 'shaft' : 'housing',
      material: index === 2 ? 'ductile_iron' : '8620_steel',
      dimensions_mm: index === 0
        ? { x: 145, y: 145, z: 32 }
        : index === 1
          ? { x: 62, y: 62, z: 220 }
          : { x: 180, y: 140, z: 110 },
      position: [index * 210, 0, 0],
      metadata: { tolerance: 0.09, process: 'hobbing_then_grind', domain },
    };
  }
  return {
    id: `part_${suffix}`,
    name: `General Part ${suffix}`,
    kind: 'mechanical',
    shape: index % 2 ? 'bracket' : 'box',
    dimensions_mm: { x: 120, y: 60, z: 40 },
    position: [index * 150, 0, 0],
    metadata: { tolerance: 0.2, process: 'cnc', domain: 'general' },
  };
}

function applyDomainPreset(plan = {}) {
  const candidate = deepCloneJson(plan || {});
  const domainsRaw = candidate?.domain || candidate?.engineering_domain || candidate?.target_domain || candidate?.industry || null;
  const domains = Array.isArray(domainsRaw)
    ? domainsRaw
    : domainsRaw
      ? String(domainsRaw).split(/[\s,;|]+/).filter(Boolean)
      : [];

  const selectedDomain = domains.length ? String(domains[0]).toLowerCase() : 'general';
  const hasParts = Array.isArray(candidate.parts) && candidate.parts.length > 0;
  if (!hasParts && selectedDomain !== 'general') {
    candidate.parts = [partPresetFactory(selectedDomain, 0), partPresetFactory(selectedDomain, 1), partPresetFactory(selectedDomain, 2)];
  }

  const targetParts = Array.isArray(candidate.parts) ? candidate.parts : [];
  for (let i = 0; i < targetParts.length; i += 1) {
    const part = targetParts[i] || {};
    const metadata = { ...(part.metadata || {}) };
    metadata.domain = metadata.domain || selectedDomain;
    if (!Number.isFinite(Number(metadata.tolerance))) {
      metadata.tolerance = selectedDomain === 'aerospace' ? 0.08 : selectedDomain === 'automotive' ? 0.12 : 0.1;
    }
    if (!metadata.process) {
      metadata.process = selectedDomain === 'aerospace'
        ? '5axis_mill'
        : selectedDomain === 'powertrain'
          ? 'hobbing_then_grind'
          : 'cnc';
    }
    part.metadata = metadata;
  }

  return {
    plan: candidate,
    manifest: {
      generated_at: new Date().toISOString(),
      domain: selectedDomain,
      explicit_domains: domains,
      preset_applied: !hasParts && selectedDomain !== 'general',
      part_count: Array.isArray(candidate.parts) ? candidate.parts.length : 0,
      preset_source: selectedDomain !== 'general' ? 'domain_template_library' : 'none',
    },
  };
}

function buildEngineeringQualityScore({
  plan = {},
  guardrails = {},
  kernelResult = {},
  simulationReport = {},
  featureManifest = {},
  layoutMetadata = null,
  validation = null,
} = {}) {
  const partEntries = Array.isArray(featureManifest.entries) ? featureManifest.entries : [];
  const issueCounts = guardrails?.counts || {};
  const critical = Number(issueCounts.critical || (Array.isArray(guardrails?.critical) ? guardrails.critical.length : 0));
  const high = Number(issueCounts.high || (Array.isArray(guardrails?.high) ? guardrails.high.length : 0));
  const medium = Number(issueCounts.medium || (Array.isArray(guardrails?.warnings) ? guardrails.warnings.length : 0));

  const featureCoverage = partEntries.length
    ? partEntries.filter((entry) => Array.isArray(entry.feature_templates) && entry.feature_templates.length > 0).length / partEntries.length
    : 0;
  const kernelScore = kernelResult?.ok ? 1 : 0.35;
  const simulationScore = simulationReport?.ok ? 1 : (Array.isArray(simulationReport?.errors) && simulationReport.errors.length > 0 ? 0.4 : 0.7);
  const layoutScore = layoutMetadata?.applied
    ? (Number(layoutMetadata.overlap_count_after || 0) === 0 ? 1 : 0.7)
    : 0.85;
  const validationScore = validation?.ok
    ? 1
    : validation
      ? 0.7
      : 0.85;

  const manufacturable = Boolean(plan?.manufacturable?.manufacturable || plan?.manufacturability?.manufacturable);
  const manufacturabilityScore = manufacturable ? 1 : 0.75;

  const penalty = (critical * 0.35) + (high * 0.18) + (medium * 0.08);
  const weighted = (
    (featureCoverage * 0.22)
    + (kernelScore * 0.22)
    + (simulationScore * 0.2)
    + (layoutScore * 0.12)
    + (validationScore * 0.12)
    + (manufacturabilityScore * 0.12)
  ) - penalty;

  const overall = clamp(weighted, 0, 1);
  const grade = overall >= 0.92 ? 'A+'
    : overall >= 0.85 ? 'A'
      : overall >= 0.75 ? 'B'
        : overall >= 0.62 ? 'C'
          : 'D';

  return {
    generated_at: new Date().toISOString(),
    overall_score: round(overall, 4),
    grade,
    factors: {
      feature_coverage: round(featureCoverage, 4),
      kernel_execution: round(kernelScore, 4),
      simulation_health: round(simulationScore, 4),
      layout_quality: round(layoutScore, 4),
      validation_health: round(validationScore, 4),
      manufacturability: round(manufacturabilityScore, 4),
    },
    guardrail_penalty: round(penalty, 4),
    guardrail_counts: { critical, high, medium },
    part_scores: partEntries.map((entry) => ({
      part_id: entry.part_id,
      feature_templates: Array.isArray(entry.feature_templates) ? entry.feature_templates.length : 0,
      has_feature_detail: Array.isArray(entry.feature_templates) && entry.feature_templates.length > 0,
    })),
  };
}

function buildBom(assemblyDocument = {}) {
  const rows = (assemblyDocument.parts || []).map((part) => ({
    id: part.id,
    name: part.name,
    kind: part.kind,
    material: part.material || null,
    process: part.process || null,
    footprint: part.footprint || null,
    quantity: 1,
  }));
  const csv = ['id,name,kind,material,process,footprint,quantity']
    .concat(rows.map((row) => [row.id, row.name, row.kind, row.material || '', row.process || '', row.footprint || '', row.quantity].map((value) => `\"${String(value).replaceAll('\"', '\"\"')}\"`).join(',')))
    .join('\n');
  return { rows, csv: `${csv}\n` };
}

function buildDimensionsReport(assemblyDocument = {}) {
  const parts = assemblyDocument.parts || [];
  return {
    assembly_bbox_mm: assemblyDocument.bounding_box_mm || null,
    part_dimensions: parts.map((part) => ({
      id: part.id,
      label: part.name,
      dimensions_mm: part.dimensions_mm || {},
      transform_mm: part.transform_mm || {},
    })),
  };
}

function buildFeatureReport(assemblyDocument = {}) {
  return {
    hierarchy: assemblyDocument.hierarchy || [],
    features: (assemblyDocument.parts || []).map((part) => ({
      id: part.id,
      label: part.name,
      kind: part.kind,
      footprint: part.footprint || null,
      exploded_offset_mm: part.exploded_offset_mm || null,
    })),
    wiring: assemblyDocument.wiring || [],
    netlist: assemblyDocument.netlist || [],
  };
}

function normalizeDimensionValue(value, fallback = 1) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function inferCadRecipeParameters(plan = {}) {
  const existing = plan?.recipe?.parameters || {};
  const parts = Array.isArray(plan?.parts) ? plan.parts : [];
  if (!parts.length) return existing;

  const structuralKeywords = /bracket|housing|plate|flange|shaft|tube|gear|beam|frame|mount|web|gusset|cover|body|pcb/i;
  const ignoredKinds = /fastener|wire|wiring|solder|label|seal/i;
  const candidates = parts
    .filter((part) => !ignoredKinds.test(String(part?.kind || part?.type || '')))
    .map((part) => {
      const dims = extractPartDims(part);
      const name = String(part?.name || '');
      const kind = String(part?.kind || '');
      const volume = dims.x * dims.y * dims.z;
      return {
        part,
        dims,
        score: volume * (structuralKeywords.test(name) ? 1.35 : 1) * (kind.includes('electrical') ? 0.7 : 1),
      };
    })
    .sort((a, b) => b.score - a.score);

  const primary = candidates[0];
  if (!primary) return existing;

  const primaryDims = primary.dims;
  const primaryMeta = primary.part?.metadata || {};
  const pcbPart = parts.find((part) => String(part?.kind || '').includes('electrical_pcb') || String(part?.shape || '').toLowerCase() === 'pcb');
  const pcbDims = pcbPart ? extractPartDims(pcbPart) : null;
  const holeCandidate = parts.find((part) => /bolt|fastener|mount|flange/i.test(String(part?.name || '') + ' ' + String(part?.type || '') + ' ' + String(part?.shape || '')));
  const holeDims = holeCandidate ? extractPartDims(holeCandidate) : null;

  const inferred = {
    bracket_length_mm: round(primaryDims.x, 3),
    bracket_width_mm: round(primaryDims.y, 3),
    bracket_height_mm: round(primaryDims.z, 3),
    wall_thickness_mm: round(normalizeDimensionValue(primaryMeta.thickness_mm ?? primary.part?.dimensions_mm?.thickness ?? Math.min(primaryDims.x, primaryDims.y, primaryDims.z) * 0.12, 4), 3),
    bolt_hole_diameter_mm: round(normalizeDimensionValue(
      primary.part?.metadata?.hole_diameter_mm
      ?? primary.part?.dimensions_mm?.hole_diameter_mm
      ?? holeDims?.x
      ?? (Math.min(primaryDims.x, primaryDims.y) * 0.08),
      6,
    ), 3),
    material_name: primary.part?.material || existing.material_name || null,
    process: primary.part?.process || existing.process || 'cnc',
  };

  if (pcbDims) {
    inferred.pcb_length_mm = round(pcbDims.x, 3);
    inferred.pcb_width_mm = round(pcbDims.y, 3);
    inferred.pcb_thickness_mm = round(pcbDims.z, 3);
  }

  return {
    ...inferred,
    ...existing,
  };
}

function normalizeCadPlan(plan = {}) {
  const normalized = deepCloneJson(plan || {});
  const recipe = normalized.recipe && typeof normalized.recipe === 'object' ? normalized.recipe : {};
  normalized.recipe = {
    ...recipe,
    name: recipe.name || normalized.name || null,
    description: recipe.description || normalized.description || null,
    parameters: inferCadRecipeParameters(normalized),
  };
  return normalized;
}

function buildAssemblyObjFromParts(parts = []) {
  const lines = ['# UARE assembly OBJ export'];
  let vertexOffset = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] || {};
    const dims = part.dimensions_mm || {};
    const meshObj = buildObjMesh({
      length: normalizeDimensionValue(dims.x ?? dims.length ?? dims.width, 20),
      width: normalizeDimensionValue(dims.y ?? dims.width ?? dims.depth, 20),
      height: normalizeDimensionValue(dims.z ?? dims.height ?? dims.thickness, 20),
      name: part.id || `part_${index + 1}`,
      partType: part.shape || part.kind || 'box',
    });

    const tr = part.transform_mm || {};
    const tx = Number.isFinite(Number(tr.x)) ? Number(tr.x) : 0;
    const ty = Number.isFinite(Number(tr.y)) ? Number(tr.y) : 0;
    const tz = Number.isFinite(Number(tr.z)) ? Number(tr.z) : 0;

    lines.push(`o ${part.id || `part_${index + 1}`}`);
    for (const row of meshObj.split('\n')) {
      if (!row) continue;
      if (row.startsWith('v ')) {
        const [, x, y, z] = row.trim().split(/\s+/);
        lines.push(`v ${Number(x) + tx} ${Number(y) + ty} ${Number(z) + tz}`);
        continue;
      }
      if (row.startsWith('vt ') || row.startsWith('vn ')) {
        lines.push(row);
        continue;
      }
      if (row.startsWith('f ')) {
        const refs = row.slice(2).trim().split(/\s+/).map((token) => {
          const [v, vt, vn] = token.split('/').map((item) => Number(item || 0));
          const vv = v + vertexOffset;
          const vtt = vt + vertexOffset;
          const vnn = vn + vertexOffset;
          return `${vv}/${vtt}/${vnn}`;
        });
        lines.push(`f ${refs.join(' ')}`);
      }
    }

    const vertexCount = meshObj.split('\n').filter((row) => row.startsWith('v ')).length;
    vertexOffset += vertexCount;
  }

  return `${lines.join('\n')}\n`;
}

function verifyKernelDimensions(assemblyDocument = {}, kernelManifest = {}, defaultToleranceMm = 0.5) {
  const requested = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  const kernelParts = Array.isArray(kernelManifest.parts) ? kernelManifest.parts : [];
  if (!kernelParts.length) {
    return {
      skipped: true,
      reason: 'kernel_part_manifest_missing_or_empty',
      passed: false,
      part_checks: [],
      pass_rate: 0,
    };
  }

  const kernelById = new Map(kernelParts.map((part) => [String(part.id || ''), part]));
  const partChecks = requested.map((part) => {
    const req = part.dimensions_mm || {};
    const kernel = kernelById.get(String(part.id || '')) || {};
    const actual = kernel.dimensions_mm || kernel.bbox_mm || {};
    const tol = Number.isFinite(Number(part?.metadata?.tolerance))
      ? Number(part.metadata.tolerance)
      : defaultToleranceMm;

    const axes = ['x', 'y', 'z'];
    const axisChecks = axes.map((axis) => {
      const reqVal = Number(req[axis]);
      const actVal = Number(actual[axis]);
      const comparable = Number.isFinite(reqVal) && Number.isFinite(actVal);
      const delta = comparable ? Math.abs(reqVal - actVal) : null;
      return {
        axis,
        requested_mm: comparable ? reqVal : null,
        actual_mm: comparable ? actVal : null,
        delta_mm: comparable ? round(delta, 4) : null,
        tolerance_mm: tol,
        passed: comparable ? delta <= tol : false,
      };
    });

    return {
      part_id: part.id || null,
      passed: axisChecks.every((check) => check.passed),
      axis_checks: axisChecks,
    };
  });

  const passCount = partChecks.filter((check) => check.passed).length;
  const passRate = partChecks.length ? round(passCount / partChecks.length, 4) : 0;
  return {
    skipped: false,
    passed: passCount === partChecks.length && partChecks.length > 0,
    part_checks: partChecks,
    pass_rate: passRate,
    default_tolerance_mm: defaultToleranceMm,
  };
}

function buildSimulationRepairCandidates(simulationReport = {}, assemblyDocument = {}) {
  const repairs = [];
  const errors = Array.isArray(simulationReport.errors) ? simulationReport.errors : [];
  const warnings = Array.isArray(simulationReport.warnings) ? simulationReport.warnings : [];
  const hasElectrical = Array.isArray(assemblyDocument.parts)
    ? assemblyDocument.parts.some((part) => String(part.kind || '').includes('electrical'))
    : false;

  if (errors.length > 0) {
    repairs.push({
      priority: 'high',
      kind: 'geometry_reinforcement',
      action: 'increase_wall_thickness',
      suggested_delta_mm: 1.5,
      rationale: 'Simulation reports hard errors; increase structural margin before rerun.',
    });
    repairs.push({
      priority: 'high',
      kind: 'material_upgrade',
      action: 'switch_to_higher_strength_material',
      suggestion: 'steel_or_titanium_for_load_bearing_parts',
      rationale: 'Stress/deflection failure candidates need stronger material selection.',
    });
  }

  if (warnings.length > 0) {
    repairs.push({
      priority: 'medium',
      kind: 'process_refinement',
      action: 'tighten_tolerance_or_reduce_span',
      rationale: 'Warnings indicate borderline stability or manufacturability.',
    });
  }

  if (hasElectrical && (errors.length > 0 || warnings.length > 0)) {
    repairs.push({
      priority: 'medium',
      kind: 'electrical_derating',
      action: 'reduce_bus_voltage_or_add_regulation_headroom',
      rationale: 'Electrical subsystem present; derating reduces thermal/electrical stress risk.',
    });
  }

  return {
    generated_at: new Date().toISOString(),
    simulation_ok: Boolean(simulationReport?.ok),
    source_engine: simulationReport?.engine || 'unknown',
    candidate_count: repairs.length,
    candidates: repairs,
  };
}

export function createCadExecutionService(runtime, artifactStore, storageAdapter, cadExecutionStore, logger) {
  function artifactUrl(executionId, filename) {
    const publicUrl = storageAdapter.publicUrl(executionId, filename, runtime);
    if (runtime.artifactUrlMode === 'signed' && typeof storageAdapter.signUrl === 'function') {
      return storageAdapter.signUrl(publicUrl, runtime);
    }
    return publicUrl;
  }

  function mirrorIfNeeded(executionId, filename) {
    const localPath = path.join(artifactStore.executionDir(executionId), filename);
    try {
      if (typeof storageAdapter?.uploadPlaceholder === 'function' && ['object', 's3', 'r2', 'gcs'].includes(runtime.artifactStorageMode)) {
        return storageAdapter.uploadPlaceholder(localPath, executionId, filename, runtime);
      }
      if (typeof storageAdapter?.mirrorFile === 'function') {
        return storageAdapter.mirrorFile(localPath, executionId, filename);
      }
      return null;
    } catch (error) {
      logger.warn('cad.storage.mirror_failed', { execution_id: executionId, filename, error: error.message });
      return null;
    }
  }

  function registerArtifacts(executionId, items = []) {
    return items.map((item) => {
      const mirrored = mirrorIfNeeded(executionId, item.filename);
      return { ...item, url: artifactUrl(executionId, item.filename), mirrored: Boolean(mirrored) };
    });
  }

  function buildPromotionSummary(manifest = {}) {
    const promoted = Array.isArray(manifest.artifacts)
      ? manifest.artifacts.filter((artifact) => artifact.mirrored).length
      : 0;
    return {
      storage_mode: storageAdapter?.mode || 'unknown',
      promoted_artifact_count: promoted,
      artifact_count: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
      promoted_at: new Date().toISOString(),
    };
  }

  async function persistManifest(manifest = {}) {
    const executionId = manifest.execution_id;
    artifactStore.writeText(executionId, 'manifest.json', JSON.stringify(manifest, null, 2));
    mirrorIfNeeded(executionId, 'manifest.json');

    if (cadExecutionStore?.saveExecution) {
      await cadExecutionStore.saveExecution(manifest);
      if (manifest.project_id && cadExecutionStore?.linkExecutionToProject) {
        await cadExecutionStore.linkExecutionToProject(manifest.project_id, manifest.execution_id);
      }
    }

    return manifest;
  }


function createBaseArtifacts(executionId, plan, options = {}) {
  const layoutMetadata = options?.layoutMetadata || null;
  const domainPresetManifest = options?.domainPresetManifest || null;
  const qualityScore = options?.qualityScore || null;
  const params = plan?.recipe?.parameters || {};
  const script = String(plan?.script || '');
  const importedModules = importEcadPayload(plan?.electrical_import || {});
  const enrichedPlan = importedModules.length
    ? { ...plan, recipe: { ...(plan?.recipe || {}), parameters: { ...(plan?.recipe?.parameters || {}), modules: importedModules } } }
    : plan;
  const assemblyDocument = buildAssemblyDocument(enrichedPlan || {});
  const viewerManifest = buildViewerManifest(assemblyDocument);
  const bom = buildBom(assemblyDocument);
  const dimensions = buildDimensionsReport(assemblyDocument);
  const features = buildFeatureReport(assemblyDocument);
  const partFeatureManifest = buildPartFeatureManifest(assemblyDocument, layoutMetadata);
  const kicad = exportKiCadProject(assemblyDocument);
  const easyeda = exportEasyEdaProject(assemblyDocument);
  const spice = runSpiceSimulation(runtime, artifactStore, executionId, assemblyDocument);
  const gerbers = buildGerberBundle(assemblyDocument);
  const assemblyInstructions = buildAssemblyInstructions(assemblyDocument);

  // Derive assembly bounding-box from plan parts rather than using hardcoded bracket dims.
  // Walk all parts, accumulate bounding box from their dims + positions.
  const planParts = Array.isArray(plan?.parts) ? plan.parts
    : Array.isArray(assemblyDocument?.parts) ? assemblyDocument.parts : [];
  let asmMinX = 0, asmMinY = 0, asmMinZ = 0;
  let asmMaxX = 120, asmMaxY = 40, asmMaxZ = 30; // sensible fallback
  if (planParts.length > 0) {
    asmMinX = Infinity; asmMinY = Infinity; asmMinZ = Infinity;
    asmMaxX = -Infinity; asmMaxY = -Infinity; asmMaxZ = -Infinity;
    for (const part of planParts) {
      const d = Object.assign({}, part.dimensions_mm || {}, part.dims || {});
      const pos = Array.isArray(part.position) ? part.position : [0, 0, 0];
      const px = Number(pos[0]) || 0;
      const py = Number(pos[1]) || 0;
      const pz = Number(pos[2]) || 0;
      const hw = (Number(d.w || d.width  || d.d || 60)) / 2;
      const hh = (Number(d.h || d.height || d.L || 60)) / 2;
      const hd = (Number(d.d || d.depth  || d.w || 60)) / 2;
      asmMinX = Math.min(asmMinX, px - hw); asmMaxX = Math.max(asmMaxX, px + hw);
      asmMinY = Math.min(asmMinY, py - hh); asmMaxY = Math.max(asmMaxY, py + hh);
      asmMinZ = Math.min(asmMinZ, pz - hd); asmMaxZ = Math.max(asmMaxZ, pz + hd);
    }
    if (!isFinite(asmMinX)) { asmMinX = 0; asmMaxX = 120; asmMinY = 0; asmMaxY = 40; asmMinZ = 0; asmMaxZ = 30; }
  }
  const asmLength = Math.max(1, Math.round(asmMaxX - asmMinX));
  const asmWidth  = Math.max(1, Math.round(asmMaxY - asmMinY));
  const asmHeight = Math.max(1, Math.round(asmMaxZ - asmMinZ));

  // Use explicit recipe params if provided (legacy), otherwise use computed assembly bbox
  const envLength = Number(params.bracket_length_mm || asmLength);
  const envWidth  = Number(params.bracket_width_mm  || asmWidth);
  const envHeight = Number(params.bracket_height_mm || asmHeight);
  const holeD     = Number(params.bolt_hole_diameter_mm || 8);
  const firstPartType = (planParts[0]?.type || planParts[0]?.kind || '').toLowerCase();
  const firstPartName = planParts[0]?.name || planParts[0]?.label || plan?.name || '';

  const stl = buildBoxStl({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });
  const svg = buildSvgPreview({ length: envLength, width: envWidth, height: envHeight, hole: holeD, executionId, partType: firstPartType, partName: firstPartName, totalParts: planParts.length || 1 });
  const svgTop = buildSvgPreview({ length: envLength, width: envWidth, height: envHeight, hole: holeD, executionId, partType: firstPartType, partName: firstPartName, totalParts: planParts.length || 1, singleView: 'top' });
  const svgFront = buildSvgPreview({ length: envLength, width: envWidth, height: envHeight, hole: holeD, executionId, partType: firstPartType, partName: firstPartName, totalParts: planParts.length || 1, singleView: 'front' });
  const svgSide = buildSvgPreview({ length: envLength, width: envWidth, height: envHeight, hole: holeD, executionId, partType: firstPartType, partName: firstPartName, totalParts: planParts.length || 1, singleView: 'side' });
  const obj = buildObjMesh({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });
  const assemblyObj = buildAssemblyObjFromParts(assemblyDocument.parts || []);
  const assemblyStl = buildAssemblyStl(assemblyDocument.parts || [], `${executionId}_assembly`);
  const step = buildStepEnvelope({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });
  const glb = buildGlbBox({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });
  const assemblyGlb = buildGlbAssembly(assemblyDocument.parts || [], `${executionId}_assembly`);

  artifactStore.writeText(executionId, 'plan.json', JSON.stringify(enrichedPlan, null, 2));
  artifactStore.writeText(executionId, 'recipe.json', JSON.stringify(enrichedPlan?.recipe || {}, null, 2));
  artifactStore.writeText(executionId, 'cadquery_script.py', script);
  artifactStore.writeText(executionId, 'assembly_document.json', JSON.stringify(assemblyDocument, null, 2));
  artifactStore.writeText(executionId, 'viewer_manifest.json', JSON.stringify(viewerManifest, null, 2));
  artifactStore.writeText(executionId, 'bom.json', JSON.stringify(bom.rows, null, 2));
  artifactStore.writeText(executionId, 'bom.csv', bom.csv);
  artifactStore.writeText(executionId, 'dimensions.json', JSON.stringify(dimensions, null, 2));
  artifactStore.writeText(executionId, 'features.json', JSON.stringify(features, null, 2));
  artifactStore.writeText(executionId, 'part_feature_manifest.json', JSON.stringify(partFeatureManifest, null, 2));
  if (domainPresetManifest) {
    artifactStore.writeText(executionId, 'domain_preset_manifest.json', JSON.stringify(domainPresetManifest, null, 2));
  }
  if (qualityScore) {
    artifactStore.writeText(executionId, 'engineering_quality_score.json', JSON.stringify(qualityScore, null, 2));
  }
  artifactStore.writeText(executionId, 'pcb_layout.kicad_pcb', kicad.pcb);
  artifactStore.writeText(executionId, 'schematic.kicad_sch', kicad.schematic);
  artifactStore.writeText(executionId, 'footprints.json', JSON.stringify(kicad.footprints, null, 2));
  artifactStore.writeText(executionId, 'easyeda_project.json', JSON.stringify(easyeda, null, 2));
  artifactStore.writeText(executionId, 'netlist.json', JSON.stringify(assemblyDocument.netlist || [], null, 2));
  artifactStore.writeText(executionId, 'wiring_routes.json', JSON.stringify(assemblyDocument.wiring || [], null, 2));
  artifactStore.writeText(executionId, 'simulation_report.json', JSON.stringify(spice, null, 2));
  artifactStore.writeText(executionId, 'assembly_instructions.md', assemblyInstructions);
  Object.entries(gerbers).forEach(([filename, content]) => artifactStore.writeText(executionId, filename, content));
  artifactStore.writeText(executionId, 'model_preview.svg', svg);
  artifactStore.writeText(executionId, 'model_preview_top.svg', svgTop);
  artifactStore.writeText(executionId, 'model_preview_front.svg', svgFront);
  artifactStore.writeText(executionId, 'model_preview_side.svg', svgSide);
  artifactStore.writeText(executionId, 'model_envelope.stl', stl);
  artifactStore.writeText(executionId, 'model_mesh.obj', obj);
  artifactStore.writeText(executionId, 'assembly_mesh.obj', assemblyObj);
  artifactStore.writeText(executionId, 'assembly_mesh.stl', assemblyStl);
  artifactStore.writeBinary(executionId, 'model_mesh.glb', glb);
  artifactStore.writeBinary(executionId, 'assembly_mesh.glb', assemblyGlb);
  artifactStore.writeText(executionId, 'model_step.step', step);

  return registerArtifacts(executionId, [
    { type: 'plan', filename: 'plan.json' },
    { type: 'recipe', filename: 'recipe.json' },
    { type: 'cadquery_script', filename: 'cadquery_script.py' },
    { type: 'assembly_document', filename: 'assembly_document.json' },
    { type: 'viewer_manifest', filename: 'viewer_manifest.json' },
    { type: 'bom_json', filename: 'bom.json' },
    { type: 'bom_csv', filename: 'bom.csv' },
    { type: 'dimensions', filename: 'dimensions.json' },
    { type: 'features', filename: 'features.json' },
    { type: 'part_feature_manifest', filename: 'part_feature_manifest.json' },
    ...(domainPresetManifest ? [{ type: 'domain_preset_manifest', filename: 'domain_preset_manifest.json' }] : []),
    ...(qualityScore ? [{ type: 'engineering_quality_score', filename: 'engineering_quality_score.json' }] : []),
    { type: 'kicad_pcb', filename: 'pcb_layout.kicad_pcb' },
    { type: 'kicad_schematic', filename: 'schematic.kicad_sch' },
    { type: 'footprints', filename: 'footprints.json' },
    { type: 'easyeda_project', filename: 'easyeda_project.json' },
    { type: 'netlist', filename: 'netlist.json' },
    { type: 'wiring', filename: 'wiring_routes.json' },
    { type: 'simulation_report', filename: 'simulation_report.json' },
    { type: 'assembly_instructions', filename: 'assembly_instructions.md' },
    { type: 'gerber_top_copper', filename: 'board_top_copper.gbr' },
    { type: 'gerber_outline', filename: 'board_outline.gbr' },
    { type: 'drill_file', filename: 'board_drill.drl' },
    { type: 'svg_preview', filename: 'model_preview.svg' },
    { type: 'svg_preview_top', filename: 'model_preview_top.svg' },
    { type: 'svg_preview_front', filename: 'model_preview_front.svg' },
    { type: 'svg_preview_side', filename: 'model_preview_side.svg' },
    { type: 'stl_envelope', filename: 'model_envelope.stl' },
    { type: 'obj_mesh', filename: 'model_mesh.obj' },
    { type: 'assembly_obj_mesh', filename: 'assembly_mesh.obj' },
    { type: 'assembly_stl_mesh', filename: 'assembly_mesh.stl' },
    { type: 'glb_mesh', filename: 'model_mesh.glb' },
    { type: 'assembly_glb_mesh', filename: 'assembly_mesh.glb' },
    { type: 'step_exchange', filename: 'model_step.step' },
  ]);
}

function buildQueuedManifest(plan = {}, actor = {}, options = {}) {
    const normalizedPlan = normalizeCadPlan(plan || {});
    const executionId = options.executionId || makeExecutionId();
    return {
      execution_id: executionId,
      project_id: normalizedPlan?.project_id || null,
      status: 'queued',
      deterministic: true,
      engine: normalizedPlan?.engine || 'cadquery',
      created_at: new Date().toISOString(),
      actor_id: actor?.id || 'unknown',
      plan_signature: sha256(JSON.stringify(normalizedPlan?.recipe?.parameters || {}) + '\n' + String(normalizedPlan?.script || '')),
      manufacturable: Boolean(normalizedPlan?.manufacturability?.manufacturable),
      ready_for_execution: Boolean(normalizedPlan?.ready_for_execution),
      recipe: normalizedPlan?.recipe || null,
      kernel_execution: {
        attempted: Boolean(runtime.cadKernelEnabled),
        ok: false,
        skipped: true,
        reason: 'Queued for external worker execution',
      },
      execution_target: options.executionTarget || runtime.cadExecutionTarget || 'queued',
      artifacts: [],
      execution_summary: estimateCadSummary(normalizedPlan || {}),
      notes: ['Execution queued and awaiting worker claim.'],
      validation: {
        valid: false,
        queued: true,
        artifact_count: 0,
        missing: ['manifest.pending_execution'],
      },
      geometry_comparison: {
        comparison_status: 'pending_execution',
        kernel_present: false,
        fallback_present: false,
      },
      artifact_promotion: {
        storage_mode: storageAdapter?.mode || 'unknown',
        promoted_artifact_count: 0,
        artifact_count: 0,
        promoted_at: null,
      },
    };
  }

  async function execute(plan, actor, options = {}) {
    const normalizedPlan = normalizeCadPlan(plan || {});
    const domainPreset = applyDomainPreset(normalizedPlan || {});
    const layoutMetadata = autoLayoutPlan(domainPreset.plan || normalizedPlan || {}, { clearanceMm: 12, rowPitchMm: 150 });
    const preprocessedPlan = layoutMetadata.plan || (normalizedPlan || {});

    const guardrailAssessment = applyEngineeringGuardrails(preprocessedPlan);
    let executionPlan = guardrailAssessment.normalizedPlan || preprocessedPlan;
    let guardrailReport = guardrailAssessment.report || {};

    const configuredOverride = runtime?.cadGuardrailOverrideToken ? String(runtime.cadGuardrailOverrideToken) : null;
    const providedOverride = plan?.engineering_override_token ? String(plan.engineering_override_token) : null;
    const overrideUsed = Boolean(configuredOverride && providedOverride && configuredOverride === providedOverride);

    let autoRepair = null;
    const criticalCount = Array.isArray(guardrailReport?.critical) ? guardrailReport.critical.length : 0;
    if (criticalCount > 0 && !overrideUsed) {
      const repair = synthesizeAutoRepairPlan(executionPlan, guardrailReport);
      const repairedAssessment = applyEngineeringGuardrails(repair?.repaired_plan || executionPlan);
      const repairedCritical = Array.isArray(repairedAssessment?.report?.critical) ? repairedAssessment.report.critical.length : 0;

      if (repairedCritical === 0 && Array.isArray(repair?.applied_fixes) && repair.applied_fixes.length > 0) {
        executionPlan = repairedAssessment.normalizedPlan || executionPlan;
        guardrailReport = repairedAssessment.report || guardrailReport;
        autoRepair = {
          applied: true,
          selected_strategy: repair.selected_strategy || null,
          applied_fixes: repair.applied_fixes || [],
          candidate_repairs: repair.candidate_repairs || [],
          rerun_hints: repair.rerun_hints || null,
        };
      } else {
        const suggestionPayload = {
          rerun_payload: {
            plan: repair?.repaired_plan || executionPlan,
          },
          override: {
            token_required: Boolean(configuredOverride),
            token_header: 'engineering_override_token',
          },
        };
        const blockError = new Error('CAD execution blocked by engineering guardrails');
        blockError.statusCode = 422;
        blockError.code = 'CAD_GUARDRAIL_BLOCKED';
        blockError.details = {
          severity: guardrailReport?.severity || 'critical',
          critical: guardrailReport?.critical || [],
          warnings: guardrailReport?.warnings || [],
          auto_repair_candidate: repair
            ? {
                selected_strategy: repair.selected_strategy || null,
                applied_fixes: repair.applied_fixes || [],
                rerun_hints: repair.rerun_hints || null,
              }
            : null,
          override_required: Boolean(configuredOverride),
        };
        blockError.suggestions = suggestionPayload;
        throw blockError;
      }
    }

    const executionId = options.executionId || makeExecutionId();
    const baseArtifacts = createBaseArtifacts(executionId, executionPlan || {}, {
      layoutMetadata,
      domainPresetManifest: domainPreset.manifest,
    });

    // ── Kernel execution with verifier-repair loop ─────────────────────────
    let kernel = tryCadKernelExecution(runtime, artifactStore, executionId, logger);
    let repaired = false;

    if (!kernel.ok && !kernel.skipped && runtime.cadKernelEnabled) {
      // Repair pass: downgrade unsupported shapes to 'box' so the kernel can
      // always produce *some* geometry rather than crashing.
      try {
        const assemblyPath = path.join(artifactStore.executionDir(executionId), 'assembly_document.json');
        if (fs.existsSync(assemblyPath)) {
          const doc = JSON.parse(fs.readFileSync(assemblyPath, 'utf8'));
          const SAFE_SHAPES = new Set(['box', 'cylinder', 'plate', 'tube', 'shaft', 'flange', 'pcb', 'housing', 'bracket']);
          let changed = false;
          for (const part of doc.parts || []) {
            const shape = String(part.shape || part.kind || 'box').toLowerCase();
            if (!SAFE_SHAPES.has(shape)) {
              part._original_shape = part.shape;
              part.shape = 'box';
              changed = true;
            }
          }
          if (changed) {
            fs.writeFileSync(assemblyPath, JSON.stringify(doc, null, 2), 'utf8');
            logger.warn('cad.kernel.repair', { execution_id: executionId, reason: 'downgraded complex shapes to box for retry' });
            kernel = tryCadKernelExecution(runtime, artifactStore, executionId, logger);
            repaired = true;
          }
        }
      } catch (repairErr) {
        logger.warn('cad.kernel.repair_failed', { execution_id: executionId, error: repairErr.message });
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    const extraArtifacts = (kernel?.ok && Array.isArray(kernel.artifacts))
      ? registerArtifacts(executionId, kernel.artifacts)
      : [];

    const manifest = {
      execution_id: executionId,
      project_id: plan?.project_id || null,
      status: 'completed',
      deterministic: true,
      engine: plan?.engine || 'cadquery',
      created_at: new Date().toISOString(),
      actor_id: actor?.id || 'unknown',
      plan_signature: sha256(JSON.stringify(plan?.recipe?.parameters || {}) + '\n' + String(plan?.script || '')),
      manufacturable: Boolean(executionPlan?.manufacturability?.manufacturable),
      ready_for_execution: Boolean(executionPlan?.ready_for_execution),
      recipe: executionPlan?.recipe || null,
      engineering_guardrail_policy: {
        enabled: true,
        severity: guardrailReport?.severity || 'ok',
        critical_count: Array.isArray(guardrailReport?.critical) ? guardrailReport.critical.length : 0,
        warning_count: Array.isArray(guardrailReport?.warnings) ? guardrailReport.warnings.length : 0,
        override_used: overrideUsed,
      },
      auto_repair: autoRepair || {
        applied: false,
        applied_fixes: [],
      },
      auto_layout: {
        applied: Boolean(layoutMetadata?.applied),
        reason: layoutMetadata?.reason || null,
        overlap_count_before: Number(layoutMetadata?.overlap_count_before || 0),
        overlap_count_after: Number(layoutMetadata?.overlap_count_after || 0),
        rows: Number(layoutMetadata?.rows || 0),
        clearance_mm: Number(layoutMetadata?.clearance_mm || 0),
      },
      domain_preset: {
        domain: domainPreset?.manifest?.domain || 'general',
        preset_applied: Boolean(domainPreset?.manifest?.preset_applied),
        part_count: Number(domainPreset?.manifest?.part_count || 0),
      },
      kernel_execution: {
        attempted: Boolean(runtime.cadKernelEnabled),
        ok: Boolean(kernel?.ok),
        skipped: Boolean(kernel?.skipped),
        repaired,
        reason: kernel?.reason || (repaired && !kernel?.ok ? 'Kernel failed after repair pass' : null),
      },
      execution_target: options.executionTarget || runtime.cadExecutionTarget || 'in_process',
      artifacts: [...baseArtifacts, ...extraArtifacts],
      execution_summary: estimateCadSummary(executionPlan || {}),
      notes: [
        'Artifacts are deterministic for the same engineering inputs.',
        'SVG preview, STL, OBJ, GLB, and STEP envelopes are generated server-side.',
        `Engineering guardrails severity: ${guardrailReport?.severity || 'ok'}.`,
        kernel?.ok ? 'CadQuery kernel execution succeeded for this run.' : 'Kernel execution not completed; fallback artifacts still generated.',
        ...(repaired ? ['Kernel geometry repair was applied: complex shapes were downgraded for kernel compatibility.'] : []),
        ...(autoRepair?.applied ? ['Auto-repair was applied to satisfy engineering guardrails before execution.'] : []),
        ...(layoutMetadata?.applied ? [`Auto-layout de-overlap applied (${layoutMetadata.overlap_count_before} -> ${layoutMetadata.overlap_count_after} overlaps).`] : []),
      ],
    };

    const html = buildHtmlPreview(manifest);
    artifactStore.writeText(executionId, 'preview.html', html);
    manifest.artifacts.push(...registerArtifacts(executionId, [{ type: 'html_preview', filename: 'preview.html' }]));

    const assemblyDocument = readExecutionJson(artifactStore, executionId, 'assembly_document.json', {});
    const kernelManifest = readExecutionJson(artifactStore, executionId, 'kernel_part_manifest.json', {});
    const engineeringManifest = buildEngineeringManifest(executionPlan || {}, assemblyDocument, kernelManifest);
    const materialReport = buildMaterialReport(assemblyDocument, kernelManifest);
    const designExploration = buildDesignExploration(assemblyDocument);
    const simulationReport = readExecutionJson(artifactStore, executionId, 'simulation_report.json', {});
    const simulationRepairs = buildSimulationRepairCandidates(simulationReport, assemblyDocument);
    const dimensionVerification = verifyKernelDimensions(assemblyDocument, kernelManifest, Number(executionPlan?.recipe?.parameters?.default_tolerance_mm || 0.5));
    const qualityScore = buildEngineeringQualityScore({
      plan: executionPlan,
      guardrails: guardrailReport,
      kernelResult: kernel,
      simulationReport,
      featureManifest: readExecutionJson(artifactStore, executionId, 'part_feature_manifest.json', {}),
      layoutMetadata,
      validation: manifest.validation,
    });
    const inventionFeed = buildInventionFeed(manifest, assemblyDocument, engineeringManifest, designExploration);

    artifactStore.writeText(executionId, 'engineering_manifest.json', JSON.stringify(engineeringManifest, null, 2));
    artifactStore.writeText(executionId, 'material_report.json', JSON.stringify(materialReport, null, 2));
    artifactStore.writeText(executionId, 'design_exploration.json', JSON.stringify(designExploration, null, 2));
    artifactStore.writeText(executionId, 'simulation_repair_candidates.json', JSON.stringify(simulationRepairs, null, 2));
    artifactStore.writeText(executionId, 'kernel_dimension_verification.json', JSON.stringify(dimensionVerification, null, 2));
    artifactStore.writeText(executionId, 'engineering_quality_score.json', JSON.stringify(qualityScore, null, 2));
    artifactStore.writeText(executionId, 'invention_feed.json', JSON.stringify(inventionFeed, null, 2));
    manifest.artifacts.push(...registerArtifacts(executionId, [
      { type: 'engineering_manifest', filename: 'engineering_manifest.json' },
      { type: 'material_report', filename: 'material_report.json' },
      { type: 'design_exploration', filename: 'design_exploration.json' },
      { type: 'simulation_repair_candidates', filename: 'simulation_repair_candidates.json' },
      { type: 'kernel_dimension_verification', filename: 'kernel_dimension_verification.json' },
      { type: 'engineering_quality_score', filename: 'engineering_quality_score.json' },
      { type: 'invention_feed', filename: 'invention_feed.json' },
    ]));

    manifest.engineering_quality = {
      overall_score: qualityScore.overall_score,
      grade: qualityScore.grade,
      guardrail_penalty: qualityScore.guardrail_penalty,
    };

    manifest.validation = validateExecutionArtifacts(manifest);
    manifest.validation.kernel_dimension_verification = dimensionVerification;
    manifest.geometry_comparison = compareGeometryFromManifest(manifest);
    manifest.artifact_promotion = buildPromotionSummary(manifest);

    await persistManifest(manifest);

    // ── Training data capture ──────────────────────────────────────────────
    try {
      const execDir = artifactStore.executionDir(executionId);
      // execDir is typically <project_root>/executions/<id>  → go 2 up to project root
      const dataDir = path.resolve(execDir, '..', '..', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const corpusPath = path.join(dataDir, 'training_corpus.jsonl');
      const record = {
        timestamp: manifest.created_at,
        execution_id: executionId,
        prompt: executionPlan?.prompt || executionPlan?.recipe?.description || null,
        recipe: executionPlan?.recipe || null,
        assembly_summary: {
          part_count: (executionPlan?.parts || executionPlan?.assembly?.parts || []).length,
          kinds: [...new Set((executionPlan?.parts || executionPlan?.assembly?.parts || []).map((p) => p.kind).filter(Boolean))],
        },
        kernel_ok: manifest.kernel_execution.ok,
        artifact_types: manifest.artifacts.map((a) => a.type),
        plan_signature: manifest.plan_signature,
      };
      fs.appendFileSync(corpusPath, JSON.stringify(record) + '\n', 'utf8');
    } catch (captureErr) {
      logger.warn('cad.training.capture_failed', { execution_id: executionId, error: captureErr.message });
    }
    // ──────────────────────────────────────────────────────────────────────

    logger.info('cad.execution.completed', {
      execution_id: executionId,
      artifact_count: manifest.artifacts.length,
      manufacturable: manifest.manufacturable,
      kernel_ok: manifest.kernel_execution.ok,
      validation_ok: manifest.validation.valid,
      geometry_status: manifest.geometry_comparison.comparison_status,
      storage_mode: storageAdapter?.mode || 'unknown',
      artifact_url_mode: runtime.artifactUrlMode,
      project_id: manifest.project_id,
      execution_target: manifest.execution_target,
    });
    return manifest;
  }

  function getStatus(executionId) {
    const raw = artifactStore.readText(executionId, 'manifest.json');
    return raw ? JSON.parse(raw) : null;
  }

  function analyze(plan = {}, actor = {}) {
    const domainPreset = applyDomainPreset(plan || {});
    const layoutMetadata = autoLayoutPlan(domainPreset.plan || plan || {}, { clearanceMm: 12, rowPitchMm: 150 });
    const assessment = applyEngineeringGuardrails(layoutMetadata.plan || plan || {});
    const report = assessment.report || {};
    const normalizedPlan = assessment.normalizedPlan || (layoutMetadata.plan || plan || {});
    const configuredOverride = runtime?.cadGuardrailOverrideToken ? String(runtime.cadGuardrailOverrideToken) : null;
    const providedOverride = plan?.engineering_override_token ? String(plan.engineering_override_token) : null;
    const overrideUsed = Boolean(configuredOverride && providedOverride && configuredOverride === providedOverride);
    const allowAutoRepair = plan?.allow_auto_repair !== false;

    const criticalCount = Array.isArray(report.critical) ? report.critical.length : 0;
    let repair = null;
    let blocked = false;
    let selectedPlan = normalizedPlan;
    let selectedReport = report;

    if (criticalCount > 0 && !overrideUsed) {
      repair = synthesizeAutoRepairPlan(normalizedPlan, report);
      const repairedAssessment = applyEngineeringGuardrails(repair?.repaired_plan || normalizedPlan);
      const repairedCritical = Array.isArray(repairedAssessment?.report?.critical) ? repairedAssessment.report.critical.length : 0;

      if (allowAutoRepair && repairedCritical === 0 && Array.isArray(repair?.applied_fixes) && repair.applied_fixes.length > 0) {
        selectedPlan = repairedAssessment.normalizedPlan || selectedPlan;
        selectedReport = repairedAssessment.report || selectedReport;
      } else {
        blocked = true;
      }
    }

    const analysisAssembly = buildAssemblyDocument(selectedPlan || {});
    const featureManifest = buildPartFeatureManifest(analysisAssembly, layoutMetadata);
    const qualityEstimate = buildEngineeringQualityScore({
      plan: selectedPlan,
      guardrails: selectedReport,
      kernelResult: { ok: Boolean(runtime?.cadKernelEnabled) },
      simulationReport: {},
      featureManifest,
      layoutMetadata,
      validation: null,
    });

    return {
      ok: !blocked,
      blocked,
      actor_id: actor?.id || null,
      engineering_summary: {
        severity: selectedReport.severity || 'ok',
        manufacturability_score: Number(selectedReport.manufacturability_score || 0),
        critical_count: Array.isArray(selectedReport?.critical) ? selectedReport.critical.length : 0,
        warning_count: Array.isArray(selectedReport.warnings) ? selectedReport.warnings.length : 0,
      },
      auto_layout: {
        applied: Boolean(layoutMetadata?.applied),
        reason: layoutMetadata?.reason || null,
        overlap_count_before: Number(layoutMetadata?.overlap_count_before || 0),
        overlap_count_after: Number(layoutMetadata?.overlap_count_after || 0),
      },
      domain_preset: domainPreset.manifest,
      engineering_quality_estimate: {
        overall_score: qualityEstimate.overall_score,
        grade: qualityEstimate.grade,
        factors: qualityEstimate.factors,
      },
      guardrail_report: selectedReport,
      suggestions: {
        rerun_payload: {
          plan: repair?.repaired_plan || selectedPlan,
        },
        override: {
          token_required: Boolean(configuredOverride),
          token_header: 'engineering_override_token',
          override_used: overrideUsed,
        },
      },
    };
  }

  function getKernelHealth() {
    const cadKernelEnabled = Boolean(runtime?.cadKernelEnabled);
    const preferred = String(runtime?.cadPythonBin || '').trim();
    const candidates = Array.isArray(runtime?.cadPythonCandidates) ? runtime.cadPythonCandidates : [];
    const resolved = resolvePythonInvocation(preferred, { candidates });
    const command = String(resolved?.command || '').trim();
    const prefixArgs = Array.isArray(resolved?.prefixArgs) ? resolved.prefixArgs : [];

    const versionProbe = command
      ? spawnSync(command, [...prefixArgs, '--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true })
      : { status: 1, stdout: '', stderr: 'No python command resolved' };
    const moduleProbe = command
      ? spawnSync(command, [...prefixArgs, '-c', "import cadquery, OCP; print('kernel-ok')"], { encoding: 'utf8', timeout: 15000, windowsHide: true })
      : { status: 1, stdout: '', stderr: 'No python command resolved' };

    const versionOk = !versionProbe.error && versionProbe.status === 0;
    const moduleOk = !moduleProbe.error && moduleProbe.status === 0;
    const moduleStdErr = String(moduleProbe.stderr || '').trim();
    const moduleStdOut = String(moduleProbe.stdout || '').trim();
    const policyBlocked = /application control policy has blocked/i.test(moduleStdErr || moduleStdOut);

    return {
      generated_at: new Date().toISOString(),
      kernel_enabled: cadKernelEnabled,
      configured_python_bin: preferred || null,
      resolved_python: {
        command: command || null,
        prefix_args: prefixArgs,
      },
      probes: {
        version_ok: versionOk,
        version_stdout: String(versionProbe.stdout || '').trim(),
        version_stderr: String(versionProbe.stderr || '').trim(),
        modules_ok: moduleOk,
        modules_stdout: moduleStdOut,
        modules_stderr: moduleStdErr,
      },
      blockers: {
        application_control_policy: policyBlocked,
      },
      recommendations: policyBlocked
        ? [
            'Windows Application Control is blocking CAD kernel DLLs.',
            'Allow OCP/cadquery runtime binaries or run backend on a machine without this policy.',
          ]
        : (!moduleOk
            ? ['Install compatible cadquery + cadquery-ocp in a Python 3.11/3.12 environment and set CAD_PYTHON_BIN.']
            : ['Kernel runtime healthy.']),
    };
  }

  return { execute, analyze, getKernelHealth, getStatus, buildQueuedManifest, persistManifest };
}

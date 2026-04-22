import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildBoxStl } from './stlBuilder.mjs';
import { buildSvgPreview } from './svgPreviewBuilder.mjs';
import { buildHtmlPreview } from './htmlPreviewBuilder.mjs';
import { buildObjMesh, buildStepEnvelope, buildGlbBox } from './geometryExchangeBuilder.mjs';
import { buildAssemblyDocument, buildViewerManifest } from './assemblyDocumentBuilder.mjs';
import { exportKiCadProject, exportEasyEdaProject, importEcadPayload } from '../electrical/ecadIntegration.mjs';
import { runSpiceSimulation } from '../electrical/spiceSimulation.mjs';
import { buildGerberBundle, buildAssemblyInstructions } from '../electrical/gerberBuilder.mjs';
import { tryCadKernelExecution } from './kernelRunner.mjs';
import { validateExecutionArtifacts } from './geometryValidator.mjs';
import { compareGeometryFromManifest } from './geometryComparator.mjs';

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


function createBaseArtifacts(executionId, plan) {
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
  const obj = buildObjMesh({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });
  const step = buildStepEnvelope({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });
  const glb = buildGlbBox({ length: envLength, width: envWidth, height: envHeight, name: executionId, partType: firstPartType });

  artifactStore.writeText(executionId, 'plan.json', JSON.stringify(enrichedPlan, null, 2));
  artifactStore.writeText(executionId, 'recipe.json', JSON.stringify(enrichedPlan?.recipe || {}, null, 2));
  artifactStore.writeText(executionId, 'cadquery_script.py', script);
  artifactStore.writeText(executionId, 'assembly_document.json', JSON.stringify(assemblyDocument, null, 2));
  artifactStore.writeText(executionId, 'viewer_manifest.json', JSON.stringify(viewerManifest, null, 2));
  artifactStore.writeText(executionId, 'bom.json', JSON.stringify(bom.rows, null, 2));
  artifactStore.writeText(executionId, 'bom.csv', bom.csv);
  artifactStore.writeText(executionId, 'dimensions.json', JSON.stringify(dimensions, null, 2));
  artifactStore.writeText(executionId, 'features.json', JSON.stringify(features, null, 2));
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
  artifactStore.writeText(executionId, 'model_envelope.stl', stl);
  artifactStore.writeText(executionId, 'model_mesh.obj', obj);
  artifactStore.writeBinary(executionId, 'model_mesh.glb', glb);
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
    { type: 'stl_envelope', filename: 'model_envelope.stl' },
    { type: 'obj_mesh', filename: 'model_mesh.obj' },
    { type: 'glb_mesh', filename: 'model_mesh.glb' },
    { type: 'step_exchange', filename: 'model_step.step' },
  ]);
}

function buildQueuedManifest(plan = {}, actor = {}, options = {}) {
    const executionId = options.executionId || makeExecutionId();
    return {
      execution_id: executionId,
      project_id: plan?.project_id || null,
      status: 'queued',
      deterministic: true,
      engine: plan?.engine || 'cadquery',
      created_at: new Date().toISOString(),
      actor_id: actor?.id || 'unknown',
      plan_signature: sha256(JSON.stringify(plan?.recipe?.parameters || {}) + '\n' + String(plan?.script || '')),
      manufacturable: Boolean(plan?.manufacturability?.manufacturable),
      ready_for_execution: Boolean(plan?.ready_for_execution),
      recipe: plan?.recipe || null,
      kernel_execution: {
        attempted: Boolean(runtime.cadKernelEnabled),
        ok: false,
        skipped: true,
        reason: 'Queued for external worker execution',
      },
      execution_target: options.executionTarget || runtime.cadExecutionTarget || 'queued',
      artifacts: [],
      execution_summary: estimateCadSummary(plan || {}),
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
    const executionId = options.executionId || makeExecutionId();
    const baseArtifacts = createBaseArtifacts(executionId, plan || {});

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
      manufacturable: Boolean(plan?.manufacturability?.manufacturable),
      ready_for_execution: Boolean(plan?.ready_for_execution),
      recipe: plan?.recipe || null,
      kernel_execution: {
        attempted: Boolean(runtime.cadKernelEnabled),
        ok: Boolean(kernel?.ok),
        skipped: Boolean(kernel?.skipped),
        repaired,
        reason: kernel?.reason || (repaired && !kernel?.ok ? 'Kernel failed after repair pass' : null),
      },
      execution_target: options.executionTarget || runtime.cadExecutionTarget || 'in_process',
      artifacts: [...baseArtifacts, ...extraArtifacts],
      execution_summary: estimateCadSummary(plan || {}),
      notes: [
        'Artifacts are deterministic for the same engineering inputs.',
        'SVG preview, STL, OBJ, GLB, and STEP envelopes are generated server-side.',
        kernel?.ok ? 'CadQuery kernel execution succeeded for this run.' : 'Kernel execution not completed; fallback artifacts still generated.',
        ...(repaired ? ['Kernel geometry repair was applied: complex shapes were downgraded for kernel compatibility.'] : []),
      ],
    };

    const html = buildHtmlPreview(manifest);
    artifactStore.writeText(executionId, 'preview.html', html);
    manifest.artifacts.push(...registerArtifacts(executionId, [{ type: 'html_preview', filename: 'preview.html' }]));

    const assemblyDocument = readExecutionJson(artifactStore, executionId, 'assembly_document.json', {});
    const kernelManifest = readExecutionJson(artifactStore, executionId, 'kernel_part_manifest.json', {});
    const engineeringManifest = buildEngineeringManifest(plan || {}, assemblyDocument, kernelManifest);
    const materialReport = buildMaterialReport(assemblyDocument, kernelManifest);
    const designExploration = buildDesignExploration(assemblyDocument);
    const inventionFeed = buildInventionFeed(manifest, assemblyDocument, engineeringManifest, designExploration);

    artifactStore.writeText(executionId, 'engineering_manifest.json', JSON.stringify(engineeringManifest, null, 2));
    artifactStore.writeText(executionId, 'material_report.json', JSON.stringify(materialReport, null, 2));
    artifactStore.writeText(executionId, 'design_exploration.json', JSON.stringify(designExploration, null, 2));
    artifactStore.writeText(executionId, 'invention_feed.json', JSON.stringify(inventionFeed, null, 2));
    manifest.artifacts.push(...registerArtifacts(executionId, [
      { type: 'engineering_manifest', filename: 'engineering_manifest.json' },
      { type: 'material_report', filename: 'material_report.json' },
      { type: 'design_exploration', filename: 'design_exploration.json' },
      { type: 'invention_feed', filename: 'invention_feed.json' },
    ]));

    manifest.validation = validateExecutionArtifacts(manifest);
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
        prompt: plan?.prompt || plan?.recipe?.description || null,
        recipe: plan?.recipe || null,
        assembly_summary: {
          part_count: (plan?.assembly?.parts || []).length,
          kinds: [...new Set((plan?.assembly?.parts || []).map((p) => p.kind).filter(Boolean))],
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

  return { execute, getStatus, buildQueuedManifest, persistManifest };
}

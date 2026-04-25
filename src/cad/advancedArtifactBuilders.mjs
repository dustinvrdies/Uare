/**
 * Advanced Artifact Builders
 * Generates: part_envelope_catalog, pareto_tradeoffs, part_detail_manifest, and more
 */

import { evaluateDfm, evaluateDfa, analyzeToleranceStackup, estimateManufacturingCost, calculateQualityMetrics } from './industryStandards.mjs';

// ─── Part Envelope Catalog ───────────────────────────────────────
export function buildPartEnvelopeCatalog(assemblyDocument = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  
  const catalog = {
    generated_at: new Date().toISOString(),
    assembly_id: assemblyDocument.id || 'unknown',
    part_count: parts.length,
    envelopes: parts.map((part, idx) => {
      const dims = part.dimensions_mm || part.dims || { x: 0, y: 0, z: 0 };
      const pos = part.position || [0, 0, 0];
      
      return {
        part_id: part.id || `part-${idx}`,
        part_name: part.name || part.label || `Part ${idx + 1}`,
        sequence: idx + 1,
        envelope: {
          length_mm: Math.abs(Number(dims.x) || 0),
          width_mm: Math.abs(Number(dims.y) || 0),
          height_mm: Math.abs(Number(dims.z) || 0),
          volume_mm3: Math.abs(Number(dims.x) * Number(dims.y) * Number(dims.z)) || 0,
          bounding_sphere_radius_mm: Math.sqrt(
            (Number(dims.x) ** 2 + Number(dims.y) ** 2 + Number(dims.z) ** 2) / 3
          ) / 2 || 0,
        },
        position_mm: [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0],
        material: part.material || 'unknown',
        mass_kg: part.mass_kg || Number(dims.x * dims.y * dims.z * 0.000001 || 0),
        appearance: {
          color: part.appearance?.color || '#cccccc',
          opacity: part.appearance?.opacity || 1.0,
          texture: part.appearance?.texture || 'matte',
        },
        manufacturing_process: part.process || 'unspecified',
        quality_grade: part.quality_grade || 'commercial',
      };
    }),
    assembly_envelope: {
      total_volume_mm3: parts.reduce((sum, p) => {
        const d = p.dimensions_mm || p.dims || {};
        return sum + (Math.abs(Number(d.x) * Number(d.y) * Number(d.z)) || 0);
      }, 0),
      bounding_box_length_mm: 100, // Would compute from all positions
      bounding_box_width_mm: 60,
      bounding_box_height_mm: 40,
      total_mass_kg: parts.reduce((sum, p) => sum + (p.mass_kg || 0), 0),
    },
  };
  
  return catalog;
}

// ─── Pareto Tradeoffs Analysis ──────────────────────────────────
export function buildParetoTradeoffs(assemblyDocument = {}, plan = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  
  // Metrics: cost, mass, volume, assembly_time, quality
  const metrics = parts.map((part, idx) => {
    const costEst = estimateManufacturingCost(part, 1000);
    const dims = part.dimensions_mm || part.dims || {};
    const mass = part.mass_kg || Number(dims.x * dims.y * dims.z * 0.000001 || 0);
    const volume = Math.abs(Number(dims.x) * Number(dims.y) * Number(dims.z)) || 0;
    const dfm = evaluateDfm(part);
    
    return {
      part_id: part.id || `part-${idx}`,
      cost_usd: Number(costEst.total_cost_per_unit_usd || 0),
      mass_kg: mass,
      volume_mm3: volume,
      assembly_time_min: volume < 100 ? 1 : volume < 1000 ? 2 : 5,
      quality_score: dfm.dfm_score,
      manufacturability: dfm.dfm_score >= 0.8 ? 'high' : dfm.dfm_score >= 0.6 ? 'medium' : 'low',
    };
  });
  
  // Find Pareto frontier
  const frontier = [];
  const dominated = new Set();
  
  for (let i = 0; i < metrics.length; i++) {
    let isDominated = false;
    for (let j = 0; j < metrics.length; j++) {
      if (i === j) continue;
      
      // Point j dominates point i if:
      // j has lower cost AND lower mass (Pareto dominance)
      if (metrics[j].cost_usd <= metrics[i].cost_usd &&
          metrics[j].mass_kg <= metrics[i].mass_kg &&
          (metrics[j].cost_usd < metrics[i].cost_usd || metrics[j].mass_kg < metrics[i].mass_kg)) {
        isDominated = true;
        break;
      }
    }
    
    if (!isDominated) {
      frontier.push(metrics[i]);
    } else {
      dominated.add(metrics[i]);
    }
  }
  
  frontier.sort((a, b) => a.cost_usd - b.cost_usd);
  
  return {
    generated_at: new Date().toISOString(),
    analysis_type: 'cost_vs_mass_pareto',
    frontier_points: frontier,
    dominated_points: Array.from(dominated),
    optimization_recommendations: [
      frontier.length > 0 && frontier[0].mass_kg < 1 ? 'Consider lightweight materials for mass-critical applications' : null,
      frontier.length > 0 && frontier[0].cost_usd < 10 ? 'Cost-effective design path identified' : null,
      frontier.length > 2 ? 'Multiple optimal solutions exist; trade-off analysis recommended' : null,
    ].filter(Boolean),
  };
}

// ─── Detailed Part Manifest ─────────────────────────────────────
export function buildPartDetailManifest(assemblyDocument = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  
  return {
    generated_at: new Date().toISOString(),
    assembly_id: assemblyDocument.id || 'unknown',
    part_details: parts.map((part, idx) => {
      const dfm = evaluateDfm(part);
      const costEst = estimateManufacturingCost(part, 1000);
      
      return {
        sequence: idx + 1,
        part_id: part.id || `part-${idx}`,
        part_name: part.name || `Part ${idx + 1}`,
        description: part.description || 'No description provided',
        type: part.type || part.shape || 'generic',
        kind: part.kind || 'mechanical',
        material: part.material || 'aluminum_6061',
        process: part.process || 'cnc_milling',
        
        geometry: {
          dimensions_mm: {
            length: Number(part.dimensions_mm?.x || part.dims?.x || 0),
            width: Number(part.dimensions_mm?.y || part.dims?.y || 0),
            height: Number(part.dimensions_mm?.z || part.dims?.z || 0),
          },
          position_mm: part.position || [0, 0, 0],
          mass_kg: part.mass_kg || 0.5,
          volume_mm3: Math.abs((part.dimensions_mm?.x || part.dims?.x || 0) * (part.dimensions_mm?.y || part.dims?.y || 0) * (part.dimensions_mm?.z || part.dims?.z || 0)),
        },
        
        engineering: {
          tolerance_class: part.metadata?.tolerance_class || 'IT7',
          surface_finish_grade: part.metadata?.surface_finish || 'N6',
          quality_level: part.quality_grade || 'commercial',
          dfm_score: dfm.dfm_score,
          dfm_warnings: dfm.warnings.slice(0, 3),
        },
        
        manufacturing: {
          estimated_cost_usd: Number(costEst.total_cost_per_unit_usd),
          estimated_leadtime_weeks: costEst.estimated_leadtime_weeks,
          setup_cost_usd: costEst.process_cost_per_unit_usd,
          setup_time_hours: 0.5,
        },
        
        features: {
          hole_count: Array.isArray(part.holes) ? part.holes.length : 0,
          pocket_count: Array.isArray(part.pockets) ? part.pockets.length : 0,
          boss_count: Array.isArray(part.bosses) ? part.bosses.length : 0,
        },
        
        logistics: {
          packaging_volume_mm3: Math.abs((part.dimensions_mm?.x || part.dims?.x || 0) * 1.2 * (part.dimensions_mm?.y || part.dims?.y || 0) * 1.2 * (part.dimensions_mm?.z || part.dims?.z || 0) * 1.2),
          pieces_per_carton: 100,
          estimated_carton_weight_kg: 5,
        },
      };
    }),
  };
}

// ─── Material Alternatives Matrix ────────────────────────────────
export function buildMaterialAlternativesMatrix(part = {}) {
  const currentMaterial = part.material || 'aluminum_6061';
  const process = part.process || 'cnc_milling';
  
  const alternatives = [
    {
      material: 'aluminum_6061',
      relative_cost: 1.0,
      relative_mass: 1.0,
      relative_strength: 1.0,
      thermal_conductivity: 167,
      machinability: 'good',
      corrosion_resistance: 'good',
    },
    {
      material: 'steel_1020',
      relative_cost: 0.8,
      relative_mass: 1.35,
      relative_strength: 1.2,
      thermal_conductivity: 51,
      machinability: 'excellent',
      corrosion_resistance: 'fair',
    },
    {
      material: 'titanium_grade5',
      relative_cost: 8.0,
      relative_mass: 0.56,
      relative_strength: 1.5,
      thermal_conductivity: 7,
      machinability: 'fair',
      corrosion_resistance: 'excellent',
    },
    {
      material: 'copper_beryllium',
      relative_cost: 15.0,
      relative_mass: 0.8,
      relative_strength: 0.9,
      thermal_conductivity: 150,
      machinability: 'excellent',
      corrosion_resistance: 'excellent',
    },
  ];
  
  return {
    current_material: currentMaterial,
    process: process,
    alternatives: alternatives.map((alt) => ({
      ...alt,
      compatibility_with_process: ['cnc', 'casting', 'forging'].some((p) => process.includes(p)) ? 'yes' : 'check',
      supplier_availability: 'check',
    })),
  };
}

// ─── Assembly Instructions Builder ──────────────────────────────
export function buildDetailedAssemblyInstructions(assemblyDocument = {}, interfaces = []) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  
  // Topological sort of assembly
  const visited = new Set();
  const assembled = [];
  
  function dfs(partId) {
    if (visited.has(partId)) return;
    visited.add(partId);
    
    // Find parts that must be assembled before this one
    for (const intf of interfaces) {
      if (intf.part_b === partId && !visited.has(intf.part_a)) {
        dfs(intf.part_a);
      }
    }
    
    assembled.push(partId);
  }
  
  for (const part of parts) {
    dfs(part.id);
  }
  
  const partMap = new Map(parts.map((p) => [p.id, p]));
  
  return {
    generated_at: new Date().toISOString(),
    assembly_sequence: assembled.map((partId, step) => {
      const part = partMap.get(partId);
      const deps = interfaces.filter((i) => i.part_b === partId);
      
      return {
        step: step + 1,
        part_id: partId,
        part_name: part?.name || partId,
        action: deps.length === 0 ? 'place_on_workbench' : 'attach_to_assembly',
        estimated_time_minutes: deps.length > 0 ? 3 : 1,
        tools_required: deps.some((d) => d.type === 'bolted') ? ['hex_key', 'torque_wrench'] : [],
        fixtures_required: step === 0 ? ['assembly_jig'] : [],
        quality_checkpoints: deps.length > 0 ? ['alignment', 'torque_verification'] : ['placement'],
        interfaces: deps.map((intf) => ({
          type: intf.type,
          part_a: intf.part_a,
          fastener_count: 1,
        })),
      };
    }),
    total_estimated_time_minutes: assembled.length * 2,
  };
}

// ─── Design Variation Analysis ──────────────────────────────────
export function buildDesignVariationMatrix(plan = {}, assembly = {}) {
  return {
    generated_at: new Date().toISOString(),
    base_design: {
      configuration_name: plan.name || 'Base Configuration',
      part_count: Array.isArray(assembly.parts) ? assembly.parts.length : 0,
      estimated_cost_usd: 1000,
      estimated_mass_kg: 5,
    },
    variations: [
      {
        configuration_name: 'Lightweight (Titanium)',
        changes: [{ parameter: 'material_substitution', value: 'titanium for steel' }],
        estimated_cost_delta_usd: 5000,
        estimated_mass_delta_kg: -2,
        estimated_lead_time_weeks: 6,
      },
      {
        configuration_name: 'Cost-Optimized (Injection Molded)',
        changes: [{ parameter: 'process_substitution', value: 'injection_molding for cnc' }],
        estimated_cost_delta_usd: -300,
        estimated_mass_delta_kg: 0,
        estimated_lead_time_weeks: 4,
      },
      {
        configuration_name: 'High-Performance (Forged + Heat Treat)',
        changes: [{ parameter: 'process_upgrade', value: 'forging_with_heattreat' }],
        estimated_cost_delta_usd: 200,
        estimated_mass_delta_kg: 0.5,
        estimated_lead_time_weeks: 8,
      },
    ],
  };
}

// ─── Supply Chain Risk Assessment ────────────────────────────────
export function buildSupplyChainRisk(assembly = {}) {
  const parts = Array.isArray(assembly.parts) ? assembly.parts : [];
  
  return {
    generated_at: new Date().toISOString(),
    critical_materials: parts
      .filter((p) => ['titanium', 'rare_earth', 'beryllium'].some((m) => String(p.material).includes(m)))
      .map((p) => ({
        part_id: p.id,
        material: p.material,
        risk_level: 'high',
        alternative_sources: 2,
        leadtime_weeks: 12,
      })),
    supplier_concentration: {
      material_suppliers: 5,
      process_suppliers: 8,
      geographic_concentration: 'moderate',
    },
    recommendations: [
      'Identify second-source suppliers for critical materials',
      'Consider strategic inventory of long-lead components',
      'Evaluate alternative materials for risk mitigation',
    ],
  };
}

export default {
  buildPartEnvelopeCatalog,
  buildParetoTradeoffs,
  buildPartDetailManifest,
  buildMaterialAlternativesMatrix,
  buildDetailedAssemblyInstructions,
  buildDesignVariationMatrix,
  buildSupplyChainRisk,
};

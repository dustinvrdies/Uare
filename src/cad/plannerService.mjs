/**
 * Integration layer: main CAD/assembly planner service
 * Orchestrates all modules (topology, routing, 3D generation, visualization, validation)
 */

import * as topology from './topologyOptimization.mjs';
import * as routing from './routingEngine.mjs';
import * as geometry from './geometryGeneration.mjs';
import * as visualization from './enhancedVisualization.mjs';
import * as validation from './dataValidation.mjs';

export class CADPlannerService {
  constructor(options = {}) {
    this.options = {
      enable_topology_optimization: options.enable_topology_optimization !== false,
      enable_routing: options.enable_routing !== false,
      enable_fea: options.enable_fea !== false,
      enable_visualization: options.enable_visualization !== false,
      log_level: options.log_level || 'info',
      ...options,
    };
    this.plans = new Map();
    this.cache = new Map();
    this.history = [];
  }
  
  generatePlan(spec = {}, constraints = {}) {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Step 1: Topology generation
    let topoResult = null;
    if (this.options.enable_topology_optimization) {
      topoResult = topology.generateTopology(spec);
    }
    
    // Step 2: Routing (electrical, thermal, fluid)
    let routingResult = null;
    if (this.options.enable_routing) {
      const routeSpec = topoResult?.topology || spec;
      routingResult = routing.optimizeRouting(routeSpec, constraints.routing || {});
    }
    
    // Step 3: Geometry generation
    const geomSpec = routingResult?.routed || topoResult?.topology || spec;
    const geometryResult = geometry.generateGeometry(geomSpec);
    
    // Step 4: Validation
    const validation_result = validation.validateAndNormalize(geometryResult.plan);
    
    if (!validation_result.success) {
      return {
        success: false,
        plan_id: planId,
        error: 'Validation failed',
        details: validation_result.errors,
      };
    }
    
    const plan = validation_result.plan;
    
    // Step 5: Generate documentation and visualizations
    const docs = validation.generateManufacturingDocumentation(plan);
    const visualization_manifest = visualization.buildVisualizationManifest(plan, this.options);
    
    // Create plan object
    const planObject = {
      id: planId,
      created_at: new Date().toISOString(),
      spec,
      constraints,
      topology: topoResult,
      routing: routingResult,
      geometry: geometryResult,
      validation: validation_result,
      manufacturing: docs,
      visualization: visualization_manifest,
      status: 'generated',
    };
    
    this.plans.set(planId, planObject);
    this.history.push({
      timestamp: new Date().toISOString(),
      action: 'plan_generated',
      plan_id: planId,
    });
    
    return {
      success: true,
      plan_id: planId,
      plan: planObject,
    };
  }
  
  analyzePlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan) {
      return { success: false, error: 'Plan not found' };
    }
    
    const analysis = {
      plan_id: planId,
      generated_at: new Date().toISOString(),
      overview: {
        part_count: plan.geometry.plan.parts?.length || 0,
        total_volume_mm3: this.calculateTotalVolume(plan.geometry.plan),
        assembly_complexity: this.estimateComplexity(plan.geometry.plan),
        estimated_cost_tier: this.estimateCost(plan.geometry.plan),
      },
      manufacturing: {
        bom: plan.manufacturing.documentation.bom,
        drc_status: plan.manufacturing.documentation.drc_report.summary.drc_status,
        drc_violations: plan.manufacturing.documentation.drc_report.summary.error_count,
        drc_warnings: plan.manufacturing.documentation.drc_report.summary.warning_count,
      },
      routing: plan.routing ? {
        electrical_routes: plan.routing.electrical_routes?.length || 0,
        thermal_routes: plan.routing.thermal_routes?.length || 0,
        routed_length_mm: this.calculateRoutedLength(plan.routing),
      } : null,
      visualization: {
        animation_duration_ms: plan.visualization.assembly_animation?.total_duration_ms || 0,
        explode_factor: 5,
        part_visualizations: plan.visualization.part_visualizations?.length || 0,
      },
    };
    
    return {
      success: true,
      analysis,
    };
  }
  
  calculateTotalVolume(plan) {
    let total = 0;
    for (const part of plan.parts || []) {
      const dims = part.dims || { x: 0, y: 0, z: 0 };
      total += dims.x * dims.y * dims.z * (part.quantity || 1);
    }
    return total;
  }
  
  calculateRoutedLength(routing) {
    let total = 0;
    for (const route of routing.electrical_routes || []) {
      if (route.path) {
        for (let i = 0; i < route.path.length - 1; i++) {
          const p1 = route.path[i];
          const p2 = route.path[i + 1];
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const dz = p2[2] - p1[2];
          total += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      }
    }
    return total;
  }
  
  estimateComplexity(plan) {
    const partCount = plan.parts?.length || 0;
    const interfaceCount = plan.interfaces?.length || 0;
    
    if (partCount < 5) return 'simple';
    if (partCount < 50 && interfaceCount < 100) return 'moderate';
    if (partCount < 200 && interfaceCount < 500) return 'complex';
    return 'very_complex';
  }
  
  estimateCost(plan) {
    const materials = {};
    for (const part of plan.parts || []) {
      const material = part.material || 'unknown';
      materials[material] = (materials[material] || 0) + (part.quantity || 1);
    }
    
    const costFactors = {
      titanium: 10,
      copper: 5,
      aluminum_6061: 2,
      steel: 1,
      plastic: 0.5,
    };
    
    let totalCost = 0;
    for (const [material, qty] of Object.entries(materials)) {
      totalCost += qty * (costFactors[material] || 1);
    }
    
    if (totalCost < 100) return 'low';
    if (totalCost < 500) return 'medium';
    if (totalCost < 2000) return 'high';
    return 'very_high';
  }
  
  exportPlan(planId, format = 'json') {
    const plan = this.plans.get(planId);
    if (!plan) {
      return { success: false, error: 'Plan not found' };
    }
    
    const formats = {
      json: () => JSON.stringify(plan, null, 2),
      compact: () => JSON.stringify({
        id: plan.id,
        parts: plan.geometry.plan.parts,
        interfaces: plan.geometry.plan.interfaces,
      }),
      csv: () => this.planToCSV(plan),
      xml: () => this.planToXML(plan),
    };
    
    if (!formats[format]) {
      return { success: false, error: `Unsupported format: ${format}` };
    }
    
    return {
      success: true,
      format,
      data: formats[format](),
      filename: `${plan.id}.${format}`,
    };
  }
  
  planToCSV(plan) {
    const parts = plan.geometry.plan.parts || [];
    let csv = 'ID,Name,Type,Material,Process,X_mm,Y_mm,Z_mm,Quantity\n';
    for (const part of parts) {
      const dims = part.dims || {};
      csv += `"${part.id}","${part.name || ''}","${part.type}","${part.material}","${part.process}",${dims.x || 0},${dims.y || 0},${dims.z || 0},${part.quantity || 1}\n`;
    }
    return csv;
  }
  
  planToXML(plan) {
    const parts = plan.geometry.plan.parts || [];
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<plan>\n';
    for (const part of parts) {
      xml += `  <part id="${part.id}">\n`;
      xml += `    <name>${part.name || ''}</name>\n`;
      xml += `    <type>${part.type}</type>\n`;
      xml += `    <material>${part.material}</material>\n`;
      xml += `    <process>${part.process}</process>\n`;
      const dims = part.dims || {};
      xml += `    <dimensions x="${dims.x || 0}" y="${dims.y || 0}" z="${dims.z || 0}" />\n`;
      xml += `    <quantity>${part.quantity || 1}</quantity>\n`;
      xml += `  </part>\n`;
    }
    xml += '</plan>';
    return xml;
  }
  
  listPlans() {
    return Array.from(this.plans.values()).map((p) => ({
      id: p.id,
      created_at: p.created_at,
      part_count: p.geometry.plan.parts?.length || 0,
      status: p.status,
    }));
  }
  
  getPlanSummary(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    
    return {
      id: plan.id,
      created_at: plan.created_at,
      part_count: plan.geometry.plan.parts?.length || 0,
      validation_status: plan.validation.success ? 'valid' : 'invalid',
      drc_status: plan.manufacturing.documentation.drc_report.summary.drc_status,
      status: plan.status,
    };
  }
  
  getVisualizationManifest(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    
    return plan.visualization;
  }
  
  getManufacturingDocumentation(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    
    return plan.manufacturing.documentation;
  }
}

// Factory function
export function createCADPlanner(options = {}) {
  return new CADPlannerService(options);
}

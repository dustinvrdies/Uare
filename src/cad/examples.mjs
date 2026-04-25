/**
 * Example usage of the CAD planner system
 * Demonstrates topology optimization, routing, geometry generation, and visualization
 */

import { createCADPlanner } from './plannerService.mjs';
import { startCADPlannerAPI } from './api.mjs';

// Example 1: Basic assembly planning
export function exampleBasicAssembly() {
  const planner = createCADPlanner({
    enable_topology_optimization: true,
    enable_routing: true,
    enable_visualization: true,
  });
  
  const spec = {
    assembly_name: 'Simple Motor Mount',
    design_objective: 'minimize_weight',
    parts: [
      {
        id: 'base_plate',
        name: 'Base Mounting Plate',
        type: 'structural',
        material: 'aluminum_6061',
        process: 'cnc_milling',
        dims: { x: 200, y: 150, z: 10 },
        quantity: 1,
      },
      {
        id: 'motor_bracket',
        name: 'Motor Bracket',
        type: 'structural',
        material: 'steel',
        process: 'welding',
        dims: { x: 100, y: 100, z: 50 },
        quantity: 1,
      },
      {
        id: 'connector_bolt',
        name: 'M8 Connector Bolt',
        type: 'fastener',
        material: 'steel',
        process: 'threading',
        dims: { x: 8, y: 8, z: 30 },
        quantity: 4,
      },
    ],
    interfaces: [
      { part_a: 'base_plate', part_b: 'motor_bracket', type: 'bolted', strength: 'high' },
      { part_a: 'motor_bracket', part_b: 'connector_bolt', type: 'threaded', strength: 'medium' },
    ],
  };
  
  const constraints = {
    routing: {
      enable_electrical: false,
      enable_thermal: true,
      enable_fluid: false,
    },
  };
  
  const result = planner.generatePlan(spec, constraints);
  
  if (result.success) {
    console.log('Plan generated:', result.plan_id);
    
    // Analyze the plan
    const analysis = planner.analyzePlan(result.plan_id);
    console.log('Analysis:', analysis.analysis.overview);
    
    // Export the plan
    const exported = planner.exportPlan(result.plan_id, 'json');
    console.log('Export:', exported.filename);
    
    // Get visualization manifest
    const viz = planner.getVisualizationManifest(result.plan_id);
    console.log('Visualization viewport:', viz.viewport_config);
  } else {
    console.error('Plan generation failed:', result.details);
  }
}

// Example 2: Electronic device assembly
export function exampleElectronicAssembly() {
  const planner = createCADPlanner({
    enable_topology_optimization: true,
    enable_routing: true,
    enable_visualization: true,
  });
  
  const spec = {
    assembly_name: 'Wireless IoT Sensor Hub',
    design_objective: 'minimize_cost',
    parts: [
      {
        id: 'pcb_main',
        name: 'Main PCB',
        type: 'electronics',
        material: 'fr4',
        process: '3d_print',
        dims: { x: 100, y: 80, z: 1.6 },
        position: [0, 0, 0],
        quantity: 1,
      },
      {
        id: 'enclosure_top',
        name: 'Enclosure Top',
        type: 'structural',
        material: 'plastic',
        process: 'injection_molding',
        dims: { x: 110, y: 90, z: 40 },
        position: [0, 0, 20],
        quantity: 1,
      },
      {
        id: 'enclosure_bottom',
        name: 'Enclosure Bottom',
        type: 'structural',
        material: 'plastic',
        process: 'injection_molding',
        dims: { x: 110, y: 90, z: 40 },
        position: [0, 0, -20],
        quantity: 1,
      },
      {
        id: 'antenna',
        name: 'WiFi Antenna',
        type: 'electronics',
        material: 'copper',
        process: 'stamping',
        dims: { x: 5, y: 5, z: 40 },
        position: [50, 40, 30],
        quantity: 1,
      },
    ],
    interfaces: [
      { part_a: 'pcb_main', part_b: 'enclosure_top', type: 'press_fit', strength: 'medium' },
      { part_a: 'pcb_main', part_b: 'enclosure_bottom', type: 'press_fit', strength: 'medium' },
      { part_a: 'pcb_main', part_b: 'antenna', type: 'soldered', strength: 'high' },
    ],
  };
  
  const constraints = {
    routing: {
      enable_electrical: true,
      enable_thermal: true,
      enable_fluid: false,
      thermal_limit_celsius: 60,
    },
  };
  
  const result = planner.generatePlan(spec, constraints);
  
  if (result.success) {
    console.log('Electronic assembly plan generated:', result.plan_id);
    
    // Get manufacturing documentation
    const docs = planner.getManufacturingDocumentation(result.plan_id);
    console.log('BOM:', docs.bom);
    console.log('DRC Status:', docs.drc_report.summary.drc_status);
  }
}

// Example 3: API server startup
export function startAPIServer() {
  console.log('Starting CAD Planner API server...');
  
  const api = startCADPlannerAPI({
    port: 3000,
    enable_topology_optimization: true,
    enable_routing: true,
    enable_visualization: true,
  });
  
  console.log('API server is running');
  console.log('Endpoints:');
  console.log('  GET  /plans - List all plans');
  console.log('  POST /plans - Generate new plan');
  console.log('  GET  /plans/:planId - Get plan details');
  console.log('  GET  /plans/:planId/analysis - Analyze plan');
  console.log('  GET  /plans/:planId/visualization - Get visualization');
  console.log('  GET  /plans/:planId/manufacturing - Get manufacturing docs');
  console.log('  POST /plans/:planId/export - Export plan');
  console.log('  GET  /health - Health check');
  
  // Example: Create a plan via API (simulated)
  setTimeout(() => {
    const planRequest = {
      spec: {
        assembly_name: 'Test Assembly',
        parts: [
          {
            id: 'part1',
            type: 'structural',
            material: 'aluminum_6061',
            process: 'cnc_milling',
            dims: { x: 100, y: 100, z: 50 },
            quantity: 1,
          },
        ],
      },
      constraints: {},
    };
    
    const result = api.planner.generatePlan(planRequest.spec, planRequest.constraints);
    console.log('Plan created via API:', result.plan_id);
  }, 1000);
}

// Example 4: Complex multi-constraint optimization
export function exampleMultiConstraintOptimization() {
  const planner = createCADPlanner({
    enable_topology_optimization: true,
    enable_routing: true,
    enable_visualization: true,
  });
  
  const spec = {
    assembly_name: 'Aerospace Bracket Assembly',
    design_objective: 'minimize_weight_under_stress',
    parts: [
      {
        id: 'titanium_bracket',
        name: 'Main Bracket',
        type: 'structural',
        material: 'titanium',
        process: 'cnc_milling',
        dims: { x: 150, y: 100, z: 50 },
        quantity: 1,
      },
      {
        id: 'aluminum_reinforcement',
        name: 'Reinforcement Gusset',
        type: 'structural',
        material: 'aluminum_6061',
        process: 'cnc_milling',
        dims: { x: 80, y: 80, z: 10 },
        quantity: 2,
      },
      {
        id: 'fastener_kit',
        name: 'Fastener Kit',
        type: 'fastener',
        material: 'steel',
        process: 'threading',
        dims: { x: 6, y: 6, z: 20 },
        quantity: 12,
      },
    ],
    interfaces: [
      {
        part_a: 'titanium_bracket',
        part_b: 'aluminum_reinforcement',
        type: 'bolted',
        strength: 'high',
        tolerance_um: 50,
      },
      {
        part_a: 'aluminum_reinforcement',
        part_b: 'fastener_kit',
        type: 'threaded',
        strength: 'high',
        tolerance_um: 100,
      },
    ],
  };
  
  const constraints = {
    routing: {
      enable_electrical: false,
      enable_thermal: true,
      thermal_limit_celsius: 80,
      enable_fluid: false,
    },
    structural: {
      max_stress_mpa: 400,
      safety_factor: 2.0,
      load_cases: [
        { name: 'launch', multiplier: 3.5 },
        { name: 'cruise', multiplier: 1.0 },
      ],
    },
  };
  
  const result = planner.generatePlan(spec, constraints);
  
  if (result.success) {
    const analysis = planner.analyzePlan(result.plan_id);
    console.log('Aerospace assembly analysis:');
    console.log('  Complexity:', analysis.analysis.overview.assembly_complexity);
    console.log('  Cost tier:', analysis.analysis.overview.estimated_cost_tier);
    console.log('  DRC violations:', analysis.analysis.manufacturing.drc_violations);
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('CAD Planner Examples\n');
  
  console.log('=== Example 1: Basic Assembly ===');
  exampleBasicAssembly();
  
  console.log('\n=== Example 2: Electronic Assembly ===');
  exampleElectronicAssembly();
  
  console.log('\n=== Example 3: Multi-Constraint Optimization ===');
  exampleMultiConstraintOptimization();
  
  console.log('\n=== Example 4: API Server ===');
  // Uncomment to start API server
  // startAPIServer();
}

export { exampleBasicAssembly, exampleElectronicAssembly, exampleMultiConstraintOptimization, startAPIServer };

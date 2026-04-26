/**
 * Test Suite for Simulation Preparation Module
 */

import {
  generateFEAConfiguration,
  generateNASTRANBulkData,
  generateABAQUSModelDefinition,
  generateMeshSettings,
  generateRefinedSTL,
  generateBoundaryConditions,
  generateSolverConfig,
} from '../src/cad/simulationPreparation.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  SIMULATION PREPARATION TEST SUITE                        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const test_part = {
  id: 'test_bracket',
  dims: { x: 100, y: 50, z: 20 },
  material: 'aluminum_6061',
};

// Test 1: FEA Configuration Generation
console.log('Test 1: FEA Configuration Generation...');
const fea_static = generateFEAConfiguration(test_part, 'static');
assert(fea_static.configuration.analysis_type === 'STATIC', 'Should be static analysis');
assert(fea_static.mesh_settings, 'Should have mesh settings');
assert(fea_static.output_requests, 'Should have output requests');
console.log(`✓ Static analysis config generated`);

const fea_modal = generateFEAConfiguration(test_part, 'modal');
assert(fea_modal.configuration.num_modes === 20, 'Should request 20 modes');
console.log(`✓ Modal analysis config generated`);

const fea_thermal = generateFEAConfiguration(test_part, 'thermal');
assert(fea_thermal.configuration.analysis_type === 'THERMAL', 'Should be thermal');
console.log(`✓ Thermal analysis config generated\n`);

// Test 2: NASTRAN Bulk Data Generation
console.log('Test 2: NASTRAN Bulk Data Generation...');
const nastran_code = generateNASTRANBulkData(test_part, { force_n: 1000, temperature_c: 50 });
assert(typeof nastran_code === 'string', 'Should return string');
assert(nastran_code.includes('MAT1'), 'Should include material definition');
assert(nastran_code.includes('FORCE'), 'Should include force load');
assert(nastran_code.includes('TEMP'), 'Should include temperature');
console.log(`✓ NASTRAN code generated (${nastran_code.length} chars)`);
console.log(`✓ Includes: Material, BC, Loads\n`);

// Test 3: ABAQUS Model Definition
console.log('Test 3: ABAQUS Model Definition Generation...');
const abaqus_static = generateABAQUSModelDefinition(test_part, 'static');
assert(typeof abaqus_static === 'string', 'Should return string');
assert(abaqus_static.includes('StaticStep'), 'Should include static step');
assert(abaqus_static.includes('Material'), 'Should define material');
console.log(`✓ ABAQUS static script generated`);

const abaqus_modal = generateABAQUSModelDefinition(test_part, 'modal');
assert(abaqus_modal.includes('FrequencyStep'), 'Should include modal step');
console.log(`✓ ABAQUS modal script generated\n`);

// Test 4: Mesh Settings Generation
console.log('Test 4: Mesh Settings Generation...');
const mesh_ansys = generateMeshSettings(test_part, 'ansys');
assert(mesh_ansys.mesh_parameters, 'Should have ANSYS parameters');
assert(mesh_ansys.estimated_element_count > 0, 'Should estimate element count');
assert(mesh_ansys.estimated_computation_time_minutes > 0, 'Should estimate time');
console.log(`✓ ANSYS mesh: ${mesh_ansys.estimated_element_count} elements, ~${mesh_ansys.estimated_computation_time_minutes} min`);

const mesh_abaqus = generateMeshSettings(test_part, 'abaqus');
assert(mesh_abaqus.mesh_parameters.element_type === 'C3D10M', 'Should specify ABAQUS element type');
console.log(`✓ ABAQUS mesh: Element type ${mesh_abaqus.mesh_parameters.element_type}`);

const mesh_fluent = generateMeshSettings(test_part, 'cfd_fluent');
assert(mesh_fluent.mesh_parameters.inflation_layers > 0, 'Should have boundary layers');
console.log(`✓ FLUENT mesh: ${mesh_fluent.mesh_parameters.inflation_layers} boundary layers\n`);

// Test 5: Refined STL Generation
console.log('Test 5: Refined STL Generation...');
for (let level = 0; level < 4; level++) {
  const stl_config = generateRefinedSTL(test_part, level);
  assert(stl_config.mesh_statistics.total_triangles > 0, `Level ${level} should have triangles`);
  assert(stl_config.quality_level, `Level ${level} should have quality level`);
  console.log(`✓ Level ${level} (${stl_config.quality_level}): ${stl_config.mesh_statistics.total_triangles} triangles, ${stl_config.mesh_statistics.file_size_mb} MB`);
}
console.log('');

// Test 6: Boundary Conditions Generation
console.log('Test 6: Boundary Conditions Generation...');
const bc_standard = generateBoundaryConditions(test_part, 'standard');
assert(bc_standard.constraints.length > 0, 'Should have constraints');
assert(bc_standard.loads.length > 0, 'Should have loads');
console.log(`✓ Standard: ${bc_standard.constraints.length} constraints, ${bc_standard.loads.length} loads`);

const bc_high_stress = generateBoundaryConditions(test_part, 'high_stress');
assert(bc_high_stress.nonlinear === true, 'High stress should have nonlinear flag');
console.log(`✓ High stress: Nonlinear=${bc_high_stress.nonlinear}`);

const bc_vibration = generateBoundaryConditions(test_part, 'vibration');
assert(bc_vibration.analysis_type.includes('modal'), 'Vibration should include modal');
console.log(`✓ Vibration: Analysis type=${bc_vibration.analysis_type}`);

const bc_thermal = generateBoundaryConditions(test_part, 'thermal');
assert(bc_thermal.analysis_type === 'thermal', 'Should be thermal analysis');
console.log(`✓ Thermal: Analysis type=${bc_thermal.analysis_type}\n`);

// Test 7: Solver Configuration
console.log('Test 7: Solver Configuration...');
const config_ansys = generateSolverConfig({ solver: 'ansys', max_iterations: 1000 });
assert(config_ansys.configuration.includes('ANSYS'), 'Should include ANSYS config');
console.log(`✓ ANSYS config generated`);

const config_abaqus = generateSolverConfig({ solver: 'abaqus', time_steps: 10 });
assert(config_abaqus.configuration.includes('Step'), 'Should include step definition');
console.log(`✓ ABAQUS config generated`);

const config_nastran = generateSolverConfig({ solver: 'nastran' });
assert(config_nastran.configuration.includes('SOL 101'), 'Should include NASTRAN SOL');
console.log(`✓ NASTRAN config generated\n`);

// Test 8: Complete Simulation Package
console.log('Test 8: Complete Simulation Package...');
const complete_package = {
  fea_config: generateFEAConfiguration(test_part, 'static'),
  mesh_settings: generateMeshSettings(test_part, 'ansys'),
  boundary_conditions: generateBoundaryConditions(test_part, 'standard'),
  solver_config: generateSolverConfig({ solver: 'ansys' }),
};
assert(complete_package.fea_config, 'Should have FEA config');
assert(complete_package.mesh_settings, 'Should have mesh settings');
assert(complete_package.boundary_conditions, 'Should have BC');
assert(complete_package.solver_config, 'Should have solver config');
console.log(`✓ Complete simulation package assembled`);
console.log(`✓ Components: FEA config, mesh, BC, solver settings\n`);

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  ✅ ALL SIMULATION PREPARATION TESTS PASSED                ║');
console.log('╚════════════════════════════════════════════════════════════╝');

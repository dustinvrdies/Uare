/**
 * Comprehensive Test Suite for Material Properties Database
 */

import {
  MATERIAL_DATABASE,
  getMaterialProperties,
  getAllMaterials,
  calculateSafetyFactors,
  getDerateFactor,
  assessEnvironmentalDegradation,
  analyzeThermalPerformance,
  analyzeVibrationResponse,
} from '../src/cad/materialPropertiesDatabase.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  MATERIAL PROPERTIES DATABASE TEST SUITE                  ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Material Database Integrity
console.log('Test 1: Material Database Integrity...');
const materials = getAllMaterials();
assert(materials.length > 8, 'Should have at least 8 materials');
console.log(`✓ Total materials: ${materials.length}`);

for (const material_name of materials.slice(0, 3)) {
  const mat = getMaterialProperties(material_name);
  assert(mat, `Should retrieve ${material_name}`);
  assert(mat.density_kg_m3 > 0, 'Should have positive density');
  assert(mat.young_modulus_mpa > 0, 'Should have positive modulus');
  assert(mat.yield_strength_mpa > 0, 'Should have positive yield');
  assert(mat.cost_per_kg_usd > 0, 'Should have positive cost');
  console.log(`✓ ${material_name}: density=${mat.density_kg_m3}, E=${mat.young_modulus_mpa} MPa`);
}
console.log('');

// Test 2: Safety Factor Calculation
console.log('Test 2: Safety Factor Calculation...');
const safety_static = calculateSafetyFactors('aluminum_6061', 'static');
assert(safety_static.factors.yield > 1, 'Yield safety factor should be > 1');
assert(safety_static.factors.ultimate > safety_static.factors.yield, 'Ultimate should be > yield');
console.log(`✓ Static safety factors: yield=${safety_static.factors.yield}, ultimate=${safety_static.factors.ultimate}`);

const safety_fatigue = calculateSafetyFactors('aluminum_6061', 'fatigue');
assert(safety_fatigue.factors.endurance > 0, 'Should have endurance factor');
console.log(`✓ Fatigue safety factors: endurance=${safety_fatigue.factors.endurance}\n`);

// Test 3: Temperature Derating
console.log('Test 3: Temperature Derating...');
const derate_cold = getDerateFactor('aluminum_6061', -50);
const derate_room = getDerateFactor('aluminum_6061', 25);
const derate_hot = getDerateFactor('aluminum_6061', 200);
assert(derate_cold < 1.0, 'Cold should have some derating');
assert(derate_room === 1.0, 'Room temp should be no derating');
assert(derate_hot < 1.0, 'Hot should have derating');
console.log(`✓ Cold (-50°C): ${(derate_cold * 100).toFixed(1)}%`);
console.log(`✓ Room (25°C): ${(derate_room * 100).toFixed(1)}%`);
console.log(`✓ Hot (200°C): ${(derate_hot * 100).toFixed(1)}%\n`);

// Test 4: Environmental Degradation Assessment
console.log('Test 4: Environmental Degradation...');
const env_dry = assessEnvironmentalDegradation('aluminum_6061', 'dry_indoor');
const env_marine = assessEnvironmentalDegradation('aluminum_6061', 'marine');
assert(env_dry.annual_degradation_percent > 0, 'Should calculate degradation');
assert(env_marine.annual_degradation_percent > env_dry.annual_degradation_percent, 'Marine should degrade faster');
console.log(`✓ Dry indoor: ${env_dry.annual_degradation_percent}% per year, lifespan ~${env_dry.estimated_lifespan_years} years`);
console.log(`✓ Marine: ${env_marine.annual_degradation_percent}% per year, lifespan ~${env_marine.estimated_lifespan_years} years`);
console.log(`✓ Marine recommendation: ${env_marine.mitigation}\n`);

// Test 5: Thermal Performance Analysis
console.log('Test 5: Thermal Performance Analysis...');
const thermal = analyzeThermalPerformance('aluminum_6061', 100, 0.01, 25);
assert(thermal.power_dissipated_w === 100, 'Should track power');
assert(thermal.temperature_rise_c > 0, 'Should calculate temperature rise');
assert(thermal.material_surface_temp_c > 25, 'Surface should be above ambient');
console.log(`✓ Power dissipated: ${thermal.power_dissipated_w}W`);
console.log(`✓ Temperature rise: ${thermal.temperature_rise_c}°C`);
console.log(`✓ Surface temp: ${thermal.material_surface_temp_c}°C`);
console.log(`✓ Suitable: ${thermal.suitable ? 'Yes' : 'No'}\n`);

// Test 6: Vibration Response Analysis
console.log('Test 6: Vibration Response Analysis...');
const vibration = analyzeVibrationResponse('aluminum_6061', { x: 100, y: 50, z: 20 }, 2.5);
assert(vibration.estimated_natural_frequency_hz > 0, 'Should calculate natural frequency');
assert(vibration.damping_ratio > 0 && vibration.damping_ratio < 1, 'Damping should be 0-1');
assert(vibration.quality_factor_q > 0, 'Q factor should be positive');
console.log(`✓ Natural frequency: ${vibration.estimated_natural_frequency_hz} Hz`);
console.log(`✓ Damping ratio: ${vibration.damping_ratio}`);
console.log(`✓ Q factor: ${vibration.quality_factor_q}`);
console.log(`✓ Resonance range: ${vibration.resonance_avoidance_range_hz.lower}-${vibration.resonance_avoidance_range_hz.upper} Hz\n`);

// Test 7: Material Comparison
console.log('Test 7: Material Strength Comparison...');
const aluminum = getMaterialProperties('aluminum_6061');
const steel = getMaterialProperties('steel_mild');
const titanium = getMaterialProperties('titanium_grade5');

assert(titanium.yield_strength_mpa > steel.yield_strength_mpa, 'Titanium should be stronger than steel');
assert(steel.density_kg_m3 > aluminum.density_kg_m3, 'Steel should be denser than aluminum');
assert(aluminum.machinability_rating > titanium.machinability_rating, 'Aluminum should machine better');

console.log(`✓ Strongest: ${titanium.yield_strength_mpa} MPa (Ti-Gr5)`);
console.log(`✓ Lightest: ${aluminum.density_kg_m3} kg/m³ (Al-6061)`);
console.log(`✓ Most machinable: ${aluminum.machinability_rating} (Al-6061)\n`);

// Test 8: Material Selection Guidance
console.log('Test 8: Application-Specific Guidance...');
const aerospace_material = getMaterialProperties('titanium_grade5');
assert(aerospace_material.corrosion_resistance > 0.95, 'Aerospace material should have high corrosion resistance');
assert(aerospace_material.yield_strength_mpa > 800, 'Aerospace material should have high strength');
console.log(`✓ Aerospace (Ti-Gr5): Strength=${aerospace_material.yield_strength_mpa}, Corrosion=${aerospace_material.corrosion_resistance}`);

const consumer_material = getMaterialProperties('abs_plastic');
assert(consumer_material.cost_per_kg_usd < 5, 'Consumer material should be low cost');
assert(consumer_material.machinability_rating > 0.8, 'Consumer material should machine easily');
console.log(`✓ Consumer (ABS): Cost=$${consumer_material.cost_per_kg_usd}/kg, Machinability=${consumer_material.machinability_rating}\n`);

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  ✅ ALL MATERIAL DATABASE TESTS PASSED                     ║');
console.log('╚════════════════════════════════════════════════════════════╝');

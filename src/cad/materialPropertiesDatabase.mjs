/**
 * Comprehensive Material Properties Database
 * Real-world engineering material specifications with physics properties
 */

// ─── Material Database with Complete Properties ──────────────────
export const MATERIAL_DATABASE = {
  // Aluminum Alloys
  aluminum_6061: {
    density_kg_m3: 2700,
    young_modulus_mpa: 69000,
    poisson_ratio: 0.33,
    yield_strength_mpa: 275,
    tensile_strength_mpa: 310,
    elongation_percent: 17,
    fatigue_limit_mpa: 110,
    thermal_conductivity_w_mk: 167,
    thermal_expansion_1e6_k: 23.6,
    specific_heat_j_kg_k: 896,
    electrical_conductivity_percent_iacs: 43,
    vickers_hardness: 95,
    machinability_rating: 0.9,
    corrosion_resistance: 0.8,
    weldability_rating: 0.8,
    cost_per_kg_usd: 3.5,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['aerospace', 'automotive', 'consumer_electronics'],
    casting_temperature_c: 640,
    annealing_temperature_c: 345,
  },

  aluminum_7075: {
    density_kg_m3: 2810,
    young_modulus_mpa: 72000,
    poisson_ratio: 0.33,
    yield_strength_mpa: 505,
    tensile_strength_mpa: 570,
    elongation_percent: 11,
    fatigue_limit_mpa: 160,
    thermal_conductivity_w_mk: 130,
    thermal_expansion_1e6_k: 23.4,
    specific_heat_j_kg_k: 960,
    electrical_conductivity_percent_iacs: 33,
    vickers_hardness: 150,
    machinability_rating: 0.6,
    corrosion_resistance: 0.5,
    weldability_rating: 0.3,
    cost_per_kg_usd: 6.2,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['aerospace', 'military', 'high_strength_structures'],
    casting_temperature_c: 755,
    annealing_temperature_c: 415,
  },

  // Steel Alloys
  steel_mild: {
    density_kg_m3: 7850,
    young_modulus_mpa: 200000,
    poisson_ratio: 0.3,
    yield_strength_mpa: 250,
    tensile_strength_mpa: 400,
    elongation_percent: 26,
    fatigue_limit_mpa: 140,
    thermal_conductivity_w_mk: 50,
    thermal_expansion_1e6_k: 12,
    specific_heat_j_kg_k: 490,
    electrical_conductivity_percent_iacs: 10,
    vickers_hardness: 80,
    machinability_rating: 0.5,
    corrosion_resistance: 0.2,
    weldability_rating: 0.95,
    cost_per_kg_usd: 1.2,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['structural', 'machinery', 'construction'],
    casting_temperature_c: 1538,
    annealing_temperature_c: 700,
  },

  steel_stainless_304: {
    density_kg_m3: 8000,
    young_modulus_mpa: 193000,
    poisson_ratio: 0.3,
    yield_strength_mpa: 215,
    tensile_strength_mpa: 505,
    elongation_percent: 70,
    fatigue_limit_mpa: 180,
    thermal_conductivity_w_mk: 16,
    thermal_expansion_1e6_k: 16,
    specific_heat_j_kg_k: 500,
    electrical_conductivity_percent_iacs: 3.3,
    vickers_hardness: 150,
    machinability_rating: 0.4,
    corrosion_resistance: 0.95,
    weldability_rating: 0.9,
    cost_per_kg_usd: 2.8,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['medical', 'food_processing', 'marine'],
    casting_temperature_c: 1454,
    annealing_temperature_c: 1038,
  },

  // Titanium
  titanium_grade5: {
    density_kg_m3: 4430,
    young_modulus_mpa: 103000,
    poisson_ratio: 0.34,
    yield_strength_mpa: 880,
    tensile_strength_mpa: 950,
    elongation_percent: 14,
    fatigue_limit_mpa: 290,
    thermal_conductivity_w_mk: 7.4,
    thermal_expansion_1e6_k: 8.6,
    specific_heat_j_kg_k: 523,
    electrical_conductivity_percent_iacs: 0.25,
    vickers_hardness: 330,
    machinability_rating: 0.3,
    corrosion_resistance: 0.99,
    weldability_rating: 0.7,
    cost_per_kg_usd: 15.0,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['aerospace', 'medical_implants', 'high_temperature'],
    casting_temperature_c: 1700,
    annealing_temperature_c: 704,
  },

  // Composites
  carbon_fiber_composite: {
    density_kg_m3: 1600,
    young_modulus_mpa: 150000,
    poisson_ratio: 0.25,
    yield_strength_mpa: 1200,
    tensile_strength_mpa: 1400,
    elongation_percent: 0.8,
    fatigue_limit_mpa: 500,
    thermal_conductivity_w_mk: 8,
    thermal_expansion_1e6_k: -1,
    specific_heat_j_kg_k: 710,
    electrical_conductivity_percent_iacs: 5,
    vickers_hardness: 400,
    machinability_rating: 0.2,
    corrosion_resistance: 0.95,
    weldability_rating: 0,
    cost_per_kg_usd: 25.0,
    recyclable: false,
    rohs_compliant: true,
    common_applications: ['aerospace', 'sports_equipment', 'automotive_racing'],
    casting_temperature_c: 0,
    annealing_temperature_c: 0,
  },

  // Polymers
  nylon_reinforced: {
    density_kg_m3: 1350,
    young_modulus_mpa: 8000,
    poisson_ratio: 0.4,
    yield_strength_mpa: 70,
    tensile_strength_mpa: 90,
    elongation_percent: 20,
    fatigue_limit_mpa: 15,
    thermal_conductivity_w_mk: 0.25,
    thermal_expansion_1e6_k: 80,
    specific_heat_j_kg_k: 1670,
    electrical_conductivity_percent_iacs: 0,
    vickers_hardness: 85,
    machinability_rating: 0.85,
    corrosion_resistance: 0.95,
    weldability_rating: 0.5,
    cost_per_kg_usd: 5.0,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['consumer_electronics', 'automotive_interior', 'bearings'],
    casting_temperature_c: 280,
    annealing_temperature_c: 80,
  },

  abs_plastic: {
    density_kg_m3: 1050,
    young_modulus_mpa: 2300,
    poisson_ratio: 0.35,
    yield_strength_mpa: 40,
    tensile_strength_mpa: 55,
    elongation_percent: 40,
    fatigue_limit_mpa: 8,
    thermal_conductivity_w_mk: 0.2,
    thermal_expansion_1e6_k: 70,
    specific_heat_j_kg_k: 1380,
    electrical_conductivity_percent_iacs: 0,
    vickers_hardness: 60,
    machinability_rating: 0.95,
    corrosion_resistance: 0.8,
    weldability_rating: 0.6,
    cost_per_kg_usd: 2.5,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['consumer_products', 'automotive_trim', 'appliances'],
    casting_temperature_c: 230,
    annealing_temperature_c: 80,
  },

  // Cast Iron
  cast_iron_ductile: {
    density_kg_m3: 7100,
    young_modulus_mpa: 169000,
    poisson_ratio: 0.3,
    yield_strength_mpa: 350,
    tensile_strength_mpa: 450,
    elongation_percent: 12,
    fatigue_limit_mpa: 160,
    thermal_conductivity_w_mk: 42,
    thermal_expansion_1e6_k: 11.9,
    specific_heat_j_kg_k: 550,
    electrical_conductivity_percent_iacs: 8,
    vickers_hardness: 170,
    machinability_rating: 0.7,
    corrosion_resistance: 0.3,
    weldability_rating: 0.4,
    cost_per_kg_usd: 1.5,
    recyclable: true,
    rohs_compliant: true,
    common_applications: ['machinery', 'automotive_engines', 'valves'],
    casting_temperature_c: 1450,
    annealing_temperature_c: 550,
  },
};

// ─── Material Selection Helper ────────────────────────────────────
export function getMaterialProperties(material_name) {
  return MATERIAL_DATABASE[material_name] || null;
}

export function getAllMaterials() {
  return Object.keys(MATERIAL_DATABASE);
}

// ─── Calculate Safety Factors ────────────────────────────────────
export function calculateSafetyFactors(material_name, load_type = 'static') {
  const material = MATERIAL_DATABASE[material_name];
  if (!material) return null;

  const safety_factors = {
    static: {
      ultimate: 3.0,
      yield: 2.0,
    },
    fatigue: {
      ultimate: 5.0,
      endurance: 3.0,
    },
    impact: {
      ultimate: 4.0,
      yield: 2.5,
    },
    thermal: {
      creep: 2.0,
      thermal_stress: 1.5,
    },
  };

  return {
    load_type,
    factors: safety_factors[load_type] || safety_factors.static,
    allowable_stress_yield_mpa: material.yield_strength_mpa / (safety_factors[load_type]?.yield || 2.0),
    allowable_stress_ultimate_mpa: material.tensile_strength_mpa / (safety_factors[load_type]?.ultimate || 3.0),
  };
}

// ─── Temperature Derating ────────────────────────────────────────
export function getDerateFactor(material_name, temperature_c) {
  const material = MATERIAL_DATABASE[material_name];
  if (!material) return 1.0;

  // Simplified derating based on temperature
  if (temperature_c < 0) {
    return Math.max(0.85, 1 - Math.abs(temperature_c) / 500);
  }

  // Most metals lose strength at elevated temperature
  if (temperature_c > 100) {
    const derate = 1 - (temperature_c - 100) / 1000;
    return Math.max(0.5, derate);
  }

  return 1.0;
}

// ─── Environmental Degradation ──────────────────────────────────
export function assessEnvironmentalDegradation(material_name, environment = 'dry_indoor') {
  const material = MATERIAL_DATABASE[material_name];
  if (!material) return null;

  const degradation_rates = {
    dry_indoor: 0.001,
    humid: 0.005,
    marine: material.corrosion_resistance < 0.7 ? 0.02 : 0.005,
    chemical: 0.015,
    uv_exposed: 0.01,
  };

  const annual_degradation = degradation_rates[environment] || 0.001;

  return {
    material: material_name,
    environment,
    annual_degradation_percent: annual_degradation * 100,
    estimated_lifespan_years: 1 / annual_degradation,
    corrosion_resistance_rating: material.corrosion_resistance,
    mitigation: material.corrosion_resistance > 0.8 ? 'No coating needed' : 'Apply protective coating',
  };
}

// ─── Thermal Performance Analysis ────────────────────────────────
export function analyzeThermalPerformance(material_name, power_w, surface_area_m2, ambient_c = 25) {
  const material = MATERIAL_DATABASE[material_name];
  if (!material) return null;

  // Simple heat transfer model: Q = h * A * ΔT
  // Assuming natural convection: h ≈ 5-25 W/m²K
  const h_natural_convection = 10;

  const heat_dissipation_capacity = h_natural_convection * surface_area_m2;
  const temperature_rise = heat_dissipation_capacity > 0 ? power_w / heat_dissipation_capacity : 0;
  const material_surface_temp = ambient_c + temperature_rise;

  // Check if material is suitable
  const melting_temp = material.casting_temperature_c * 1.3; // Approximate
  const safe_margin = melting_temp * 0.5;

  return {
    power_dissipated_w: power_w,
    surface_area_m2: surface_area_m2,
    temperature_rise_c: Number(temperature_rise.toFixed(1)),
    material_surface_temp_c: Number(material_surface_temp.toFixed(1)),
    thermal_conductivity_w_mk: material.thermal_conductivity_w_mk,
    safe_operating_margin_c: Number((safe_margin - material_surface_temp).toFixed(1)),
    suitable: material_surface_temp < safe_margin,
    recommendation: material_surface_temp < safe_margin ? 'Material suitable' : 'Thermal management required',
  };
}

// ─── Vibration Analysis ──────────────────────────────────────────
export function analyzeVibrationResponse(material_name, dimensions, mass_kg) {
  const material = MATERIAL_DATABASE[material_name];
  if (!material) return null;

  // Simplified natural frequency calculation
  const E = material.young_modulus_mpa * 1e6; // Convert to Pa
  const rho = material.density_kg_m3;
  const avg_dimension = Math.cbrt(dimensions.x * dimensions.y * dimensions.z) / 1000; // meters

  // Estimate natural frequency: f = (λ² / (2π)) * sqrt(E*I / (m*L⁴))
  // Simplified: f ≈ sqrt(E/rho) / dimension
  const wave_velocity = Math.sqrt(E / rho);
  const natural_frequency_hz = wave_velocity / (2 * avg_dimension);

  const damping_ratio = 0.02; // 2% for metals

  return {
    material: material_name,
    estimated_natural_frequency_hz: Number(natural_frequency_hz.toFixed(1)),
    damping_ratio: damping_ratio,
    quality_factor_q: Number((1 / (2 * damping_ratio)).toFixed(1)),
    resonance_avoidance_range_hz: {
      lower: Number((natural_frequency_hz * 0.8).toFixed(1)),
      upper: Number((natural_frequency_hz * 1.2).toFixed(1)),
    },
    recommendation: 'Avoid excitation frequencies within resonance range',
  };
}

export default {
  MATERIAL_DATABASE,
  getMaterialProperties,
  getAllMaterials,
  calculateSafetyFactors,
  getDerateFactor,
  assessEnvironmentalDegradation,
  analyzeThermalPerformance,
  analyzeVibrationResponse,
};

const MATERIAL_LIBRARY = {
  aluminum_6061: {
    name: 'aluminum_6061',
    family: 'aluminum',
    density_kg_m3: 2700,
    youngs_modulus_gpa: 68.9,
    yield_strength_mpa: 276,
    ultimate_strength_mpa: 310,
    thermal_conductivity_w_mk: 167,
    electrical_conductivity_ms_m: 25,
    max_service_temp_c: 150,
    relative_magnetic_permeability: 1.0,
    finish: 'machined',
    color_hex: '#b7bcc5',
    domain_tags: ['general', 'aerospace', 'robotics', 'electronics'],
  },
  aluminum_7075_t6: {
    name: 'aluminum_7075_t6',
    family: 'aluminum',
    density_kg_m3: 2810,
    youngs_modulus_gpa: 71.7,
    yield_strength_mpa: 503,
    ultimate_strength_mpa: 572,
    thermal_conductivity_w_mk: 130,
    electrical_conductivity_ms_m: 18.7,
    max_service_temp_c: 120,
    relative_magnetic_permeability: 1.0,
    finish: 'anodized',
    color_hex: '#9da6b2',
    domain_tags: ['aerospace', 'aviation', 'motorsport'],
  },
  titanium_ti6al4v: {
    name: 'titanium_ti6al4v',
    family: 'titanium',
    density_kg_m3: 4430,
    youngs_modulus_gpa: 113.8,
    yield_strength_mpa: 880,
    ultimate_strength_mpa: 950,
    thermal_conductivity_w_mk: 6.7,
    electrical_conductivity_ms_m: 0.58,
    max_service_temp_c: 400,
    relative_magnetic_permeability: 1.0,
    finish: 'bead_blast',
    color_hex: '#8e9499',
    domain_tags: ['aerospace', 'aviation', 'submersible', 'nuclear'],
  },
  inconel_718: {
    name: 'inconel_718',
    family: 'nickel_superalloy',
    density_kg_m3: 8190,
    youngs_modulus_gpa: 200,
    yield_strength_mpa: 1030,
    ultimate_strength_mpa: 1240,
    thermal_conductivity_w_mk: 11.4,
    electrical_conductivity_ms_m: 0.8,
    max_service_temp_c: 700,
    relative_magnetic_permeability: 1.01,
    finish: 'high_temp_machined',
    color_hex: '#747a80',
    domain_tags: ['aerospace', 'rocket', 'plasma', 'nuclear'],
  },
  stainless_316l: {
    name: 'stainless_316l',
    family: 'stainless_steel',
    density_kg_m3: 8000,
    youngs_modulus_gpa: 193,
    yield_strength_mpa: 290,
    ultimate_strength_mpa: 580,
    thermal_conductivity_w_mk: 16.3,
    electrical_conductivity_ms_m: 1.35,
    max_service_temp_c: 870,
    relative_magnetic_permeability: 1.02,
    finish: 'passivated',
    color_hex: '#8f9399',
    domain_tags: ['submersible', 'marine', 'nuclear', 'process'],
  },
  copper_c110: {
    name: 'copper_c110',
    family: 'copper',
    density_kg_m3: 8960,
    youngs_modulus_gpa: 117,
    yield_strength_mpa: 69,
    ultimate_strength_mpa: 220,
    thermal_conductivity_w_mk: 391,
    electrical_conductivity_ms_m: 58,
    max_service_temp_c: 200,
    relative_magnetic_permeability: 0.999994,
    finish: 'bright',
    color_hex: '#c97b49',
    domain_tags: ['electronics', 'magnetic', 'rf', 'power'],
  },
  fr4: {
    name: 'fr4',
    family: 'laminate',
    density_kg_m3: 1850,
    youngs_modulus_gpa: 22,
    yield_strength_mpa: 300,
    ultimate_strength_mpa: 420,
    thermal_conductivity_w_mk: 0.3,
    electrical_conductivity_ms_m: 0,
    max_service_temp_c: 130,
    relative_magnetic_permeability: 1.0,
    finish: 'laminated',
    color_hex: '#2f7d47',
    domain_tags: ['electronics'],
  },
  silicon: {
    name: 'silicon',
    family: 'semiconductor',
    density_kg_m3: 2330,
    youngs_modulus_gpa: 130,
    yield_strength_mpa: 7000,
    ultimate_strength_mpa: 7000,
    thermal_conductivity_w_mk: 149,
    electrical_conductivity_ms_m: 0.0004,
    max_service_temp_c: 150,
    relative_magnetic_permeability: 1.0,
    finish: 'polished',
    color_hex: '#5c6670',
    domain_tags: ['electronics', 'quantum'],
  },
  mu_metal: {
    name: 'mu_metal',
    family: 'nickel_iron',
    density_kg_m3: 8740,
    youngs_modulus_gpa: 145,
    yield_strength_mpa: 310,
    ultimate_strength_mpa: 520,
    thermal_conductivity_w_mk: 21,
    electrical_conductivity_ms_m: 1.7,
    max_service_temp_c: 350,
    relative_magnetic_permeability: 80000,
    finish: 'annealed_shielding',
    color_hex: '#6d747d',
    domain_tags: ['magnetic', 'quantum', 'instrumentation'],
  },
};

const MATERIAL_ALIASES = {
  aluminum: 'aluminum_6061',
  aluminium: 'aluminum_6061',
  steel: 'stainless_316l',
  stainless: 'stainless_316l',
  titanium: 'titanium_ti6al4v',
  inconel: 'inconel_718',
  copper: 'copper_c110',
  pcb: 'fr4',
};

const DOMAIN_DEFAULT_MATERIAL = {
  aerospace: 'aluminum_7075_t6',
  aviation: 'aluminum_7075_t6',
  rocket: 'inconel_718',
  submersible: 'stainless_316l',
  marine: 'stainless_316l',
  electronics: 'fr4',
  quantum: 'silicon',
  magnetic: 'mu_metal',
  nuclear: 'stainless_316l',
  plasma: 'inconel_718',
};

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

export function inferRequestedDomains(plan = {}, part = {}) {
  const tokens = [
    part.type,
    part.shape,
    part.kind,
    part.name,
    plan?.prompt,
    plan?.name,
    plan?.script,
    plan?.recipe?.description,
    JSON.stringify(plan?.recipe?.parameters || {}),
  ].map(lower).join(' ');

  const domains = [];
  if (/(engine|engine_block|cylinder_head|piston|con_rod|connecting_rod|crank|cam|valve_train|timing_chain|clutch|gearbox|drivetrain|bearing|fastener|bracket|fixture|manifold|housing|oil_pan|valve_cover|cam_cover|throttle_body|intercooler|radiator|oil_filter|oil_sump|flywheel|timing_belt)/.test(tokens)) {
    domains.push('mechanical');
  }
  if (/(engine|engine_block|cylinder_head|piston|con_rod|connecting_rod|turbo|turbocharger|compressor|turbine|manifold|exhaust|intake|throttle_body|intercooler|thruster|propuls)/.test(tokens)) {
    domains.push('propulsion');
  }
  if (/(turbo|turbocharger|compressor|turbine|pump|oil_pump|water_pump|impeller|manifold|exhaust|intake|coolant|fluid|hydraulic|flow|intercooler|radiator|oil_pan|oil_filter|throttle)/.test(tokens)) {
    domains.push('thermal-fluid');
  }
  if (/(engine|turbo|turbine|compressor|propuls|flight|aircraft|aviation|aerospace|rocket)/.test(tokens)) {
    domains.push('aerospace');
  }
  if (/(rocket|thruster|turbine|combustor|fairing|payload|aerospace|space)/.test(tokens)) domains.push('aerospace', 'rocket');
  if (/(aviation|aircraft|wing|flight)/.test(tokens)) domains.push('aviation');
  if (/(submersible|marine|seawater|ocean)/.test(tokens)) domains.push('submersible', 'marine');
  if (/(pcb|sensor|connector|electrical|electronic|rf|power)/.test(tokens)) domains.push('electronics');
  if (/(nuclear|reactor|radiation|fuel rod|containment)/.test(tokens)) domains.push('nuclear');
  if (/(quantum|cryogenic|qubit|vacuum chamber)/.test(tokens)) domains.push('quantum');
  if (/(magnet|magnetic|coil|stator|rotor|shield)/.test(tokens)) domains.push('magnetic');
  if (/(plasma|ion|arc)/.test(tokens)) domains.push('plasma');
  if (part.kind === 'electrical_pcb' || part.kind === 'electrical_component') domains.push('electronics');
  return uniq(domains.length ? domains : ['general']);
}

function canonicalMaterialName(materialName, domains = []) {
  const key = lower(materialName);
  if (MATERIAL_LIBRARY[key]) return key;
  if (MATERIAL_ALIASES[key]) return MATERIAL_ALIASES[key];
  for (const domain of domains) {
    if (DOMAIN_DEFAULT_MATERIAL[domain]) return DOMAIN_DEFAULT_MATERIAL[domain];
  }
  return 'aluminum_6061';
}

export function getMaterialProfile(materialName, context = {}) {
  const domains = inferRequestedDomains(context.plan || {}, context.part || {});
  const canonical = canonicalMaterialName(materialName, domains);
  return {
    ...MATERIAL_LIBRARY[canonical],
    requested_material: materialName || canonical,
    resolved_domains: domains,
  };
}

export function buildMaterialAlternatives(profile = {}, domains = []) {
  const targetDomains = uniq([...(domains || []), ...(profile.domain_tags || [])]);
  return Object.values(MATERIAL_LIBRARY)
    .filter((entry) => entry.name !== profile.name)
    .filter((entry) => targetDomains.some((domain) => entry.domain_tags.includes(domain)))
    .slice(0, 4)
    .map((entry) => ({
      material: entry.name,
      family: entry.family,
      density_kg_m3: entry.density_kg_m3,
      yield_strength_mpa: entry.yield_strength_mpa,
      color_hex: entry.color_hex,
    }));
}

export function buildAppearanceProfile(profile = {}, part = {}) {
  const opacity = part.kind === 'electrical_pcb' ? 0.96 : 1.0;
  return {
    base_color_hex: profile.color_hex || '#b7bcc5',
    finish: profile.finish || 'machined',
    opacity,
    roughness: profile.family === 'laminate' ? 0.72 : 0.42,
    metallic: ['aluminum', 'titanium', 'stainless_steel', 'nickel_superalloy', 'copper', 'nickel_iron'].includes(profile.family) ? 0.88 : 0.08,
  };
}

export function buildReactionProfile(profile = {}, domains = []) {
  return {
    vacuum_compatible: domains.includes('aerospace') || domains.includes('quantum') || profile.name === 'titanium_ti6al4v',
    seawater_compatible: domains.includes('submersible') || profile.name === 'stainless_316l',
    cryogenic_ready: domains.includes('quantum') || domains.includes('rocket') || profile.name === 'titanium_ti6al4v',
    oxidizer_resistance: domains.includes('rocket') || profile.name === 'inconel_718',
    radiation_tolerant: domains.includes('nuclear') || ['stainless_316l', 'inconel_718', 'titanium_ti6al4v'].includes(profile.name),
    high_magnetic_permeability: Number(profile.relative_magnetic_permeability || 0) > 100,
  };
}

export function buildSimulationRecommendations(part = {}, profile = {}, domains = []) {
  const sims = ['structural_static', 'modal'];
  if (domains.includes('electronics') || part.kind === 'electrical_component' || part.kind === 'electrical_pcb') sims.push('thermal', 'signal_integrity');
  if (domains.includes('aerospace') || domains.includes('rocket') || /(manifold|pump|turbo|thruster)/.test(lower(part.type || part.shape))) sims.push('thermal', 'fluid');
  if (domains.includes('submersible')) sims.push('pressure_vessel', 'corrosion');
  if (domains.includes('nuclear')) sims.push('thermal', 'radiation');
  if (domains.includes('quantum')) sims.push('thermal', 'vibration', 'vacuum');
  if (domains.includes('magnetic') || Number(profile.relative_magnetic_permeability || 0) > 2) sims.push('magnetic');
  return uniq(sims);
}

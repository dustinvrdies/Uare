
import crypto from 'crypto';
import {
  buildAppearanceProfile,
  buildMaterialAlternatives,
  buildReactionProfile,
  buildSimulationRecommendations,
  getMaterialProfile,
  inferRequestedDomains,
} from '../physics/materialCatalog.mjs';

function stableId(seed = '') {
  return crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 12);
}

function mm(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildEngineeringMetadata(part, plan = {}, params = {}) {
  const domains = inferRequestedDomains(plan, part);
  const materialProfile = getMaterialProfile(part.material || params.material_name || 'aluminum_6061', { plan, part });
  const appearance = buildAppearanceProfile(materialProfile, part);
  const reactions = buildReactionProfile(materialProfile, domains);
  const simulation_recommendations = buildSimulationRecommendations(part, materialProfile, domains);
  return {
    material_profile: materialProfile,
    material_alternatives: buildMaterialAlternatives(materialProfile, domains),
    appearance,
    engineering_profile: {
      domains,
      simulation_recommendations,
      reactions,
      standards_context: domains.includes('aerospace') || domains.includes('aviation')
        ? ['AS9100', 'GD&T']
        : domains.includes('electronics')
          ? ['IPC', 'DFM']
          : domains.includes('nuclear')
            ? ['ASME', 'NQA-1']
            : ['GD&T'],
      design_exploration_ready: true,
    },
  };
}

function inferBoundingEnvelope(shape, rawDims = {}) {
  const partShape = String(shape || 'box').toLowerCase();
  const x = toPositiveNumber(rawDims.x) ?? toPositiveNumber(rawDims.width) ?? toPositiveNumber(rawDims.w);
  const y = toPositiveNumber(rawDims.y) ?? toPositiveNumber(rawDims.depth) ?? toPositiveNumber(rawDims.d);
  const z = toPositiveNumber(rawDims.z) ?? toPositiveNumber(rawDims.height) ?? toPositiveNumber(rawDims.h);
  const diameter = toPositiveNumber(rawDims.diameter) ?? toPositiveNumber(rawDims.outer_diameter) ?? toPositiveNumber(rawDims.outerD);
  const length = toPositiveNumber(rawDims.length) ?? toPositiveNumber(rawDims.L);

  if (partShape === 'con_rod' || partShape === 'connecting_rod') {
    const ctc = toPositiveNumber(rawDims.ctc) ?? length;
    const bigEndD = toPositiveNumber(rawDims.bigEndD) ?? toPositiveNumber(rawDims.big_end_diameter);
    const smallEndD = toPositiveNumber(rawDims.smallEndD) ?? toPositiveNumber(rawDims.small_end_diameter);
    const thickness = toPositiveNumber(rawDims.thickness) ?? toPositiveNumber(rawDims.w);
    if (ctc && bigEndD && smallEndD && thickness) {
      return {
        x: Math.max(bigEndD, smallEndD),
        y: thickness,
        z: ctc + (bigEndD + smallEndD) / 2,
      };
    }
  }

  if (partShape === 'cylinder_liner' || partShape === 'cylinder_sleeve') {
    const outerD = diameter;
    if (outerD && length) return { x: outerD, y: outerD, z: length };
  }

  if (partShape === 'valve' || partShape === 'valve_intake' || partShape === 'valve_exhaust') {
    const headD = toPositiveNumber(rawDims.head_diameter) ?? toPositiveNumber(rawDims.headD) ?? diameter;
    if (headD && length) return { x: headD, y: headD, z: length };
  }

  if (partShape === 'spark_plug') {
    const hexD = toPositiveNumber(rawDims.hex_diameter) ?? diameter;
    if (hexD && length) return { x: hexD, y: hexD, z: length };
  }

  if (partShape === 'fuel_injector') {
    const bodyD = toPositiveNumber(rawDims.body_diameter) ?? diameter;
    const connectorW = toPositiveNumber(rawDims.connector_width);
    const connectorD = toPositiveNumber(rawDims.connector_depth);
    if (bodyD && length) {
      return {
        x: Math.max(bodyD, connectorW || 0),
        y: Math.max(bodyD, connectorD || 0),
        z: length,
      };
    }
  }

  if (partShape === 'oil_pan' || partShape === 'sump' || partShape === 'oil_sump') {
    const w = x ?? 420; const dep = y ?? 200; const h = z ?? 85;
    return { x: w, y: dep, z: h };
  }

  if (partShape === 'valve_cover' || partShape === 'cam_cover' || partShape === 'rocker_cover') {
    const w = x ?? 440; const dep = y ?? 195; const h = z ?? 62;
    return { x: w, y: dep, z: h };
  }

  if (partShape === 'throttle_body' || partShape === 'throttle') {
    const boreD = toPositiveNumber(rawDims.bore_diameter) ?? diameter ?? 70;
    const wall = toPositiveNumber(rawDims.wall_thickness) ?? 6;
    const len = length ?? 80;
    return { x: boreD + wall * 4, y: boreD + wall * 4, z: len };
  }

  if (partShape === 'intercooler' || partShape === 'charge_cooler') {
    const w = x ?? 550; const h = z ?? 200; const dep = y ?? 80;
    return { x: w, y: dep, z: h };
  }

  if (partShape === 'radiator' || partShape === 'coolant_radiator') {
    const w = x ?? 640; const h = z ?? 480; const dep = y ?? 36;
    return { x: w, y: dep, z: h };
  }

  if (partShape === 'oil_filter') {
    const od = diameter ?? 78; const h = z ?? length ?? 102;
    return { x: od, y: od, z: h };
  }

  return {
    x: x ?? diameter ?? 50,
    y: y ?? diameter ?? 50,
    z: z ?? length ?? 30,
  };
}

function classifyFitFromInterface(iface = {}) {
  const type = String(iface?.type || iface?.fit || 'clearance').toLowerCase();
  if (['interference', 'press', 'press_fit'].includes(type)) return 'interference';
  if (['transition', 'line_to_line', 'line-fit'].includes(type)) return 'transition';
  return 'clearance';
}

function buildConstraintGraph(plan = {}, parts = []) {
  const interfaces = Array.isArray(plan?.interfaces)
    ? plan.interfaces
    : Array.isArray(plan?.mates)
      ? plan.mates
      : [];
  const partIds = new Set(parts.map((part) => String(part.id || '')));
  const nodes = parts.map((part) => ({
    id: part.id,
    name: part.name,
    kind: part.kind,
  }));
  const edges = interfaces
    .map((iface, index) => {
      const a = String(iface?.part_a || iface?.a || '');
      const b = String(iface?.part_b || iface?.b || '');
      if (!partIds.has(a) || !partIds.has(b)) return null;
      return {
        id: iface?.id || `mate-${index + 1}`,
        source: a,
        target: b,
        fit_class: classifyFitFromInterface(iface),
        relation: String(iface?.relation || iface?.type || 'mate'),
        axis: String(iface?.axis || 'x').toLowerCase(),
        target_clearance_mm: Number(iface?.target_clearance_mm || 0),
      };
    })
    .filter(Boolean);

  return {
    generated_at: new Date().toISOString(),
    node_count: nodes.length,
    edge_count: edges.length,
    fit_class_counts: {
      clearance: edges.filter((edge) => edge.fit_class === 'clearance').length,
      transition: edges.filter((edge) => edge.fit_class === 'transition').length,
      interference: edges.filter((edge) => edge.fit_class === 'interference').length,
    },
    nodes,
    edges,
  };
}

function axisIndex(axis = 'x') {
  const a = String(axis || 'x').toLowerCase();
  if (a === 'y') return 1;
  if (a === 'z') return 2;
  return 0;
}

function getAxisExtent(part = {}, axis = 0) {
  const dims = part?.dimensions_mm || {};
  const values = [
    Number(dims.x || 0),
    Number(dims.y || 0),
    Number(dims.z || 0),
  ];
  const value = values[axis];
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function ensureTransform(part = {}) {
  const tr = part?.transform_mm || {};
  return {
    x: Number.isFinite(Number(tr.x)) ? Number(tr.x) : 0,
    y: Number.isFinite(Number(tr.y)) ? Number(tr.y) : 0,
    z: Number.isFinite(Number(tr.z)) ? Number(tr.z) : 0,
  };
}

function solveMatingConstraints(plan = {}, parts = []) {
  const interfaces = Array.isArray(plan?.interfaces)
    ? plan.interfaces
    : Array.isArray(plan?.mates)
      ? plan.mates
      : [];
  if (!interfaces.length || !parts.length) {
    return { parts, solvedInterfaces: [] };
  }

  const byId = new Map(parts.map((part, idx) => [String(part.id || `part-${idx}`), part]));
  const solvedInterfaces = [];

  for (const iface of interfaces) {
    const idA = String(iface?.part_a || iface?.a || '');
    const idB = String(iface?.part_b || iface?.b || '');
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (!a || !b) {
      solvedInterfaces.push({ id: iface?.id || null, solved: false, reason: 'unknown_parts' });
      continue;
    }

    const axis = axisIndex(iface?.axis || 'x');
    const clearance = Number.isFinite(Number(iface?.target_clearance_mm)) ? Number(iface.target_clearance_mm) : 0;
    const direction = String(iface?.direction || 'positive').toLowerCase() === 'negative' ? -1 : 1;

    const trA = ensureTransform(a);
    const trB = ensureTransform(b);
    const dimA = getAxisExtent(a, axis);
    const dimB = getAxisExtent(b, axis);
    const desiredDelta = (dimA / 2) + (dimB / 2) + clearance;

    const keys = ['x', 'y', 'z'];
    const axisKey = keys[axis];
    const next = {
      x: trB.x,
      y: trB.y,
      z: trB.z,
    };
    next[axisKey] = trA[axisKey] + (desiredDelta * direction);

    if (iface?.lock_other_axes === true) {
      for (const key of keys) {
        if (key === axisKey) continue;
        next[key] = trA[key];
      }
    }

    b.transform_mm = next;
    solvedInterfaces.push({
      id: iface?.id || `${idA}-${idB}`,
      solved: true,
      axis: axisKey,
      clearance_mm: clearance,
      direction: direction > 0 ? 'positive' : 'negative',
    });
  }

  return { parts, solvedInterfaces };
}

function buildMechanicalParts(params = {}) {
  const length = mm(params.bracket_length_mm, 120);
  const width = mm(params.bracket_width_mm, 40);
  const height = mm(params.bracket_height_mm, 30);
  const thickness = mm(params.wall_thickness_mm, 4);
  const material = params.material_name || 'aluminum_6061';
  return [
    {
      id: `part-${stableId(`body-${length}-${width}-${height}`)}`,
      name: 'Main bracket body',
      kind: 'mechanical',
      shape: 'bracket',
      dimensions_mm: { x: length, y: width, z: height },
      transform_mm: { x: 0, y: 0, z: height / 2 },
      material,
      process: params.process || 'cnc',
      exploded_offset_mm: { x: 0, y: 0, z: height * 0.2 },
      measurement_anchors: {
        envelope: [[-length / 2, -width / 2, 0], [length / 2, width / 2, height]],
      },
      metadata: { thickness_mm: thickness },
    },
    {
      id: `part-${stableId(`mount-${length}-${width}-${thickness}`)}`,
      name: 'Mounting plate',
      kind: 'mechanical',
      shape: 'flange',
      dimensions_mm: { x: length * 0.72, y: width, z: thickness },
      transform_mm: { x: 0, y: 0, z: height + thickness / 2 },
      material,
      process: params.process || 'cnc',
      exploded_offset_mm: { x: 0, y: width * 0.18, z: 0 },
      measurement_anchors: {
        envelope: [[-(length * 0.72) / 2, -width / 2, 0], [(length * 0.72) / 2, width / 2, thickness]],
      },
      metadata: { role: 'mount_face' },
    },
  ];
}

function buildElectricalAssembly(params = {}) {
  const boardX = mm(params.pcb_length_mm, 80);
  const boardY = mm(params.pcb_width_mm, 50);
  const boardZ = mm(params.pcb_thickness_mm, 1.6);
  const modules = Array.isArray(params.modules) ? params.modules : [];
  return {
    pcb: {
      id: `pcb-${stableId(`${boardX}-${boardY}-${boardZ}`)}`,
      name: 'Main control PCB',
      kind: 'electrical_pcb',
      shape: 'pcb',
      dimensions_mm: { x: boardX, y: boardY, z: boardZ },
      transform_mm: { x: 0, y: 0, z: boardZ / 2 },
      layer_count: Math.max(Number(params.pcb_layers || 2), 1),
      mounting_holes: [
        { x_mm: -boardX / 2 + 4, y_mm: -boardY / 2 + 4, diameter_mm: 3.2 },
        { x_mm: boardX / 2 - 4, y_mm: -boardY / 2 + 4, diameter_mm: 3.2 },
        { x_mm: -boardX / 2 + 4, y_mm: boardY / 2 - 4, diameter_mm: 3.2 },
        { x_mm: boardX / 2 - 4, y_mm: boardY / 2 - 4, diameter_mm: 3.2 },
      ],
      material: 'FR4',
      process: 'pcb_fab',
      exploded_offset_mm: { x: 0, y: 0, z: 24 },
      measurement_anchors: {
        envelope: [[-boardX / 2, -boardY / 2, 0], [boardX / 2, boardY / 2, boardZ]],
      },
    },
    components: [
      {
        id: `cmp-${stableId('mcu')}`,
        name: 'Microcontroller module',
        kind: 'electrical_component',
        footprint: 'QFP-64',
        shape: 'box',
        dimensions_mm: { x: 14, y: 14, z: 1.7 },
        transform_mm: { x: 0, y: 0, z: boardZ + 0.85 },
        pins: 64,
        voltage_v: 3.3,
        exploded_offset_mm: { x: 0, y: 0, z: 32 },
      },
      {
        id: `cmp-${stableId('regulator')}`,
        name: 'Power regulator',
        kind: 'electrical_component',
        footprint: 'SOT-223',
        shape: 'box',
        dimensions_mm: { x: 6.5, y: 7, z: 1.8 },
        transform_mm: { x: -boardX * 0.22, y: 0, z: boardZ + 0.9 },
        pins: 4,
        voltage_in_v: 12,
        voltage_out_v: 5,
        exploded_offset_mm: { x: -6, y: 0, z: 28 },
      },
      {
        id: `cmp-${stableId('sensor')}`,
        name: 'Sensor module',
        kind: 'electrical_component',
        footprint: 'LGA-16',
        shape: 'box',
        dimensions_mm: { x: 6, y: 6, z: 1.4 },
        transform_mm: { x: boardX * 0.18, y: 0, z: boardZ + 0.7 },
        pins: 16,
        voltage_v: 3.3,
        exploded_offset_mm: { x: 6, y: 0, z: 28 },
      },
      {
        id: `cmp-${stableId('connector')}`,
        name: 'I/O connector',
        kind: 'electrical_component',
        footprint: 'HEADER-8',
        shape: 'box',
        dimensions_mm: { x: 20, y: 5, z: 8 },
        transform_mm: { x: 0, y: boardY * 0.42, z: boardZ + 4 },
        pins: 8,
        exploded_offset_mm: { x: 0, y: 8, z: 20 },
      },
      ...modules.map((module, index) => ({
        id: `cmp-${stableId(`${module.name || 'module'}-${index}`)}`,
        name: module.name || `Module ${index + 1}`,
        kind: 'electrical_component',
        footprint: module.footprint || 'GENERIC',
        shape: module.shape || 'box',
        dimensions_mm: {
          x: mm(module.x_mm, 12),
          y: mm(module.y_mm, 12),
          z: mm(module.z_mm, 4),
        },
        transform_mm: {
          x: Number(module.pos_x_mm || 0),
          y: Number(module.pos_y_mm || 0),
          z: boardZ + Number(module.pos_z_mm || 2),
        },
        pins: Number(module.pins || 4),
        voltage_v: Number(module.voltage_v || 5),
        exploded_offset_mm: { x: 0, y: 0, z: 24 + (index * 2) },
      })),
    ],
    wiring: [
      {
        id: `wire-${stableId('vin')}`,
        name: 'Power net',
        kind: 'wiring',
        from: 'input_vin',
        to: 'regulator',
        net: 'VIN',
        gauge_awg: 20,
        path_mm: [[-boardX / 2, 0, boardZ + 2], [-boardX * 0.22, 0, boardZ + 2]],
        voltage_v: 12,
      },
      {
        id: `wire-${stableId('mcu-5v')}`,
        name: 'Regulated bus',
        kind: 'wiring',
        from: 'regulator',
        to: 'mcu',
        net: 'VCC_5V',
        gauge_awg: 24,
        path_mm: [[-boardX * 0.22, 0, boardZ + 2], [0, 0, boardZ + 2]],
        voltage_v: 5,
      },
      {
        id: `wire-${stableId('mcu-i2c')}`,
        name: 'Sensor signal',
        kind: 'wiring',
        from: 'mcu',
        to: 'sensor',
        net: 'I2C',
        gauge_awg: 28,
        path_mm: [[0, 0, boardZ + 2], [boardX * 0.18, 0, boardZ + 2]],
        voltage_v: 3.3,
      },
    ],
    netlist: [
      { net: 'VIN', nodes: ['input_vin', 'regulator.in'], nominal_voltage_v: 12 },
      { net: 'VCC_5V', nodes: ['regulator.out', 'mcu.vcc'], nominal_voltage_v: 5 },
      { net: 'I2C_SCL', nodes: ['mcu.scl', 'sensor.scl'], nominal_voltage_v: 3.3 },
      { net: 'I2C_SDA', nodes: ['mcu.sda', 'sensor.sda'], nominal_voltage_v: 3.3 },
      { net: 'GND', nodes: ['input_gnd', 'regulator.gnd', 'mcu.gnd', 'sensor.gnd'], nominal_voltage_v: 0 },
    ],
  };
}

export function buildAssemblyDocument(plan = {}) {
  const params = plan?.recipe?.parameters || {};
  const projectId = plan?.project_id || 'unassigned-project';

  // ── If the plan already carries a parts list (from copilot fallback plans
  //    or LLM-generated JSON), prefer those parts over the generic fallback.
  const rawParts = Array.isArray(plan?.parts) && plan.parts.length > 0 ? plan.parts : null;

  let parts, wiring, netlist;

  if (rawParts) {
    // Normalise each part to the canonical assembly_document format
    parts = rawParts.map((p, idx) => {
      const shape = String(p.type || p.shape || 'box');
      const rawDims = p.dims || p.dimensions_mm || {};
      // Expand flat dims into dimensions_mm (dims keys are already mm values)
      const dimensions_mm = { ...rawDims };
      // Add a conservative envelope without overwriting specialized engineering dims.
      const envelope = inferBoundingEnvelope(shape, rawDims);
      if (dimensions_mm.x == null) dimensions_mm.x = envelope.x;
      if (dimensions_mm.y == null) dimensions_mm.y = envelope.y;
      if (dimensions_mm.z == null) dimensions_mm.z = envelope.z;

      const hasPositionArray = Array.isArray(p.position);
      const sourceTransform = (p.transform_mm && typeof p.transform_mm === 'object') ? p.transform_mm : {};
      const pos = hasPositionArray
        ? p.position
        : [sourceTransform.x ?? 0, sourceTransform.y ?? 0, sourceTransform.z ?? 0];
      const basePart = {
        id: p.id || `part-${stableId(`${shape}-${idx}`)}`,
        name: p.name || shape,
        kind: p.kind || (shape === 'pcb' ? 'electrical_pcb' : 'mechanical'),
        shape,
        dimensions_mm,
        feature_timeline: Array.isArray(p.feature_timeline) ? p.feature_timeline : [],
        features: Array.isArray(p.features) ? p.features : [],
        transform_mm: {
          x: Number.isFinite(Number(pos[0])) ? Number(pos[0]) : 0,
          y: Number.isFinite(Number(pos[1])) ? Number(pos[1]) : 0,
          z: Number.isFinite(Number(pos[2])) ? Number(pos[2]) : 0,
        },
        material: p.material || params.material_name || 'steel',
        process: p.process || params.process || 'cnc',
        exploded_offset_mm: p.exploded_offset_mm || { x: 0, y: 0, z: Number(dimensions_mm.z || 0) * 0.2 },
        measurement_anchors: p.measurement_anchors || {},
        metadata: {
          standard: p.standard || null,
          revision: p.revision || null,
          surface_finish: p.surface_finish || null,
          tolerance: p.tolerance || null,
          notes: p.notes || null,
          heat_treatment: p.heat_treatment || null,
          mass_kg: p.mass_kg || null,
          quantity: p.quantity || 1,
        },
      };
      return { ...basePart, ...buildEngineeringMetadata(basePart, plan, params) };
    });
    wiring = plan.wiring || [];
    netlist = plan.netlist || [];
  } else {
    const mechanicalParts = buildMechanicalParts(params);
    const electrical = buildElectricalAssembly(params);
    parts = [electrical.pcb, ...electrical.components, ...mechanicalParts].map((part) => ({
      ...part,
      ...buildEngineeringMetadata(part, plan, params),
    }));
    wiring = electrical.wiring;
    netlist = electrical.netlist;
  }

  const solved = solveMatingConstraints(plan, parts);
  const solvedParts = solved.parts;

  const bbox = solvedParts.reduce((acc, part) => {
    const dims = part.dimensions_mm || { x: 0, y: 0, z: 0 };
    acc.x = Math.max(acc.x, dims.x || 0);
    acc.y = Math.max(acc.y, dims.y || 0);
    acc.z = Math.max(acc.z, (part.transform_mm?.z || 0) + (dims.z || 0));
    return acc;
  }, { x: 0, y: 0, z: 0 });

  const constraintGraph = buildConstraintGraph(plan, solvedParts);

  return {
    schema_version: 1,
    project_id: projectId,
    assembly_id: `asm-${stableId(JSON.stringify({ projectId, params }))}`,
    generated_at: new Date().toISOString(),
    source: {
      engine: plan?.engine || 'cadquery',
      project_id: projectId,
      workflow_run_id: plan?.workflow_run_id || null,
    },
    parts: solvedParts,
    wiring,
    netlist,
    constraint_graph: constraintGraph,
    solved_constraints: solved.solvedInterfaces,
    hierarchy: rawParts
      ? [{ id: 'root', name: plan?.name || 'Assembly', children: solvedParts.map((p) => p.id) }]
      : [
          {
            id: 'root',
            name: 'Invented system',
            children: [
              { id: 'electrical', name: 'Electrical subsystem', children: [solvedParts[0]?.id, ...solvedParts.slice(1, 5).map((item) => item.id)] },
              { id: 'mechanical', name: 'Mechanical subsystem', children: solvedParts.slice(5).map((item) => item.id) },
            ],
          },
        ],
    bounding_box_mm: bbox,
    manufacturing: {
      pcb_layers: rawParts ? 0 : parts[0]?.layer_count,
      suggested_processes: rawParts
        ? [...new Set(parts.map((p) => p.process).filter(Boolean))]
        : ['pcb_fab', 'assembly', parts[parts.length - 1]?.process || 'cnc'],
      assembly_level: 'prototype',
    },
    engineering_domains: [...new Set(parts.flatMap((part) => part.engineering_profile?.domains || []))],
  };
}

export function buildViewerManifest(assemblyDocument = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  return {
    assembly_id: assemblyDocument.assembly_id || null,
    generated_at: new Date().toISOString(),
    part_count: parts.length,
    hierarchy: assemblyDocument.hierarchy || [],
    parts: parts.map((part) => ({
      id: part.id,
      label: part.name,
      kind: part.kind,
      material: part.material || null,
      material_profile: part.material_profile || null,
      appearance: part.appearance || null,
      process: part.process || null,
      dimensions_mm: part.dimensions_mm || null,
      transform_mm: part.transform_mm || null,
      exploded_offset_mm: part.exploded_offset_mm || { x: 0, y: 0, z: 0 },
      measurement_anchors: part.measurement_anchors || {},
      footprint: part.footprint || null,
      pins: part.pins || null,
      engineering_profile: part.engineering_profile || null,
    })),
    wires: assemblyDocument.wiring || [],
    netlist: assemblyDocument.netlist || [],
    constraint_graph: assemblyDocument.constraint_graph || { node_count: 0, edge_count: 0, nodes: [], edges: [] },
    bounding_box_mm: assemblyDocument.bounding_box_mm || null,
    engineering_domains: assemblyDocument.engineering_domains || [],
  };
}

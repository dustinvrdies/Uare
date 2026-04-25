function facet(nx, ny, nz, a, b, c) {
  return [
    `facet normal ${nx} ${ny} ${nz}`,
    '  outer loop',
    `    vertex ${a[0]} ${a[1]} ${a[2]}`,
    `    vertex ${b[0]} ${b[1]} ${b[2]}`,
    `    vertex ${c[0]} ${c[1]} ${c[2]}`,
    '  endloop',
    'endfacet',
  ].join('\n');
}

function normalizeEnvelopeType(type = '') {
  const t = String(type || '').toLowerCase();
  if (!t) return 'box';
  if (['shaft', 'pin', 'dowel_pin', 'roller', 'axle', 'stud', 'rod'].includes(t)) return 'shaft';
  if (['washer', 'clutch_disc', 'disc', 'flywheel', 'brake_rotor', 'pulley', 'sprocket'].includes(t)) return 'disc';
  if (['piston', 'bearing', 'cylinder_liner', 'cylinder', 'nut_hex', 'spacer'].includes(t)) return 'cylinder';
  if (['tube', 'pipe', 'bushing', 'sleeve'].includes(t)) return 'tube';
  if (['flange', 'hub'].includes(t)) return 'flange';
  if (['bracket', 'mount', 'angle_bracket', 'corner_bracket'].includes(t)) return 'bracket';
  if (['housing', 'case', 'enclosure'].includes(t)) return 'housing';
  if (['gear', 'bevel_gear', 'worm_wheel', 'ring_gear', 'timing_pulley'].includes(t)) return 'gear';
  return 'box';
}

function resolveQualityFactor() {
  const raw = String(process.env.UARE_STL_QUALITY || 'high').toLowerCase();
  if (raw === 'draft') return 0.8;
  if (raw === 'balanced') return 1.0;
  if (raw === 'ultra') return 1.8;
  return 1.35;
}

function adaptiveSegments(radius = 10, base = 24) {
  const r = Math.max(0.1, Number(radius) || 10);
  const quality = resolveQualityFactor();
  const scaled = Math.ceil((Number(base) || 24) * quality + (r * 0.45));
  return Math.min(192, Math.max(16, scaled));
}

function boxFacets({ lx = 10, wy = 10, hz = 10, tx = 0, ty = 0, tz = 0 } = {}) {
  const v = {
    p000: [tx - lx, ty - wy, tz - hz],
    p001: [tx - lx, ty - wy, tz + hz],
    p010: [tx - lx, ty + wy, tz - hz],
    p011: [tx - lx, ty + wy, tz + hz],
    p100: [tx + lx, ty - wy, tz - hz],
    p101: [tx + lx, ty - wy, tz + hz],
    p110: [tx + lx, ty + wy, tz - hz],
    p111: [tx + lx, ty + wy, tz + hz],
  };

  return [
    facet(1, 0, 0, v.p100, v.p101, v.p111), facet(1, 0, 0, v.p100, v.p111, v.p110),
    facet(-1, 0, 0, v.p000, v.p011, v.p001), facet(-1, 0, 0, v.p000, v.p010, v.p011),
    facet(0, 1, 0, v.p010, v.p110, v.p111), facet(0, 1, 0, v.p010, v.p111, v.p011),
    facet(0, -1, 0, v.p000, v.p001, v.p101), facet(0, -1, 0, v.p000, v.p101, v.p100),
    facet(0, 0, 1, v.p001, v.p011, v.p111), facet(0, 0, 1, v.p001, v.p111, v.p101),
    facet(0, 0, -1, v.p000, v.p100, v.p110), facet(0, 0, -1, v.p000, v.p110, v.p010),
  ];
}

function buildCylinderStl({ radius = 20, height = 30, segments = 24, name = 'uare_part' } = {}) {
  const r = Math.max(0.1, Number(radius) || 20);
  const h = Math.max(0.1, Number(height) || 30);
  const n = adaptiveSegments(r, Number(segments) || 24);
  const hz = h / 2;
  const faces = [];

  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = Math.cos(a0) * r;
    const y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r;
    const y1 = Math.sin(a1) * r;
    const nx = Math.cos((a0 + a1) * 0.5);
    const ny = Math.sin((a0 + a1) * 0.5);

    const p0 = [x0, y0, -hz];
    const p1 = [x1, y1, -hz];
    const p2 = [x1, y1, hz];
    const p3 = [x0, y0, hz];

    // Side wall (2 triangles per segment)
    faces.push(facet(nx, ny, 0, p0, p1, p2));
    faces.push(facet(nx, ny, 0, p0, p2, p3));

    // Top cap
    faces.push(facet(0, 0, 1, [0, 0, hz], p3, p2));
    // Bottom cap
    faces.push(facet(0, 0, -1, [0, 0, -hz], p1, p0));
  }

  return ['solid ' + name, ...faces, 'endsolid ' + name].join('\n');
}

function buildTubeStl({ outerRadius = 20, innerRadius = 12, height = 30, segments = 28, name = 'uare_part' } = {}) {
  const ro = Math.max(0.2, Number(outerRadius || 20));
  const ri = Math.max(0.1, Math.min(Number(innerRadius || 12), ro - 0.1));
  const h = Math.max(0.1, Number(height || 30));
  const n = adaptiveSegments(ro, Number(segments) || 28);
  const hz = h / 2;
  const faces = [];

  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const co0 = Math.cos(a0), so0 = Math.sin(a0);
    const co1 = Math.cos(a1), so1 = Math.sin(a1);

    const o0b = [co0 * ro, so0 * ro, -hz];
    const o1b = [co1 * ro, so1 * ro, -hz];
    const o1t = [co1 * ro, so1 * ro, hz];
    const o0t = [co0 * ro, so0 * ro, hz];

    const i0b = [co0 * ri, so0 * ri, -hz];
    const i1b = [co1 * ri, so1 * ri, -hz];
    const i1t = [co1 * ri, so1 * ri, hz];
    const i0t = [co0 * ri, so0 * ri, hz];

    const nx = Math.cos((a0 + a1) * 0.5);
    const ny = Math.sin((a0 + a1) * 0.5);

    // Outer wall
    faces.push(facet(nx, ny, 0, o0b, o1b, o1t));
    faces.push(facet(nx, ny, 0, o0b, o1t, o0t));
    // Inner wall
    faces.push(facet(-nx, -ny, 0, i0b, i0t, i1t));
    faces.push(facet(-nx, -ny, 0, i0b, i1t, i1b));
    // Top ring
    faces.push(facet(0, 0, 1, i0t, o1t, o0t));
    faces.push(facet(0, 0, 1, i0t, i1t, o1t));
    // Bottom ring
    faces.push(facet(0, 0, -1, i0b, o0b, o1b));
    faces.push(facet(0, 0, -1, i0b, o1b, i1b));
  }

  return ['solid ' + name, ...faces, 'endsolid ' + name].join('\n');
}

function buildCompoundStl(name, faceGroups = []) {
  const allFaces = faceGroups.flat().filter(Boolean);
  return ['solid ' + name, ...allFaces, 'endsolid ' + name].join('\n');
}

function solidFaces(stl = '') {
  return String(stl || '').split('\n').slice(1, -1).filter(Boolean);
}

function shiftFacetLine(line = '', tx = 0, ty = 0, tz = 0) {
  if (!line.trim().startsWith('vertex')) return line;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return line;
  const x = Number(parts[1]) + tx;
  const y = Number(parts[2]) + ty;
  const z = Number(parts[3]) + tz;
  return `    vertex ${x} ${y} ${z}`;
}

export function buildAssemblyStl(parts = [], name = 'uare_assembly') {
  const faceGroups = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] || {};
    const dims = part.dimensions_mm || {};
    const length = Number(dims.x ?? dims.length ?? dims.width ?? 20);
    const width = Number(dims.y ?? dims.width ?? dims.depth ?? 20);
    const height = Number(dims.z ?? dims.height ?? dims.thickness ?? 20);
    const partType = part.shape || part.kind || 'box';
    const partName = part.id || `part_${index + 1}`;
    const partStl = buildBoxStl({ length, width, height, name: partName, partType });

    const tr = part.transform_mm || {};
    const tx = Number.isFinite(Number(tr.x)) ? Number(tr.x) : 0;
    const ty = Number.isFinite(Number(tr.y)) ? Number(tr.y) : 0;
    const tz = Number.isFinite(Number(tr.z)) ? Number(tr.z) : 0;

    const shifted = partStl
      .split('\n')
      .slice(1, -1)
      .map((line) => shiftFacetLine(line, tx, ty, tz));
    faceGroups.push(shifted);
  }
  return buildCompoundStl(name, faceGroups);
}

export function buildBoxStl({ length = 120, width = 40, height = 30, name = 'uare_part', envelopeType = 'box', partType = '' } = {}) {
  const effectiveType = normalizeEnvelopeType(envelopeType || partType);
  if (effectiveType === 'cylinder' || effectiveType === 'disc') {
    const diameter = Math.max(1, Math.min(Number(length) || 120, Number(width) || 40));
    const cylHeight = effectiveType === 'disc' ? Math.max(1, Number(height) || 8) : Math.max(1, Number(height) || 30);
    return buildCylinderStl({ radius: diameter / 2, height: cylHeight, name });
  }

  if (effectiveType === 'shaft') {
    const diameter = Math.max(1, Math.min(Number(length) || 120, Number(width) || 40));
    const shaftHeight = Math.max(2, Number(height) || 60);
    const body = solidFaces(buildCylinderStl({ radius: diameter / 2, height: shaftHeight, segments: adaptiveSegments(diameter / 2, 32), name: `${name}_shaft` }));
    const collar = solidFaces(buildCylinderStl({ radius: (diameter * 1.24) / 2, height: Math.max(2, shaftHeight * 0.18), segments: adaptiveSegments((diameter * 1.24) / 2, 32), name: `${name}_collar` }));
    const key = boxFacets({
      lx: Math.max(2, diameter * 0.34) / 2,
      wy: Math.max(1.4, diameter * 0.12) / 2,
      hz: Math.max(3, shaftHeight * 0.46) / 2,
      tx: (diameter / 2) - (diameter * 0.08),
      ty: 0,
      tz: 0,
    });
    return buildCompoundStl(name, [body, collar, key]);
  }

  if (effectiveType === 'tube') {
    const diameter = Math.max(2, Math.min(Number(length) || 120, Number(width) || 40));
    return buildTubeStl({
      outerRadius: diameter / 2,
      innerRadius: Math.max(0.2, (diameter / 2) * 0.62),
      height: Math.max(1, Number(height) || 30),
      name,
    });
  }

  if (effectiveType === 'flange') {
    const diameter = Math.max(2, Math.min(Number(length) || 120, Number(width) || 40));
    const base = solidFaces(buildTubeStl({
      outerRadius: diameter / 2,
      innerRadius: Math.max(0.2, (diameter / 2) * 0.35),
      height: Math.max(1, Number(height) || 12),
      segments: adaptiveSegments(diameter / 2, 36),
      name: `${name}_flange`,
    }));
    const t = Math.max(1, Number(height) || 12);
    const lugLen = Math.max(2, diameter * 0.16);
    const lugWid = Math.max(2, diameter * 0.12);
    const ringR = (diameter / 2) + (lugLen / 2) * 0.7;
    const lugs = [
      ...boxFacets({ lx: lugLen / 2, wy: lugWid / 2, hz: t / 2, tx: ringR, ty: 0, tz: 0 }),
      ...boxFacets({ lx: lugLen / 2, wy: lugWid / 2, hz: t / 2, tx: -ringR, ty: 0, tz: 0 }),
      ...boxFacets({ lx: lugWid / 2, wy: lugLen / 2, hz: t / 2, tx: 0, ty: ringR, tz: 0 }),
      ...boxFacets({ lx: lugWid / 2, wy: lugLen / 2, hz: t / 2, tx: 0, ty: -ringR, tz: 0 }),
    ];
    return buildCompoundStl(name, [base, lugs]);
  }

  if (effectiveType === 'gear') {
    const diameter = Math.max(6, Math.min(Number(length) || 120, Number(width) || 40));
    const base = buildCylinderStl({ radius: (diameter * 0.86) / 2, height: Math.max(1, Number(height) || 14), segments: adaptiveSegments((diameter * 0.86) / 2, 48), name: `${name}_base` });
    const faces = base.split('\n').slice(1, -1);
    const toothCount = Math.max(10, Math.round(diameter / 3));
    const toothLen = Math.max(1.5, diameter * 0.07);
    const toothW = Math.max(1.5, (Math.PI * diameter) / (toothCount * 5));
    const toothHz = Math.max(1, Number(height) || 14) / 2;
    const toothLh = toothLen / 2;
    const toothWh = toothW / 2;
    const ringR = (diameter * 0.86) / 2 + toothLh;
    const toothFaces = [];
    for (let i = 0; i < toothCount; i += 1) {
      const a = (i / toothCount) * Math.PI * 2;
      const tx = Math.cos(a) * ringR;
      const ty = Math.sin(a) * ringR;
      toothFaces.push(...boxFacets({ lx: toothLh, wy: toothWh, hz: toothHz, tx, ty, tz: 0 }));
    }
    return buildCompoundStl(name, [faces, toothFaces]);
  }

  if (effectiveType === 'bracket') {
    const lx = Math.max(10, Number(length) || 120) / 2;
    const wy = Math.max(10, Number(width) || 40) / 2;
    const hz = Math.max(10, Number(height) || 30) / 2;
    const t = Math.max(1, Math.min((wy * 2) * 0.2, (hz * 2) * 0.35)) / 2;
    const baseFaces = boxFacets({ lx, wy, hz: t, tx: 0, ty: 0, tz: 0 });
    const wallFaces = boxFacets({ lx, wy: t, hz, tx: 0, ty: -wy + t, tz: hz - t });
    const ribL = Math.max(4, (lx * 2) * 0.24) / 2;
    const ribW = Math.max(2, (t * 2) * 0.9) / 2;
    const ribH = Math.max(4, (hz * 2) * 0.55) / 2;
    const ribA = boxFacets({ lx: ribL, wy: ribW, hz: ribH, tx: -lx * 0.52, ty: -wy + (2 * t), tz: hz * 0.44 });
    const ribB = boxFacets({ lx: ribL, wy: ribW, hz: ribH, tx: lx * 0.52, ty: -wy + (2 * t), tz: hz * 0.44 });
    return buildCompoundStl(name, [baseFaces, wallFaces, ribA, ribB]);
  }

  if (effectiveType === 'housing') {
    const l = Math.max(10, Number(length) || 120);
    const w = Math.max(10, Number(width) || 40);
    const h = Math.max(10, Number(height) || 30);
    const wall = Math.max(1, Math.min(w * 0.12, h * 0.2));
    const floor = boxFacets({ lx: l / 2, wy: w / 2, hz: wall / 2, tx: 0, ty: 0, tz: 0 });
    const sideA = boxFacets({ lx: l / 2, wy: wall / 2, hz: (h - wall) / 2, tx: 0, ty: (w / 2) - (wall / 2), tz: h / 2 });
    const sideB = boxFacets({ lx: l / 2, wy: wall / 2, hz: (h - wall) / 2, tx: 0, ty: -(w / 2) + (wall / 2), tz: h / 2 });
    const sideC = boxFacets({ lx: wall / 2, wy: (w - 2 * wall) / 2, hz: (h - wall) / 2, tx: (l / 2) - (wall / 2), ty: 0, tz: h / 2 });
    const sideD = boxFacets({ lx: wall / 2, wy: (w - 2 * wall) / 2, hz: (h - wall) / 2, tx: -(l / 2) + (wall / 2), ty: 0, tz: h / 2 });
    const rimA = boxFacets({ lx: (l - wall) / 2, wy: wall / 2, hz: wall / 2, tx: 0, ty: (w / 2) - wall, tz: h - (wall / 2) });
    const rimB = boxFacets({ lx: (l - wall) / 2, wy: wall / 2, hz: wall / 2, tx: 0, ty: -(w / 2) + wall, tz: h - (wall / 2) });
    const rimC = boxFacets({ lx: wall / 2, wy: (w - 2.5 * wall) / 2, hz: wall / 2, tx: (l / 2) - wall, ty: 0, tz: h - (wall / 2) });
    const rimD = boxFacets({ lx: wall / 2, wy: (w - 2.5 * wall) / 2, hz: wall / 2, tx: -(l / 2) + wall, ty: 0, tz: h - (wall / 2) });
    const bossD = Math.max(3, wall * 1.7);
    const bossR = bossD / 2;
    const bossH = Math.max(2, h * 0.28);
    const bx = (l / 2) - (2.2 * wall);
    const by = (w / 2) - (2.2 * wall);
    const boss1 = solidFaces(buildCylinderStl({ radius: bossR, height: bossH, segments: adaptiveSegments(bossR, 22), name: `${name}_b1` }))
      .map((line) => shiftFacetLine(line, bx, by, (bossH / 2) + wall));
    const boss2 = solidFaces(buildCylinderStl({ radius: bossR, height: bossH, segments: adaptiveSegments(bossR, 22), name: `${name}_b2` }))
      .map((line) => shiftFacetLine(line, -bx, by, (bossH / 2) + wall));
    const boss3 = solidFaces(buildCylinderStl({ radius: bossR, height: bossH, segments: adaptiveSegments(bossR, 22), name: `${name}_b3` }))
      .map((line) => shiftFacetLine(line, bx, -by, (bossH / 2) + wall));
    const boss4 = solidFaces(buildCylinderStl({ radius: bossR, height: bossH, segments: adaptiveSegments(bossR, 22), name: `${name}_b4` }))
      .map((line) => shiftFacetLine(line, -bx, -by, (bossH / 2) + wall));
    return buildCompoundStl(name, [floor, sideA, sideB, sideC, sideD, rimA, rimB, rimC, rimD, boss1, boss2, boss3, boss4]);
  }

  const lx = length / 2;
  const wy = width / 2;
  const hz = height / 2;
  const faces = boxFacets({ lx, wy, hz, tx: 0, ty: 0, tz: 0 });
  return buildCompoundStl(name, [faces]);
}

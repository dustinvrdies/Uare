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
  if (['shaft', 'pin', 'dowel_pin', 'roller', 'axle'].includes(t)) return 'shaft';
  if (['washer', 'clutch_disc', 'disc', 'flywheel', 'brake_rotor'].includes(t)) return 'disc';
  if (['piston', 'bearing', 'cylinder_liner', 'cylinder', 'nut_hex'].includes(t)) return 'cylinder';
  return 'box';
}

function buildCylinderStl({ radius = 20, height = 30, segments = 24, name = 'uare_part' } = {}) {
  const r = Math.max(0.1, Number(radius) || 20);
  const h = Math.max(0.1, Number(height) || 30);
  const n = Math.max(12, Number(segments) || 24);
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

export function buildBoxStl({ length = 120, width = 40, height = 30, name = 'uare_part', envelopeType = 'box', partType = '' } = {}) {
  const effectiveType = normalizeEnvelopeType(envelopeType || partType);
  if (effectiveType === 'cylinder' || effectiveType === 'disc' || effectiveType === 'shaft') {
    const diameter = Math.max(1, Math.min(Number(length) || 120, Number(width) || 40));
    const cylHeight = effectiveType === 'disc' ? Math.max(1, Number(height) || 8) : Math.max(1, Number(height) || 30);
    return buildCylinderStl({ radius: diameter / 2, height: cylHeight, name });
  }

  const lx = length / 2;
  const wy = width / 2;
  const hz = height / 2;

  const v = {
    p000: [-lx, -wy, -hz],
    p001: [-lx, -wy,  hz],
    p010: [-lx,  wy, -hz],
    p011: [-lx,  wy,  hz],
    p100: [ lx, -wy, -hz],
    p101: [ lx, -wy,  hz],
    p110: [ lx,  wy, -hz],
    p111: [ lx,  wy,  hz],
  };

  const faces = [
    facet( 1, 0, 0, v.p100, v.p101, v.p111), facet( 1, 0, 0, v.p100, v.p111, v.p110),
    facet(-1, 0, 0, v.p000, v.p011, v.p001), facet(-1, 0, 0, v.p000, v.p010, v.p011),
    facet( 0, 1, 0, v.p010, v.p110, v.p111), facet( 0, 1, 0, v.p010, v.p111, v.p011),
    facet( 0,-1, 0, v.p000, v.p001, v.p101), facet( 0,-1, 0, v.p000, v.p101, v.p100),
    facet( 0, 0, 1, v.p001, v.p011, v.p111), facet( 0, 0, 1, v.p001, v.p111, v.p101),
    facet( 0, 0,-1, v.p000, v.p100, v.p110), facet( 0, 0,-1, v.p000, v.p110, v.p010),
  ];

  return ['solid ' + name, ...faces, 'endsolid ' + name].join('\n');
}

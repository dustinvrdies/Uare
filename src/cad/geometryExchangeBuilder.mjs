
import { Buffer } from 'buffer';

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function normalizeDimensionValue(value, fallback = 1) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function normalizeEnvelopeType(type = '') {
  const t = String(type || '').toLowerCase();
  if (!t) return 'box';
  if (['shaft', 'pin', 'dowel_pin', 'roller', 'axle', 'stud', 'rod'].includes(t)) return 'shaft';
  if (['washer', 'clutch_disc', 'disc', 'flywheel', 'brake_rotor', 'pulley', 'sprocket'].includes(t)) return 'disc';
  if (['piston', 'bearing', 'cylinder_liner', 'cylinder', 'nut_hex', 'spacer'].includes(t)) return 'cylinder';
  if (['tube', 'pipe', 'bushing', 'sleeve', 'liner'].includes(t)) return 'tube';
  if (['flange', 'hub'].includes(t)) return 'flange';
  if (['bracket', 'mount', 'angle_bracket', 'corner_bracket'].includes(t)) return 'bracket';
  if (['housing', 'case', 'enclosure'].includes(t)) return 'housing';
  if (['gear', 'bevel_gear', 'worm_wheel', 'timing_pulley', 'ring_gear'].includes(t)) return 'gear';
  return 'box';
}

function translateGeometry(geometry = {}, tx = 0, ty = 0, tz = 0) {
  const vertices = [];
  for (let i = 0; i < (geometry.vertices || []).length; i += 3) {
    vertices.push(
      Number(geometry.vertices[i] || 0) + tx,
      Number(geometry.vertices[i + 1] || 0) + ty,
      Number(geometry.vertices[i + 2] || 0) + tz,
    );
  }
  return {
    vertices,
    normals: [...(geometry.normals || [])],
    uvs: [...(geometry.uvs || [])],
    indices: [...(geometry.indices || [])],
    bounds: geometry.bounds || null,
  };
}

function mergeGeometries(parts = []) {
  const merged = { vertices: [], normals: [], uvs: [], indices: [] };
  let vertexOffset = 0;
  for (const geometry of parts) {
    if (!geometry) continue;
    merged.vertices.push(...(geometry.vertices || []));
    merged.normals.push(...(geometry.normals || []));
    merged.uvs.push(...(geometry.uvs || []));
    for (const idx of geometry.indices || []) merged.indices.push(idx + vertexOffset);
    vertexOffset += Math.floor((geometry.vertices || []).length / 3);
  }
  const bounds = computeBounds(merged.vertices);
  return {
    ...merged,
    bounds,
  };
}

function makeBoxGeometry({ length = 120, width = 40, height = 30 } = {}) {
  const lx = Number(length) / 2;
  const wy = Number(width) / 2;
  const hz = Number(height) / 2;

  const vertices = [
    // +X
    lx, -wy, -hz,  lx,  wy, -hz,  lx,  wy,  hz,  lx, -wy,  hz,
    // -X
   -lx, -wy,  hz, -lx,  wy,  hz, -lx,  wy, -hz, -lx, -wy, -hz,
    // +Y
   -lx,  wy, -hz, -lx,  wy,  hz,  lx,  wy,  hz,  lx,  wy, -hz,
    // -Y
   -lx, -wy,  hz, -lx, -wy, -hz,  lx, -wy, -hz,  lx, -wy,  hz,
    // +Z
   -lx, -wy,  hz,  lx, -wy,  hz,  lx,  wy,  hz, -lx,  wy,  hz,
    // -Z
   -lx,  wy, -hz,  lx,  wy, -hz,  lx, -wy, -hz, -lx, -wy, -hz,
  ];

  const normals = [
    // +X
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    // -X
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
    // +Y
    0,1,0, 0,1,0, 0,1,0, 0,1,0,
    // -Y
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    // +Z
    0,0,1, 0,0,1, 0,0,1, 0,0,1,
    // -Z
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
  ];

  const uvs = [
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
  ];

  const indices = [];
  for (let face = 0; face < 6; face += 1) {
    const offset = face * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }

  const bounds = {
    min: [-lx, -wy, -hz],
    max: [lx, wy, hz],
  };

  return { vertices, normals, uvs, indices, bounds };
}

function makeCylinderGeometry({ diameter = 40, height = 30, segments = 24 } = {}) {
  const r = Math.max(0.1, Number(diameter || 40) / 2);
  const h = Math.max(0.1, Number(height || 30));
  const hz = h / 2;
  const n = Math.max(12, Number(segments) || 24);

  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // Side wall vertices (two rings)
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const u = i / n;
    vertices.push(x, y, -hz, x, y, hz);
    normals.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 0);
    uvs.push(u, 0, u, 1);
  }

  for (let i = 0; i < n; i += 1) {
    const k = i * 2;
    indices.push(k, k + 2, k + 3, k, k + 3, k + 1);
  }

  const sideVertexCount = vertices.length / 3;

  // Top center
  vertices.push(0, 0, hz);
  normals.push(0, 0, 1);
  uvs.push(0.5, 0.5);
  const topCenter = sideVertexCount;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    vertices.push(x, y, hz);
    normals.push(0, 0, 1);
    uvs.push((x / (2 * r)) + 0.5, (y / (2 * r)) + 0.5);
  }
  const topRingStart = topCenter + 1;
  for (let i = 0; i < n; i += 1) {
    indices.push(topCenter, topRingStart + i, topRingStart + i + 1);
  }

  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, -hz);
  normals.push(0, 0, -1);
  uvs.push(0.5, 0.5);
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    vertices.push(x, y, -hz);
    normals.push(0, 0, -1);
    uvs.push((x / (2 * r)) + 0.5, (y / (2 * r)) + 0.5);
  }
  const bottomRingStart = bottomCenter + 1;
  for (let i = 0; i < n; i += 1) {
    indices.push(bottomCenter, bottomRingStart + i + 1, bottomRingStart + i);
  }

  return {
    vertices,
    normals,
    uvs,
    indices,
    bounds: { min: [-r, -r, -hz], max: [r, r, hz] },
  };
}

function makeTubeGeometry({ outerDiameter = 40, innerDiameter = 26, height = 30, segments = 28 } = {}) {
  const od = Math.max(1, Number(outerDiameter || 40));
  const id = Math.max(0.2, Math.min(Number(innerDiameter || 26), od - 0.2));
  const ro = od / 2;
  const ri = id / 2;
  const h = Math.max(0.1, Number(height || 30));
  const hz = h / 2;
  const n = Math.max(12, Number(segments) || 28);

  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const sy = Math.sin(a);

    // Outer wall ring
    vertices.push(cx * ro, sy * ro, -hz, cx * ro, sy * ro, hz);
    normals.push(cx, sy, 0, cx, sy, 0);
    uvs.push(i / n, 0, i / n, 1);

    // Inner wall ring
    vertices.push(cx * ri, sy * ri, -hz, cx * ri, sy * ri, hz);
    normals.push(-cx, -sy, 0, -cx, -sy, 0);
    uvs.push(i / n, 0, i / n, 1);
  }

  for (let i = 0; i < n; i += 1) {
    const k = i * 4;
    // outer
    indices.push(k, k + 4, k + 5, k, k + 5, k + 1);
    // inner (reversed winding)
    indices.push(k + 2, k + 3, k + 7, k + 2, k + 7, k + 6);
    // top ring
    indices.push(k + 1, k + 5, k + 7, k + 1, k + 7, k + 3);
    // bottom ring
    indices.push(k, k + 2, k + 6, k, k + 6, k + 4);
  }

  return {
    vertices,
    normals,
    uvs,
    indices,
    bounds: { min: [-ro, -ro, -hz], max: [ro, ro, hz] },
  };
}

function makeFlangeGeometry({ diameter = 70, thickness = 12 } = {}) {
  const d = Math.max(1, Number(diameter || 70));
  const t = Math.max(1, Number(thickness || 12));
  const base = makeTubeGeometry({
    outerDiameter: d,
    innerDiameter: d * 0.35,
    height: t,
    segments: 36,
  });
  const lugLen = Math.max(2, d * 0.16);
  const lugWid = Math.max(2, d * 0.12);
  const lugHz = t / 2;
  const ringR = (d / 2) + (lugLen / 2) * 0.7;
  const lugs = [
    translateGeometry(makeBoxGeometry({ length: lugLen, width: lugWid, height: t }), ringR, 0, 0),
    translateGeometry(makeBoxGeometry({ length: lugLen, width: lugWid, height: t }), -ringR, 0, 0),
    translateGeometry(makeBoxGeometry({ length: lugWid, width: lugLen, height: t }), 0, ringR, 0),
    translateGeometry(makeBoxGeometry({ length: lugWid, width: lugLen, height: t }), 0, -ringR, 0),
  ];
  return mergeGeometries([base, ...lugs, translateGeometry(makeCylinderGeometry({ diameter: d * 0.52, height: t * 0.58, segments: 28 }), 0, 0, 0)]);
}

function makeShaftGeometry({ diameter = 40, height = 120 } = {}) {
  const d = Math.max(1, Number(diameter || 40));
  const h = Math.max(2, Number(height || 120));
  const body = makeCylinderGeometry({ diameter: d, height: h, segments: 30 });
  const collar = makeCylinderGeometry({ diameter: d * 1.24, height: Math.max(2, h * 0.18), segments: 30 });
  const key = makeBoxGeometry({
    length: Math.max(2, d * 0.34),
    width: Math.max(1.4, d * 0.12),
    height: Math.max(3, h * 0.46),
  });
  const keyPlaced = translateGeometry(key, (d / 2) - (d * 0.08), 0, 0);
  return mergeGeometries([body, collar, keyPlaced]);
}

function makeBracketGeometry({ length = 100, width = 60, height = 70, thickness = 8 } = {}) {
  const l = Math.max(10, Number(length || 100));
  const w = Math.max(10, Number(width || 60));
  const h = Math.max(10, Number(height || 70));
  const t = Math.max(1, Math.min(Number(thickness || 8), Math.min(w, h) * 0.8));

  const base = makeBoxGeometry({ length: l, width: w, height: t });
  const wall = makeBoxGeometry({ length: l, width: t, height: h });
  const wallPlaced = translateGeometry(wall, 0, -(w / 2) + (t / 2), (h / 2) - (t / 2));
  const ribL = Math.max(4, l * 0.24);
  const ribW = Math.max(2, t * 0.9);
  const ribH = Math.max(4, h * 0.55);
  const ribA = translateGeometry(makeBoxGeometry({ length: ribL, width: ribW, height: ribH }), -l * 0.26, -(w / 2) + t, h * 0.22);
  const ribB = translateGeometry(makeBoxGeometry({ length: ribL, width: ribW, height: ribH }), l * 0.26, -(w / 2) + t, h * 0.22);
  return mergeGeometries([base, wallPlaced, ribA, ribB]);
}

function makeHousingGeometry({ length = 120, width = 80, height = 60, wall = 6 } = {}) {
  const l = Math.max(10, Number(length || 120));
  const w = Math.max(10, Number(width || 80));
  const h = Math.max(10, Number(height || 60));
  const t = Math.max(1, Math.min(Number(wall || 6), Math.min(l, w, h) * 0.25));

  const floor = makeBoxGeometry({ length: l, width: w, height: t });
  const sideA = translateGeometry(makeBoxGeometry({ length: l, width: t, height: h - t }), 0, (w / 2) - (t / 2), (h / 2));
  const sideB = translateGeometry(makeBoxGeometry({ length: l, width: t, height: h - t }), 0, -(w / 2) + (t / 2), (h / 2));
  const sideC = translateGeometry(makeBoxGeometry({ length: t, width: w - 2 * t, height: h - t }), (l / 2) - (t / 2), 0, (h / 2));
  const sideD = translateGeometry(makeBoxGeometry({ length: t, width: w - 2 * t, height: h - t }), -(l / 2) + (t / 2), 0, (h / 2));
  const rimZ = h - (t / 2);
  const rimA = translateGeometry(makeBoxGeometry({ length: l - t, width: t, height: t }), 0, (w / 2) - t, rimZ);
  const rimB = translateGeometry(makeBoxGeometry({ length: l - t, width: t, height: t }), 0, -(w / 2) + t, rimZ);
  const rimC = translateGeometry(makeBoxGeometry({ length: t, width: w - 2.5 * t, height: t }), (l / 2) - t, 0, rimZ);
  const rimD = translateGeometry(makeBoxGeometry({ length: t, width: w - 2.5 * t, height: t }), -(l / 2) + t, 0, rimZ);
  const bossD = Math.max(3, t * 1.7);
  const bossH = Math.max(2, h * 0.28);
  const bx = (l / 2) - (2.2 * t);
  const by = (w / 2) - (2.2 * t);
  const boss1 = translateGeometry(makeCylinderGeometry({ diameter: bossD, height: bossH, segments: 18 }), bx, by, (bossH / 2) + t);
  const boss2 = translateGeometry(makeCylinderGeometry({ diameter: bossD, height: bossH, segments: 18 }), -bx, by, (bossH / 2) + t);
  const boss3 = translateGeometry(makeCylinderGeometry({ diameter: bossD, height: bossH, segments: 18 }), bx, -by, (bossH / 2) + t);
  const boss4 = translateGeometry(makeCylinderGeometry({ diameter: bossD, height: bossH, segments: 18 }), -bx, -by, (bossH / 2) + t);
  return mergeGeometries([floor, sideA, sideB, sideC, sideD, rimA, rimB, rimC, rimD, boss1, boss2, boss3, boss4]);
}

function makeGearLikeGeometry({ diameter = 60, height = 14, teeth = 18 } = {}) {
  const d = Math.max(4, Number(diameter || 60));
  const h = Math.max(1, Number(height || 14));
  const t = Math.max(8, Number(teeth || 18));
  const base = makeCylinderGeometry({ diameter: d * 0.86, height: h, segments: Math.max(24, t * 2) });
  const toothLen = Math.max(1.5, d * 0.07);
  const toothW = Math.max(1.5, (Math.PI * d) / (t * 5));
  const toothH = h;
  const teethGeos = [];
  for (let i = 0; i < t; i += 1) {
    const a = (i / t) * Math.PI * 2;
    const tx = Math.cos(a) * ((d * 0.86) / 2 + toothLen / 2);
    const ty = Math.sin(a) * ((d * 0.86) / 2 + toothLen / 2);
    const tooth = makeBoxGeometry({ length: toothLen, width: toothW, height: toothH });
    // keep axis-aligned tooth boxes; still gives a realistic toothed silhouette.
    teethGeos.push(translateGeometry(tooth, tx, ty, 0));
  }
  return mergeGeometries([base, ...teethGeos]);
}

function makeEnvelopeGeometry({ length = 120, width = 40, height = 30, envelopeType = 'box', partType = '' } = {}) {
  const effectiveType = normalizeEnvelopeType(envelopeType || partType);
  if (effectiveType === 'cylinder' || effectiveType === 'disc') {
    const diameter = Math.max(1, Math.min(Number(length) || 120, Number(width) || 40));
    const cylHeight = effectiveType === 'disc' ? Math.max(1, Number(height) || 8) : Math.max(1, Number(height) || 30);
    return { kind: effectiveType, geometry: makeCylinderGeometry({ diameter, height: cylHeight }) };
  }
  if (effectiveType === 'shaft') {
    const diameter = Math.max(1, Math.min(Number(length) || 120, Number(width) || 40));
    return { kind: effectiveType, geometry: makeShaftGeometry({ diameter, height: Math.max(1, Number(height) || 60) }) };
  }
  if (effectiveType === 'tube') {
    const diameter = Math.max(2, Math.min(Number(length) || 120, Number(width) || 40));
    const inner = Math.max(0.2, diameter * 0.62);
    return { kind: effectiveType, geometry: makeTubeGeometry({ outerDiameter: diameter, innerDiameter: inner, height: Math.max(1, Number(height) || 30) }) };
  }
  if (effectiveType === 'flange') {
    const diameter = Math.max(2, Math.min(Number(length) || 120, Number(width) || 40));
    return { kind: effectiveType, geometry: makeFlangeGeometry({ diameter, thickness: Math.max(1, Number(height) || 12) }) };
  }
  if (effectiveType === 'bracket') {
    return {
      kind: effectiveType,
      geometry: makeBracketGeometry({
        length: Math.max(10, Number(length) || 120),
        width: Math.max(10, Number(width) || 40),
        height: Math.max(10, Number(height) || 30),
        thickness: Math.max(1, Math.min((Number(width) || 40) * 0.2, (Number(height) || 30) * 0.35)),
      }),
    };
  }
  if (effectiveType === 'housing') {
    return {
      kind: effectiveType,
      geometry: makeHousingGeometry({
        length: Math.max(10, Number(length) || 120),
        width: Math.max(10, Number(width) || 40),
        height: Math.max(10, Number(height) || 30),
        wall: Math.max(1, Math.min((Number(width) || 40) * 0.12, (Number(height) || 30) * 0.2)),
      }),
    };
  }
  if (effectiveType === 'gear') {
    const diameter = Math.max(6, Math.min(Number(length) || 120, Number(width) || 40));
    return {
      kind: effectiveType,
      geometry: makeGearLikeGeometry({ diameter, height: Math.max(1, Number(height) || 14), teeth: Math.max(10, Math.round(diameter / 3)) }),
    };
  }
  return { kind: 'box', geometry: makeBoxGeometry({ length, width, height }) };
}

function packFloats(values = []) {
  const array = new Float32Array(values);
  return Buffer.from(array.buffer);
}

function packUInt16(values = []) {
  const array = new Uint16Array(values);
  return Buffer.from(array.buffer);
}

function pad4(buffer) {
  const pad = (4 - (buffer.length % 4)) % 4;
  return pad ? Buffer.concat([buffer, Buffer.alloc(pad)]) : buffer;
}

function computeBounds(values = []) {
  const triples = [];
  for (let i = 0; i < values.length; i += 3) triples.push([values[i], values[i+1], values[i+2]]);
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  triples.forEach(([x,y,z]) => {
    mins[0] = Math.min(mins[0], x); mins[1] = Math.min(mins[1], y); mins[2] = Math.min(mins[2], z);
    maxs[0] = Math.max(maxs[0], x); maxs[1] = Math.max(maxs[1], y); maxs[2] = Math.max(maxs[2], z);
  });
  return { min: mins.map((v) => round(v, 6)), max: maxs.map((v) => round(v, 6)) };
}

export function buildObjMesh({ length = 120, width = 40, height = 30, name = 'uare_part', envelopeType = 'box', partType = '' } = {}) {
  const { geometry } = makeEnvelopeGeometry({ length, width, height, envelopeType, partType });
  const { vertices, normals, uvs } = geometry;
  const lines = [`# UARE OBJ export`, `o ${name}`];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(`v ${round(vertices[i], 6)} ${round(vertices[i + 1], 6)} ${round(vertices[i + 2], 6)}`);
  }
  for (let i = 0; i < uvs.length; i += 2) {
    lines.push(`vt ${round(uvs[i], 6)} ${round(uvs[i + 1], 6)}`);
  }
  for (let i = 0; i < normals.length; i += 3) {
    lines.push(`vn ${round(normals[i], 6)} ${round(normals[i + 1], 6)} ${round(normals[i + 2], 6)}`);
  }
  for (let i = 0; i < geometry.indices.length; i += 3) {
    const a = geometry.indices[i] + 1;
    const b = geometry.indices[i + 1] + 1;
    const c = geometry.indices[i + 2] + 1;
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }
  return lines.join('\n') + '\n';
}

export function buildStepEnvelope({ length = 120, width = 40, height = 30, name = 'UARE_BOX', envelopeType = 'box', partType = '' } = {}) {
  const effectiveType = normalizeEnvelopeType(envelopeType || partType);
  const lx = round(Number(length), 4);
  const wy = round(Number(width), 4);
  const hz = round(Number(height), 4);
  const diameter = round(Math.max(1, Math.min(lx, wy)), 4);
  const radius = round(diameter / 2, 4);
  const now = new Date().toISOString();
  const shapeEntity = (effectiveType === 'cylinder' || effectiveType === 'disc' || effectiveType === 'shaft')
    ? `#14=RIGHT_CIRCULAR_CYLINDER('${name}',#13,${round(hz, 4)},${radius});`
    : `#14=BLOCK('${name}',#13,${lx},${wy},${hz});`;
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('UARE generated STEP AP214 export'),'2;1');",
    `FILE_NAME('${name}.step','${now}',('OpenAI'),('OpenAI'),'UARE Inventor OS','UARE CAD Pipeline','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
    `#10=CARTESIAN_POINT('',(0.,0.,0.));`,
    `#11=DIRECTION('',(1.,0.,0.));`,
    `#12=DIRECTION('',(0.,1.,0.));`,
    `#13=AXIS2_PLACEMENT_3D('',#10,#11,#12);`,
    shapeEntity,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

export function buildGlbBox({ length = 120, width = 40, height = 30, name = 'UARE Part', envelopeType = 'box', partType = '' } = {}) {
  const { geometry } = makeEnvelopeGeometry({ length, width, height, envelopeType, partType });
  const positionBuffer = packFloats(geometry.vertices);
  const normalBuffer = packFloats(geometry.normals);
  const uvBuffer = packFloats(geometry.uvs);
  const indexBuffer = packUInt16(geometry.indices);

  const chunks = [
    pad4(positionBuffer),
    pad4(normalBuffer),
    pad4(uvBuffer),
    pad4(indexBuffer),
  ];

  const offsets = [];
  let runningOffset = 0;
  chunks.forEach((chunk) => {
    offsets.push(runningOffset);
    runningOffset += chunk.length;
  });
  const binChunk = Buffer.concat(chunks);
  const posBounds = computeBounds(geometry.vertices);

  const json = {
    asset: { version: '2.0', generator: 'UARE Inventor OS' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: 'UARE Material',
      pbrMetallicRoughness: {
        baseColorFactor: [0.329, 0.843, 1, 1],
        metallicFactor: 0.08,
        roughnessFactor: 0.42,
      },
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: geometry.vertices.length / 3, type: 'VEC3', min: posBounds.min, max: posBounds.max },
      { bufferView: 1, componentType: 5126, count: geometry.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: geometry.uvs.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: geometry.indices.length, type: 'SCALAR', min: [0], max: [Math.max(...geometry.indices)] },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: positionBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: normalBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: uvBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: indexBuffer.length, target: 34963 },
    ],
    buffers: [{ byteLength: binChunk.length }],
  };

  const jsonBuffer = pad4(Buffer.from(JSON.stringify(json), 'utf8'));
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.write('JSON', 4, 4, 'ascii');

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binChunk.length, 0);
  binChunkHeader.write('BIN\0', 4, 4, 'ascii');

  const totalLength = 12 + jsonChunkHeader.length + jsonBuffer.length + binChunkHeader.length + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer, binChunkHeader, binChunk]);
}

export function buildGlbAssembly(parts = [], name = 'UARE Assembly') {
  const geos = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] || {};
    const dims = part.dimensions_mm || {};
    const length = normalizeDimensionValue(dims.x ?? dims.length ?? dims.width, 20);
    const width = normalizeDimensionValue(dims.y ?? dims.width ?? dims.depth, 20);
    const height = normalizeDimensionValue(dims.z ?? dims.height ?? dims.thickness, 20);
    const partType = part.shape || part.kind || 'box';
    const { geometry } = makeEnvelopeGeometry({ length, width, height, partType });

    const tr = part.transform_mm || {};
    const tx = Number.isFinite(Number(tr.x)) ? Number(tr.x) : 0;
    const ty = Number.isFinite(Number(tr.y)) ? Number(tr.y) : 0;
    const tz = Number.isFinite(Number(tr.z)) ? Number(tr.z) : 0;

    geos.push(translateGeometry(geometry, tx, ty, tz));
  }

  const merged = mergeGeometries(geos);
  const positionBuffer = packFloats(merged.vertices);
  const normalBuffer = packFloats(merged.normals);
  const uvBuffer = packFloats(merged.uvs);
  const indexBuffer = packUInt16(merged.indices);

  const chunks = [pad4(positionBuffer), pad4(normalBuffer), pad4(uvBuffer), pad4(indexBuffer)];
  const offsets = [];
  let runningOffset = 0;
  chunks.forEach((chunk) => {
    offsets.push(runningOffset);
    runningOffset += chunk.length;
  });
  const binChunk = Buffer.concat(chunks);
  const posBounds = computeBounds(merged.vertices);
  const maxIndex = merged.indices.length ? Math.max(...merged.indices) : 0;

  const json = {
    asset: { version: '2.0', generator: 'UARE Inventor OS' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: 'UARE Assembly Material',
      pbrMetallicRoughness: {
        baseColorFactor: [0.61, 0.69, 0.78, 1],
        metallicFactor: 0.22,
        roughnessFactor: 0.48,
      },
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: merged.vertices.length / 3, type: 'VEC3', min: posBounds.min, max: posBounds.max },
      { bufferView: 1, componentType: 5126, count: merged.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: merged.uvs.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: merged.indices.length, type: 'SCALAR', min: [0], max: [maxIndex] },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: positionBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: normalBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: uvBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: indexBuffer.length, target: 34963 },
    ],
    buffers: [{ byteLength: binChunk.length }],
  };

  const jsonBuffer = pad4(Buffer.from(JSON.stringify(json), 'utf8'));
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.write('JSON', 4, 4, 'ascii');

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binChunk.length, 0);
  binChunkHeader.write('BIN\0', 4, 4, 'ascii');

  const totalLength = 12 + jsonChunkHeader.length + jsonBuffer.length + binChunkHeader.length + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer, binChunkHeader, binChunk]);
}

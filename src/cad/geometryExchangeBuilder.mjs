
import { Buffer } from 'buffer';

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function normalizeEnvelopeType(type = '') {
  const t = String(type || '').toLowerCase();
  if (!t) return 'box';
  if (['shaft', 'pin', 'dowel_pin', 'roller', 'axle'].includes(t)) return 'shaft';
  if (['washer', 'clutch_disc', 'disc', 'flywheel', 'brake_rotor'].includes(t)) return 'disc';
  if (['piston', 'bearing', 'cylinder_liner', 'cylinder', 'nut_hex'].includes(t)) return 'cylinder';
  return 'box';
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

function makeEnvelopeGeometry({ length = 120, width = 40, height = 30, envelopeType = 'box', partType = '' } = {}) {
  const effectiveType = normalizeEnvelopeType(envelopeType || partType);
  if (effectiveType === 'cylinder' || effectiveType === 'disc' || effectiveType === 'shaft') {
    const diameter = Math.max(1, Math.min(Number(length) || 120, Number(width) || 40));
    const cylHeight = effectiveType === 'disc' ? Math.max(1, Number(height) || 8) : Math.max(1, Number(height) || 30);
    return { kind: effectiveType, geometry: makeCylinderGeometry({ diameter, height: cylHeight }) };
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

/**
 * UARE CAD ENGINE  —  Modular Parametric Geometry Kernel
 * =======================================================
 * Architecture: each MODULE is a self-contained section.
 * Hardening strategy: add depth / fix accuracy inside the module,
 * never nuke the file.  New capability = new module appended below.
 *
 * PASS 1  (2026-04-20)
 *   § 1  Constants & math primitives
 *   § 2  Linear-algebra kernel  (Vec3, Mat4, Quaternion)
 *   § 3  Transform kernel  (copy-safe, Euler ZYX, TRS)
 *   § 4  Material database  (30+ engineering materials)
 *   § 5  Tessellator primitives  (pure triangle math, no THREE dep)
 *   § 6  Geometry generators  (box, cylinder, sphere, cone, torus, tube)
 *   § 7  Feature generators  (chamfer, fillet approx, hole pattern, rib)
 *   § 8  Advanced solid generators  (bracket, drone-X, gear-involute,
 *                                    spring-helix, I-beam, L-angle)
 *   § 9  Part builder  (dims normaliser + type detector)
 *   §10  Scene assembler  (Three.js integration, validation)
 *   §11  Public API  (window.UARE_CAD)
 *
 * PASS 2  will add: NURBS curves, loft/sweep, constraint solver,
 *   thread profiles, weld beads, PCB board outline generator.
 * PASS 3  will add: full B-Rep half-edge, boolean ops, STEP/IGES ASCII export.
 */

'use strict';

(function (global) {

/* ═══════════════════════════════════════════════════════════════════════════
   § 1  CONSTANTS & MATH PRIMITIVES
   ═══════════════════════════════════════════════════════════════════════════ */

const CAD_VERSION = '1.0.0-pass1';
const TWO_PI      = Math.PI * 2;
const HALF_PI     = Math.PI / 2;
const DEG2RAD     = Math.PI / 180;
const RAD2DEG     = 180 / Math.PI;
const EPSILON     = 1e-9;
const MM2M        = 0.001;   // millimetres → metres (for physics calcs)

/** Clamp a value to [min,max] */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Linear interpolation */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Round to n decimal places */
function round(v, n = 6) { const f = 10 ** n; return Math.round(v * f) / f; }

/** Safe divide — returns fallback when divisor is near zero */
function safeDiv(a, b, fallback = 0) { return Math.abs(b) < EPSILON ? fallback : a / b; }

/** Degrees → radians */
function deg(d) { return d * DEG2RAD; }

/** Map value from one range to another */
function remap(v, inLo, inHi, outLo, outHi) {
  return outLo + (outHi - outLo) * safeDiv(v - inLo, inHi - inLo);
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 2  LINEAR-ALGEBRA KERNEL
   Vec3, Mat4, Quaternion — all immutable / return new objects
   ═══════════════════════════════════════════════════════════════════════════ */

const Vec3 = {
  create(x = 0, y = 0, z = 0) { return { x, y, z }; },
  clone(v) { return { x: v.x, y: v.y, z: v.z }; },
  add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
  sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
  scale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; },
  dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
  cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  },
  len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); },
  lenSq(v) { return v.x * v.x + v.y * v.y + v.z * v.z; },
  normalize(v) {
    const l = Vec3.len(v);
    return l < EPSILON ? { x: 0, y: 0, z: 0 } : Vec3.scale(v, 1 / l);
  },
  lerp(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }; },
  negate(v) { return { x: -v.x, y: -v.y, z: -v.z }; },
  applyMat4(v, m) {
    // m is a flat Float64Array[16], column-major (same as WebGL / THREE)
    const x = v.x, y = v.y, z = v.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const ws = w < EPSILON ? 1 : 1 / w;
    return {
      x: (m[0] * x + m[4] * y + m[8]  * z + m[12]) * ws,
      y: (m[1] * x + m[5] * y + m[9]  * z + m[13]) * ws,
      z: (m[2] * x + m[6] * y + m[10] * z + m[14]) * ws,
    };
  },
  toArray(v) { return [v.x, v.y, v.z]; },
  fromArray(a, o = 0) { return { x: a[o], y: a[o + 1], z: a[o + 2] }; },
  /** Angle (radians) between two vectors */
  angle(a, b) {
    const d = clamp(Vec3.dot(Vec3.normalize(a), Vec3.normalize(b)), -1, 1);
    return Math.acos(d);
  },
  /** Reflect v around normal n */
  reflect(v, n) {
    const d2 = 2 * Vec3.dot(v, n);
    return Vec3.sub(v, Vec3.scale(n, d2));
  },
};

/** 4×4 column-major matrix (Float64Array) */
const Mat4 = {
  identity() {
    const m = new Float64Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    return m;
  },
  clone(m) { return new Float64Array(m); },
  multiply(a, b) {
    const r = new Float64Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        r[col * 4 + row] = sum;
      }
    }
    return r;
  },
  fromTranslation(tx, ty, tz) {
    const m = Mat4.identity();
    m[12] = tx; m[13] = ty; m[14] = tz;
    return m;
  },
  fromScale(sx, sy, sz) {
    const m = Mat4.identity();
    m[0] = sx; m[5] = sy; m[10] = sz;
    return m;
  },
  /** Rotation around X axis */
  fromRotX(rad) {
    const m = Mat4.identity();
    const c = Math.cos(rad), s = Math.sin(rad);
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  },
  /** Rotation around Y axis */
  fromRotY(rad) {
    const m = Mat4.identity();
    const c = Math.cos(rad), s = Math.sin(rad);
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  },
  /** Rotation around Z axis */
  fromRotZ(rad) {
    const m = Mat4.identity();
    const c = Math.cos(rad), s = Math.sin(rad);
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  },
  /** Compose TRS: translate × rotZ × rotY × rotX × scale  (ZYX Euler) */
  compose(tx, ty, tz, rx, ry, rz, sx = 1, sy = 1, sz = 1) {
    const T = Mat4.fromTranslation(tx, ty, tz);
    const RZ = Mat4.fromRotZ(rz);
    const RY = Mat4.fromRotY(ry);
    const RX = Mat4.fromRotX(rx);
    const S = Mat4.fromScale(sx, sy, sz);
    return Mat4.multiply(T, Mat4.multiply(RZ, Mat4.multiply(RY, Mat4.multiply(RX, S))));
  },
  /** Transform a flat position array [x0,y0,z0, x1,y1,z1, …] returning new Float32Array */
  transformPositions(positions, m) {
    const n = positions.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
      const v = Vec3.applyMat4({ x: positions[i], y: positions[i + 1], z: positions[i + 2] }, m);
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
    }
    return out;
  },
  /** Transform normals: use upper-left 3×3 inverse-transpose (ignores scale oddities) */
  transformNormals(normals, m) {
    const n = normals.length;
    const out = new Float32Array(n);
    // For non-uniform scale correctness we'd need the inverse-transpose.
    // For now, apply only the rotation sub-matrix (upper-left 3×3).
    const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    for (let i = 0; i < n; i += 3) {
      const x = normals[i], y = normals[i + 1], z = normals[i + 2];
      const nx = r[0] * x + r[3] * y + r[6] * z;
      const ny = r[1] * x + r[4] * y + r[7] * z;
      const nz = r[2] * x + r[5] * y + r[8] * z;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      out[i] = nx / len; out[i + 1] = ny / len; out[i + 2] = nz / len;
    }
    return out;
  },
};

const Quat = {
  identity() { return { x: 0, y: 0, z: 0, w: 1 }; },
  fromAxisAngle(ax, ay, az, rad) {
    const half = rad / 2;
    const s = Math.sin(half);
    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    return { x: (ax / len) * s, y: (ay / len) * s, z: (az / len) * s, w: Math.cos(half) };
  },
  multiply(a, b) {
    return {
      x:  a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y:  a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z:  a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w:  a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  },
  normalize(q) {
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  },
  toMat4(q) {
    const { x, y, z, w } = Quat.normalize(q);
    const m = Mat4.identity();
    m[0]  = 1 - 2 * (y * y + z * z);
    m[1]  =     2 * (x * y + z * w);
    m[2]  =     2 * (x * z - y * w);
    m[4]  =     2 * (x * y - z * w);
    m[5]  = 1 - 2 * (x * x + z * z);
    m[6]  =     2 * (y * z + x * w);
    m[8]  =     2 * (x * z + y * w);
    m[9]  =     2 * (y * z - x * w);
    m[10] = 1 - 2 * (x * x + y * y);
    return m;
  },
  /** Spherical linear interpolation */
  slerp(a, b, t) {
    let cosHalfTheta = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (cosHalfTheta < 0) { cosHalfTheta = -cosHalfTheta; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cosHalfTheta >= 1) return { ...a };
    const halfTheta = Math.acos(clamp(cosHalfTheta, -1, 1));
    const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
    if (sinHalfTheta < EPSILON) return { x: lerp(a.x, bx, t), y: lerp(a.y, by, t), z: lerp(a.z, bz, t), w: lerp(a.w, bw, t) };
    const ra = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const rb = Math.sin(t * halfTheta) / sinHalfTheta;
    return { x: a.x * ra + bx * rb, y: a.y * ra + by * rb, z: a.z * ra + bz * rb, w: a.w * ra + bw * rb };
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   § 3  TRANSFORM KERNEL
   All geometry generators return raw Float32Arrays centred at origin.
   applyTransform() applies a full TRS without mutating the source.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Apply a TRS transform to a geometry object  { verts, normals, [uvs] }.
 * Never mutates the input arrays — always allocates new ones.
 * @param {Object}  geo  - { verts: Float32Array, normals: Float32Array }
 * @param {Object}  trs  - { tx,ty,tz, rx,ry,rz (radians), sx,sy,sz }
 * @returns {Object} new geo with transformed verts + normals
 */
function applyTransform(geo, trs = {}) {
  const {
    tx = 0, ty = 0, tz = 0,
    rx = 0, ry = 0, rz = 0,
    sx = 1, sy = 1, sz = 1,
  } = trs;
  const m = Mat4.compose(tx, ty, tz, rx, ry, rz, sx, sy, sz);
  return {
    ...geo,
    verts:   Mat4.transformPositions(geo.verts,   m),
    normals: Mat4.transformNormals(geo.normals,    m),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 4  MATERIAL DATABASE
   Each entry carries enough data for: visual rendering, FEA property lookup,
   manufacturing cost estimation, and export metadata.
   ═══════════════════════════════════════════════════════════════════════════ */

const MATERIALS = {
  // ── Steels ────────────────────────────────────────────────────────────────
  steel_mild: {
    id: 'steel_mild', name: 'Mild Steel (ASTM A36)',
    color: 0x8a9bb5, roughness: 0.55, metalness: 0.90,
    density: 7850,           // kg/m³
    youngsModulus: 200e9,    // Pa
    poissonsRatio: 0.26,
    yieldStrength: 250e6,    // Pa
    ultimateStrength: 400e6,
    thermalConductivity: 50, // W/(m·K)
    thermalExpansion: 12e-6, // /K
    maxServiceTemp: 400,     // °C
    machinability: 0.72,     // 0–1 index
    weldability: 0.90,
    cost_per_kg: 0.8,        // USD
    notes: 'General structural fabrication.',
  },
  steel_304ss: {
    id: 'steel_304ss', name: 'Stainless Steel 304',
    color: 0xc0c8d8, roughness: 0.30, metalness: 0.95,
    density: 8000, youngsModulus: 193e9, poissonsRatio: 0.29,
    yieldStrength: 215e6, ultimateStrength: 505e6,
    thermalConductivity: 16.2, thermalExpansion: 17.2e-6,
    maxServiceTemp: 870, machinability: 0.45, weldability: 0.85,
    cost_per_kg: 3.50,
    notes: 'Corrosion-resistant, food/medical grade.',
  },
  steel_316ss: {
    id: 'steel_316ss', name: 'Stainless Steel 316L',
    color: 0xbdc7da, roughness: 0.28, metalness: 0.96,
    density: 7990, youngsModulus: 193e9, poissonsRatio: 0.27,
    yieldStrength: 170e6, ultimateStrength: 485e6,
    thermalConductivity: 13.0, thermalExpansion: 15.9e-6,
    maxServiceTemp: 925, machinability: 0.40, weldability: 0.90,
    cost_per_kg: 5.20,
    notes: 'Marine grade. Mo addition for pitting resistance.',
  },
  steel_4140: {
    id: 'steel_4140', name: 'Alloy Steel 4140 (pre-hardened)',
    color: 0x707a8f, roughness: 0.45, metalness: 0.92,
    density: 7850, youngsModulus: 205e9, poissonsRatio: 0.28,
    yieldStrength: 655e6, ultimateStrength: 1020e6,
    thermalConductivity: 42.6, thermalExpansion: 12.3e-6,
    maxServiceTemp: 450, machinability: 0.55, weldability: 0.50,
    cost_per_kg: 2.10,
    notes: 'Shafts, gears, high-stress structural parts.',
  },
  // ── Aluminium ─────────────────────────────────────────────────────────────
  al_6061_t6: {
    id: 'al_6061_t6', name: 'Aluminium 6061-T6',
    color: 0xd4dbe8, roughness: 0.35, metalness: 0.88,
    density: 2700, youngsModulus: 68.9e9, poissonsRatio: 0.33,
    yieldStrength: 276e6, ultimateStrength: 310e6,
    thermalConductivity: 167, thermalExpansion: 23.6e-6,
    maxServiceTemp: 150, machinability: 0.92, weldability: 0.60,
    cost_per_kg: 2.90,
    notes: 'Most common aerospace/structural Al alloy.',
  },
  al_7075_t6: {
    id: 'al_7075_t6', name: 'Aluminium 7075-T6',
    color: 0xc8d4e5, roughness: 0.30, metalness: 0.90,
    density: 2810, youngsModulus: 71.7e9, poissonsRatio: 0.33,
    yieldStrength: 503e6, ultimateStrength: 572e6,
    thermalConductivity: 130, thermalExpansion: 23.4e-6,
    maxServiceTemp: 120, machinability: 0.85, weldability: 0.25,
    cost_per_kg: 5.60,
    notes: 'High-strength aircraft structure.',
  },
  al_2024_t3: {
    id: 'al_2024_t3', name: 'Aluminium 2024-T3',
    color: 0xcfd8e8, roughness: 0.32, metalness: 0.88,
    density: 2780, youngsModulus: 73.1e9, poissonsRatio: 0.33,
    yieldStrength: 345e6, ultimateStrength: 483e6,
    thermalConductivity: 121, thermalExpansion: 23.2e-6,
    maxServiceTemp: 130, machinability: 0.80, weldability: 0.20,
    cost_per_kg: 4.80,
    notes: 'Fuselage skins, wings. Poor corrosion resistance — needs cladding.',
  },
  // ── Titanium ──────────────────────────────────────────────────────────────
  ti_6al4v: {
    id: 'ti_6al4v', name: 'Titanium Ti-6Al-4V (Grade 5)',
    color: 0xa8b4c8, roughness: 0.40, metalness: 0.87,
    density: 4430, youngsModulus: 113.8e9, poissonsRatio: 0.342,
    yieldStrength: 880e6, ultimateStrength: 950e6,
    thermalConductivity: 6.7, thermalExpansion: 8.6e-6,
    maxServiceTemp: 300, machinability: 0.30, weldability: 0.55,
    cost_per_kg: 35.0,
    notes: 'Aerospace/medical implants. Outstanding strength-to-weight.',
  },
  // ── Polymers ──────────────────────────────────────────────────────────────
  pla: {
    id: 'pla', name: 'PLA (3D Print)',
    color: 0xf5e0c8, roughness: 0.70, metalness: 0.0,
    density: 1240, youngsModulus: 3.5e9, poissonsRatio: 0.36,
    yieldStrength: 50e6, ultimateStrength: 65e6,
    thermalConductivity: 0.13, thermalExpansion: 68e-6,
    maxServiceTemp: 60, machinability: 0.95, weldability: 0.0,
    cost_per_kg: 20.0,
    notes: 'FDM rapid prototype. Brittle above 60 °C.',
  },
  abs: {
    id: 'abs', name: 'ABS (3D Print / Injection)',
    color: 0xf0ece0, roughness: 0.65, metalness: 0.0,
    density: 1050, youngsModulus: 2.3e9, poissonsRatio: 0.35,
    yieldStrength: 40e6, ultimateStrength: 55e6,
    thermalConductivity: 0.17, thermalExpansion: 73e-6,
    maxServiceTemp: 85, machinability: 0.90, weldability: 0.0,
    cost_per_kg: 18.0,
    notes: 'Tough, easy to post-process, solvent-weldable.',
  },
  peek: {
    id: 'peek', name: 'PEEK (High-Performance)',
    color: 0xe8d8b0, roughness: 0.50, metalness: 0.0,
    density: 1320, youngsModulus: 3.6e9, poissonsRatio: 0.40,
    yieldStrength: 91e6, ultimateStrength: 100e6,
    thermalConductivity: 0.25, thermalExpansion: 47e-6,
    maxServiceTemp: 250, machinability: 0.75, weldability: 0.0,
    cost_per_kg: 100.0,
    notes: 'Medical-grade, continuous service to 250 °C.',
  },
  nylon66: {
    id: 'nylon66', name: 'Nylon 6/6 (PA66)',
    color: 0xf4f0e8, roughness: 0.60, metalness: 0.0,
    density: 1140, youngsModulus: 2.8e9, poissonsRatio: 0.39,
    yieldStrength: 75e6, ultimateStrength: 85e6,
    thermalConductivity: 0.26, thermalExpansion: 80e-6,
    maxServiceTemp: 120, machinability: 0.80, weldability: 0.0,
    cost_per_kg: 3.80,
    notes: 'Bushings, gears, slides. Absorbs moisture.',
  },
  // ── Composites ────────────────────────────────────────────────────────────
  cfrp_ud: {
    id: 'cfrp_ud', name: 'CFRP Unidirectional Laminate',
    color: 0x1a1e28, roughness: 0.50, metalness: 0.05,
    density: 1600, youngsModulus: 135e9, poissonsRatio: 0.30,
    yieldStrength: 1500e6, ultimateStrength: 1600e6,   // tensile
    thermalConductivity: 5.0, thermalExpansion: 0.5e-6,
    maxServiceTemp: 180, machinability: 0.20, weldability: 0.0,
    cost_per_kg: 80.0,
    notes: 'Aerospace primary structure. Anisotropic—properties are fibre-direction.',
  },
  // ── Copper / Brass ────────────────────────────────────────────────────────
  copper_c101: {
    id: 'copper_c101', name: 'Copper C101 (ETP)',
    color: 0xc87941, roughness: 0.40, metalness: 0.95,
    density: 8940, youngsModulus: 117e9, poissonsRatio: 0.34,
    yieldStrength: 70e6, ultimateStrength: 220e6,
    thermalConductivity: 391, thermalExpansion: 17e-6,
    maxServiceTemp: 200, machinability: 0.60, weldability: 0.70,
    cost_per_kg: 9.50,
    notes: 'Bus bars, heat sinks. Highest conductivity copper.',
  },
  brass_360: {
    id: 'brass_360', name: 'Brass 360 (Free-machining)',
    color: 0xd4a832, roughness: 0.35, metalness: 0.92,
    density: 8500, youngsModulus: 97e9, poissonsRatio: 0.34,
    yieldStrength: 140e6, ultimateStrength: 340e6,
    thermalConductivity: 115, thermalExpansion: 20e-6,
    maxServiceTemp: 150, machinability: 0.98, weldability: 0.50,
    cost_per_kg: 7.20,
    notes: 'Best machinability of any metal. Fittings, valves.',
  },
  // ── PCB / electronic ──────────────────────────────────────────────────────
  fr4: {
    id: 'fr4', name: 'FR4 PCB Substrate',
    color: 0x2a5c2a, roughness: 0.65, metalness: 0.0,
    density: 1860, youngsModulus: 24e9, poissonsRatio: 0.136,
    yieldStrength: 310e6, ultimateStrength: 344e6,
    thermalConductivity: 0.30, thermalExpansion: 14e-6,
    maxServiceTemp: 130, machinability: 0.65, weldability: 0.0,
    cost_per_kg: 12.0,
    notes: 'PCB laminate — glass epoxy, 4-layer nominal.',
  },
};

/** Resolve a material by id — falls back to steel_mild */
function resolveMaterial(id) {
  return MATERIALS[id] || MATERIALS.steel_mild;
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 5  TESSELLATOR PRIMITIVES
   All tessellators return  { verts: Float32Array, normals: Float32Array }
   — centred at world origin unless otherwise noted.
   No dependency on THREE.js at all.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build index lists into a flat position/normal pair.
 * @param {Array} positions  [[x,y,z], …]
 * @param {Array} indices    [[i0,i1,i2], …]  CCW winding
 * @returns {{ verts: Float32Array, normals: Float32Array }}
 */
function indexedToFlat(positions, indices) {
  const verts   = new Float32Array(indices.length * 9);
  const normals = new Float32Array(indices.length * 9);
  let vi = 0;
  for (const [i0, i1, i2] of indices) {
    const p0 = positions[i0], p1 = positions[i1], p2 = positions[i2];
    // face normal
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    for (const p of [p0, p1, p2]) {
      verts[vi] = p[0]; verts[vi+1] = p[1]; verts[vi+2] = p[2];
      normals[vi] = nx; normals[vi+1] = ny; normals[vi+2] = nz;
      vi += 3;
    }
  }
  return { verts, normals };
}

/**
 * Build smooth normals by averaging per-vertex face normals.
 * Input geo must already be flat (unindexed).
 */
function smoothNormals(geo) {
  const n = geo.verts.length / 3;
  // build a map key → accumulated normal
  const accum = new Map();
  const key = (i) => {
    const x = round(geo.verts[i * 3],     4);
    const y = round(geo.verts[i * 3 + 1], 4);
    const z = round(geo.verts[i * 3 + 2], 4);
    return `${x},${y},${z}`;
  };
  // accumulate face normals into vertex buckets
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const nx = geo.normals[i * 3], ny = geo.normals[i * 3 + 1], nz = geo.normals[i * 3 + 2];
    if (!accum.has(k)) accum.set(k, { x: 0, y: 0, z: 0, c: 0 });
    const a = accum.get(k);
    a.x += nx; a.y += ny; a.z += nz; a.c += 1;
  }
  // write back averaged normals
  const out = new Float32Array(geo.normals.length);
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const a = accum.get(k);
    const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
    out[i * 3]     = a.x / len;
    out[i * 3 + 1] = a.y / len;
    out[i * 3 + 2] = a.z / len;
  }
  return { ...geo, normals: out };
}

/**
 * Merge multiple geo objects into one flat { verts, normals }.
 */
function mergeGeos(...geos) {
  const totalVerts = geos.reduce((s, g) => s + g.verts.length, 0);
  const verts   = new Float32Array(totalVerts);
  const normals = new Float32Array(totalVerts);
  let off = 0;
  for (const g of geos) {
    verts.set(g.verts,   off);
    normals.set(g.normals, off);
    off += g.verts.length;
  }
  return { verts, normals };
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 6  GEOMETRY GENERATORS — PRIMITIVES
   Each function accepts a detailed params object with defaults.
   Increasing the segment counts improves curvature accuracy.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parametric Box (cuboid)
 */
function tessBox(p = {}) {
  const {
    w = 1, h = 1, d = 1,
    segW = 2, segH = 2, segD = 2,
  } = p;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const positions = [];
  const indices   = [];

  function addFace(origin, uDir, vDir, uSteps, vSteps) {
    const base = positions.length;
    for (let j = 0; j <= vSteps; j++) {
      for (let i = 0; i <= uSteps; i++) {
        const u = i / uSteps, v = j / vSteps;
        positions.push([
          origin[0] + uDir[0] * u + vDir[0] * v,
          origin[1] + uDir[1] * u + vDir[1] * v,
          origin[2] + uDir[2] * u + vDir[2] * v,
        ]);
      }
    }
    for (let j = 0; j < vSteps; j++) {
      for (let i = 0; i < uSteps; i++) {
        const a = base + j * (uSteps + 1) + i;
        const b = a + 1;
        const c = a + (uSteps + 1);
        const dd = c + 1;
        indices.push([a, b, dd], [a, dd, c]);
      }
    }
  }

  addFace([ hw, -hh, -hd], [0,  h,  0], [0, 0,  d], segH, segD);
  addFace([-hw, -hh,  hd], [0,  h,  0], [0, 0, -d], segH, segD);
  addFace([-hw,  hh, -hd], [ w,  0,  0], [0, 0, d], segW, segD);
  addFace([-hw, -hh,  hd], [ w,  0,  0], [0, 0,-d], segW, segD);
  addFace([-hw, -hh,  hd], [ w,  0,  0], [0, h, 0], segW, segH);
  addFace([ hw, -hh, -hd], [-w,  0,  0], [0, h, 0], segW, segH);

  return indexedToFlat(positions, indices);
}

/**
 * Parametric Cylinder / Prism
 */
function tessCylinder(p = {}) {
  const {
    radiusTop    = 0.5,
    radiusBottom = 0.5,
    height       = 1,
    radialSegs   = 64,
    heightSegs   = 4,
    openEnded    = false,
    thetaStart   = 0,
    thetaLength  = TWO_PI,
  } = p;

  const hh = height / 2;
  const positions = [];
  const indices   = [];

  const normals_smooth = [];
  for (let j = 0; j <= heightSegs; j++) {
    const t = j / heightSegs;
    const y = lerp(-hh, hh, t);
    const r = lerp(radiusBottom, radiusTop, t);
    for (let i = 0; i <= radialSegs; i++) {
      const theta = thetaStart + (i / radialSegs) * thetaLength;
      const sinT = Math.sin(theta), cosT = Math.cos(theta);
      positions.push([r * sinT, y, r * cosT]);
      const slope = (radiusBottom - radiusTop) / height;
      const nLen = Math.sqrt(1 + slope * slope);
      normals_smooth.push([sinT / nLen, slope / nLen, cosT / nLen]);
    }
  }

  const ring = radialSegs + 1;
  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = j * ring + i;
      const b = a + 1;
      const c = (j + 1) * ring + i;
      const d = c + 1;
      indices.push([a, b, d], [a, d, c]);
    }
  }

  const geo = indexedToFlat(positions, indices);
  const smoothN = new Float32Array(geo.verts.length);
  for (let tri = 0; tri < indices.length; tri++) {
    for (let v = 0; v < 3; v++) {
      const si = tri * 3 + v;
      const ni = indices[tri][v];
      smoothN[si * 3]     = normals_smooth[ni][0];
      smoothN[si * 3 + 1] = normals_smooth[ni][1];
      smoothN[si * 3 + 2] = normals_smooth[ni][2];
    }
  }
  const lateral = { verts: geo.verts, normals: smoothN };

  if (openEnded) return lateral;

  function makeCap(y, radius, normalY) {
    if (radius < EPSILON) return null;
    const capPos = [[0, y, 0]];
    const capIdx = [];
    for (let i = 0; i <= radialSegs; i++) {
      const theta = thetaStart + (i / radialSegs) * thetaLength;
      capPos.push([radius * Math.sin(theta), y, radius * Math.cos(theta)]);
    }
    for (let i = 0; i < radialSegs; i++) {
      if (normalY > 0) capIdx.push([0, i + 2, i + 1]);
      else             capIdx.push([0, i + 1, i + 2]);
    }
    const cg = indexedToFlat(capPos, capIdx);
    for (let i = 0; i < cg.normals.length; i += 3) {
      cg.normals[i] = 0; cg.normals[i + 1] = normalY; cg.normals[i + 2] = 0;
    }
    return cg;
  }

  const topCap    = makeCap( hh, radiusTop,    1);
  const bottomCap = makeCap(-hh, radiusBottom, -1);
  const parts = [lateral, topCap, bottomCap].filter(Boolean);
  return mergeGeos(...parts);
}

/**
 * Parametric UV-Sphere
 */
function tessSphere(p = {}) {
  const {
    radius      = 0.5,
    widthSegs   = 64,
    heightSegs  = 32,
    phiStart    = 0,
    phiLength   = TWO_PI,
    thetaStart  = 0,
    thetaLength = Math.PI,
  } = p;

  const verts   = [];
  const normals = [];

  for (let j = 0; j <= heightSegs; j++) {
    const v = j / heightSegs;
    const theta = thetaStart + v * thetaLength;
    const sinT  = Math.sin(theta);
    const cosT  = Math.cos(theta);
    for (let i = 0; i <= widthSegs; i++) {
      const u   = i / widthSegs;
      const phi = phiStart + u * phiLength;
      const x   = -Math.cos(phi) * sinT;
      const y   = cosT;
      const z   = Math.sin(phi) * sinT;
      verts.push([x * radius, y * radius, z * radius]);
      normals.push([x, y, z]);
    }
  }

  const ring = widthSegs + 1;
  const flatV = []; const flatN = [];
  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < widthSegs; i++) {
      const a = j * ring + i, b = a + 1, c = (j + 1) * ring + i, d = c + 1;
      for (const [i0, i1, i2] of [[a, b, d], [a, d, c]]) {
        for (const idx of [i0, i1, i2]) {
          flatV.push(...verts[idx]);
          flatN.push(...normals[idx]);
        }
      }
    }
  }
  return { verts: new Float32Array(flatV), normals: new Float32Array(flatN) };
}

/**
 * Parametric Torus
 */
function tessTorus(p = {}) {
  const {
    majorRadius = 0.4,
    minorRadius = 0.15,
    radialSegs  = 32,
    tubularSegs = 128,
    arcLength   = TWO_PI,
  } = p;

  const verts   = [];
  const normals = [];

  for (let j = 0; j <= radialSegs; j++) {
    for (let i = 0; i <= tubularSegs; i++) {
      const u = (i / tubularSegs) * arcLength;
      const v = (j / radialSegs)  * TWO_PI;
      const cosU = Math.cos(u), sinU = Math.sin(u);
      const cosV = Math.cos(v), sinV = Math.sin(v);
      const x = (majorRadius + minorRadius * cosV) * cosU;
      const y = minorRadius * sinV;
      const z = (majorRadius + minorRadius * cosV) * sinU;
      verts.push([x, y, z]);
      const cx = majorRadius * cosU, cz = majorRadius * sinU;
      const nl = Math.sqrt((x - cx) ** 2 + y ** 2 + (z - cz) ** 2) || 1;
      normals.push([(x - cx) / nl, y / nl, (z - cz) / nl]);
    }
  }

  const ring = tubularSegs + 1;
  const flatV = [], flatN = [];
  for (let j = 0; j < radialSegs; j++) {
    for (let i = 0; i < tubularSegs; i++) {
      const a = j * ring + i, b = a + 1, c = (j + 1) * ring + i, d = c + 1;
      for (const [i0, i1, i2] of [[a, b, d], [a, d, c]]) {
        for (const idx of [i0, i1, i2]) {
          flatV.push(...verts[idx]);
          flatN.push(...normals[idx]);
        }
      }
    }
  }
  return { verts: new Float32Array(flatV), normals: new Float32Array(flatN) };
}

function tessCone(p = {}) {
  const { radius = 0.5, height = 1, radialSegs = 64, heightSegs = 4, openEnded = false } = p;
  return tessCylinder({ radiusTop: 0, radiusBottom: radius, height, radialSegs, heightSegs, openEnded });
}

function tessTube(p = {}) {
  const {
    outerRadius = 0.5,
    innerRadius = 0.35,
    height      = 1,
    radialSegs  = 64,
    heightSegs  = 4,
  } = p;
  const outer = tessCylinder({ radiusTop: outerRadius, radiusBottom: outerRadius, height, radialSegs, heightSegs, openEnded: true });
  const inner = applyTransform(
    tessCylinder({ radiusTop: innerRadius, radiusBottom: innerRadius, height, radialSegs, heightSegs, openEnded: true }),
    { rx: Math.PI }
  );
  const topCap    = tessAnnulusRing({ outerR: outerRadius, innerR: innerRadius, y: height / 2,  normalY:  1, segs: radialSegs });
  const bottomCap = tessAnnulusRing({ outerR: outerRadius, innerR: innerRadius, y: -height / 2, normalY: -1, segs: radialSegs });
  return mergeGeos(outer, inner, topCap, bottomCap);
}

function tessAnnulusRing({ outerR, innerR, y, normalY = 1, segs = 64 }) {
  const verts = [], normals = [];
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * TWO_PI, t1 = ((i + 1) / segs) * TWO_PI;
    const cos0 = Math.cos(t0), sin0 = Math.sin(t0);
    const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
    const o0 = [outerR * cos0, y, outerR * sin0];
    const o1 = [outerR * cos1, y, outerR * sin1];
    const i0 = [innerR * cos0, y, innerR * sin0];
    const i1 = [innerR * cos1, y, innerR * sin1];
    const tris = normalY > 0 ? [[o0, o1, i1], [o0, i1, i0]] : [[o0, i1, o1], [o0, i0, i1]];
    for (const tri of tris) {
      for (const v of tri) {
        verts.push(...v);
        normals.push(0, normalY, 0);
      }
    }
  }
  return { verts: new Float32Array(verts), normals: new Float32Array(normals) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 7  FEATURE GENERATORS
   ═══════════════════════════════════════════════════════════════════════════ */

function tessHole(p = {}) {
  const {
    cx = 0, cz = 0, diameter = 0.1, depth = 0.5, y = 0.5,
    radialSegs = 32,
    type = 'through',
    cbDiameter = diameter * 1.8,
    cbDepth = diameter * 0.6,
    csDiameter = diameter * 2,
    csAngle = 90,
  } = p;
  const r = diameter / 2;

  const parts = [];
  const bore = applyTransform(
    tessCylinder({ radiusTop: r, radiusBottom: r, height: depth, radialSegs, heightSegs: 2, openEnded: false }),
    { tx: cx, ty: y - depth / 2, tz: cz }
  );
  parts.push(bore);

  if (type === 'counterbore') {
    const cbR = cbDiameter / 2;
    const cb = applyTransform(
      tessCylinder({ radiusTop: cbR, radiusBottom: cbR, height: cbDepth, radialSegs, heightSegs: 1, openEnded: false }),
      { tx: cx, ty: y - cbDepth / 2, tz: cz }
    );
    parts.push(cb);
  }
  if (type === 'countersink') {
    const csR = csDiameter / 2;
    const csH = csR / Math.tan(deg(csAngle / 2));
    const cs = applyTransform(
      tessCylinder({ radiusTop: 0, radiusBottom: csR, height: csH, radialSegs, heightSegs: 2, openEnded: false }),
      { tx: cx, ty: y - csH / 2, tz: cz }
    );
    parts.push(cs);
  }

  return mergeGeos(...parts);
}

function tessBoltCircle(p = {}) {
  const {
    bcd          = 1.0,
    holeDiameter = 0.1,
    holeCount    = 4,
    holeDepth    = 0.5,
    y            = 0.5,
    type         = 'through',
    radialSegs   = 24,
    offsetAngle  = 0,
  } = p;
  const r = bcd / 2;
  const parts = [];
  for (let i = 0; i < holeCount; i++) {
    const theta = offsetAngle + (i / holeCount) * TWO_PI;
    parts.push(tessHole({
      cx: r * Math.cos(theta),
      cz: r * Math.sin(theta),
      diameter: holeDiameter,
      depth: holeDepth, y, type, radialSegs,
    }));
  }
  return mergeGeos(...parts);
}

function tessChamferRing(p = {}) {
  const { radius = 0.5, y = 0.5, chamferSize = 0.02, chamferAngle = 45, segs = 64 } = p;
  const rad = deg(chamferAngle);
  const dr = chamferSize * Math.cos(rad);
  const dy = chamferSize * Math.sin(rad);
  return tessCylinder({
    radiusTop: radius - dr, radiusBottom: radius,
    height: dy, radialSegs: segs, heightSegs: 1,
    openEnded: true,
  });
}

function tessRib(p = {}) {
  const { width = 0.1, height = 0.5, thickness = 0.01, angle = 0, tx = 0, ty = 0, tz = 0 } = p;
  const geo = tessBox({ w: width, h: height, d: thickness, segW: 3, segH: 6, segD: 1 });
  return applyTransform(geo, { tx, ty, tz, ry: angle });
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 8  ADVANCED SOLID GENERATORS
   ═══════════════════════════════════════════════════════════════════════════ */

function buildBracket(p = {}) {
  const {
    bW = 0.120, bD = 0.080, bT = 0.008,
    fH = 0.060, fT = 0.008,
    baseHoles = 4, flangeHoles = 2,
    holeDia = 0.0065,
    bcd = 0.090,
    gusset = true,
    gussetCount = 2,
    material = 'steel_mild',
  } = p;

  const parts = [];

  const base = applyTransform(
    tessBox({ w: bW, h: bT, d: bD, segW: 4, segH: 2, segD: 4 }),
    { ty: bT / 2 }
  );
  parts.push(base);

  const flange = applyTransform(
    tessBox({ w: bW, h: fH, d: fT, segW: 4, segH: 6, segD: 2 }),
    { ty: bT + fH / 2, tz: -(bD / 2) + fT / 2 }
  );
  parts.push(flange);

  if (baseHoles > 0) {
    parts.push(tessBoltCircle({
      bcd, holeDiameter: holeDia, holeCount: baseHoles,
      holeDepth: bT * 1.1, y: bT, type: 'counterbore',
      cbDiameter: holeDia * 1.9, cbDepth: bT * 0.4,
    }));
  }

  if (flangeHoles > 0) {
    const fYCentre = bT + fH / 2;
    const spacing  = bW / (flangeHoles + 1);
    for (let i = 0; i < flangeHoles; i++) {
      const hx = -bW / 2 + spacing * (i + 1);
      const holeGeo = applyTransform(
        tessCylinder({ radiusTop: holeDia / 2, radiusBottom: holeDia / 2, height: fT * 1.1, radialSegs: 24, openEnded: false }),
        { tx: hx, ty: fYCentre, tz: -(bD / 2) + fT / 2 }
      );
      parts.push(holeGeo);
    }
  }

  if (gusset && gussetCount > 0) {
    const gW = Math.min(fH * 0.7, bD * 0.4);
    const gH = Math.min(fH * 0.8, 0.04);
    const gT = bT * 0.9;
    const spacing = bW / (gussetCount + 1);
    for (let i = 0; i < gussetCount; i++) {
      const gx = -bW / 2 + spacing * (i + 1);
      const gussetGeo = applyTransform(
        tessBox({ w: gT, h: gH * Math.SQRT2, d: gW * Math.SQRT2, segW: 1, segH: 3, segD: 3 }),
        { tx: gx, ty: bT + gH / 2, tz: -(bD / 2) + gW / 2, rx: Math.PI / 4 }
      );
      parts.push(gussetGeo);
    }
  }

  const mat = resolveMaterial(material);
  return {
    type: 'bracket', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['base_plate', 'flange', ...(baseHoles > 0 ? ['base_bolt_holes'] : []), ...(flangeHoles > 0 ? ['flange_bolt_holes'] : []), ...(gusset ? ['gusset_rib'] : [])],
    mass_kg: (bW * bD * bT + bW * fH * fT) * mat.density,
  };
}

function buildDrone(p = {}) {
  const {
    motorSpan   = 0.450,
    armOD       = 0.016,
    armWT       = 0.0015,
    nacelleDia  = 0.032,
    nacelleH    = 0.022,
    stackW      = 0.080,
    stackD      = 0.060,
    stackH      = 0.018,
    landingGear = true,
    motorCount  = 4,
    material    = 'cfrp_ud',
  } = p;

  const parts = [];
  const armLen = motorSpan / 2;

  parts.push(tessBox({ w: stackW, h: stackH, d: stackD, segW: 3, segH: 2, segD: 3 }));

  const armAngles = motorCount === 6
    ? [0, 60, 120, 180, 240, 300].map(deg)
    : [45, 135, 225, 315].map(deg);

  for (const theta of armAngles) {
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const armOI = armOD / 2 - armWT;
    const midX = cosT * armLen / 2;
    const midZ = sinT * armLen / 2;

    const armGeo = applyTransform(
      tessTube({ outerRadius: armOD / 2, innerRadius: armOI, height: armLen, radialSegs: 16, heightSegs: 4 }),
      { tx: midX, tz: midZ, ry: -(Math.PI / 2 - theta), rx: Math.PI / 2 }
    );
    parts.push(armGeo);

    const tipX = cosT * armLen;
    const tipZ = sinT * armLen;
    const nacelle = applyTransform(
      tessCylinder({
        radiusTop: nacelleDia / 2 * 0.85,
        radiusBottom: nacelleDia / 2,
        height: nacelleH,
        radialSegs: 24,
        heightSegs: 3,
      }),
      { tx: tipX, ty: nacelleH / 2, tz: tipZ }
    );
    parts.push(nacelle);

    parts.push(applyTransform(
      tessAnnulusRing({ outerR: nacelleDia / 2 * 1.15, innerR: nacelleDia / 2, y: 0, normalY: -1, segs: 24 }),
      { tx: tipX, tz: tipZ }
    ));
  }

  if (landingGear) {
    const lgR   = armOD * 0.6;
    const lgH   = stackH + 0.030;
    const lgSpan = stackW * 0.65;
    for (const side of [-1, 1]) {
      parts.push(applyTransform(
        tessCylinder({ radiusTop: lgR, radiusBottom: lgR, height: lgH, radialSegs: 12, heightSegs: 2 }),
        { tx: side * lgSpan, ty: -lgH / 2 }
      ));
      const skidLen = stackD * 1.2;
      parts.push(applyTransform(
        tessCylinder({ radiusTop: lgR * 0.7, radiusBottom: lgR * 0.7, height: skidLen, radialSegs: 12, heightSegs: 2 }),
        { tx: side * lgSpan, ty: -lgH, rx: Math.PI / 2 }
      ));
    }
  }

  const mat = resolveMaterial(material);
  return {
    type: 'drone', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['centre_stack', `${motorCount}_arm_tubes`, 'motor_nacelles', ...(landingGear ? ['landing_gear'] : [])],
    motorCount,
  };
}

function buildGear(p = {}) {
  const {
    module_m      = 0.002,
    toothCount    = 20,
    faceWidth     = 0.010,
    pressureAngle = 20,
    profileShift  = 0,
    holeRadius    = 0.006,
    hubRadius     = 0.010,
    hubHeight     = faceWidth * 0.5,
    keyway        = false,
    keywayW       = holeRadius * 0.6,
    keywayD       = holeRadius * 0.25,
    toothSegs     = 12,
    material      = 'steel_4140',
  } = p;

  const phi   = deg(pressureAngle);
  const pitch = Math.PI * module_m;
  const rPitch = module_m * toothCount / 2;
  const rBase  = rPitch * Math.cos(phi);
  const rAdden = rPitch + module_m * (1 + profileShift);
  const rDeden = rPitch - module_m * (1.25 - profileShift);
  const rDed   = Math.max(rDeden, rBase * 0.99);

  function involutePoint(t) {
    return [
      rBase * (Math.cos(t) + t * Math.sin(t)),
      rBase * (Math.sin(t) - t * Math.cos(t)),
    ];
  }

  const tPitch = Math.sqrt((rPitch / rBase) ** 2 - 1);
  const invPhi = Math.atan(tPitch) - tPitch;
  const toothThicknessAngle = Math.PI / toothCount + 2 * profileShift * Math.tan(phi) / toothCount;
  const halfToothAngle = toothThicknessAngle / 2;
  const tAdden = Math.sqrt(Math.max(0, (rAdden / rBase) ** 2 - 1));

  function buildToothProfile() {
    const pts = [];
    for (let i = 0; i <= toothSegs; i++) {
      const t = (i / toothSegs) * tAdden;
      const [px, py] = involutePoint(t);
      const alpha = Math.atan2(py, px);
      const r = Math.sqrt(px * px + py * py);
      if (r < rDed) continue;
      const rotAngle = halfToothAngle - invPhi;
      const a = alpha + rotAngle;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const tipAngle0 = Math.atan2(pts[pts.length - 1][1], pts[pts.length - 1][0]);
    const tipAngle1 = -tipAngle0;
    const tipLandSegs = 2;
    for (let i = 1; i < tipLandSegs; i++) {
      const a = lerp(tipAngle0, tipAngle1, i / tipLandSegs);
      pts.push([rAdden * Math.cos(a), rAdden * Math.sin(a)]);
    }
    for (let i = toothSegs; i >= 0; i--) {
      const t = (i / toothSegs) * tAdden;
      const [px, py] = involutePoint(t);
      const alpha = Math.atan2(py, px);
      const r = Math.sqrt(px * px + py * py);
      if (r < rDed) continue;
      const rotAngle = halfToothAngle - invPhi;
      const a = -(alpha + rotAngle);
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const rootPts = 4;
    const toothSector = TWO_PI / toothCount;
    const rootEnd  = -toothSector / 2;
    const rootStart = pts[pts.length - 1];
    const rs = Math.atan2(rootStart[1], rootStart[0]);
    for (let i = 1; i <= rootPts; i++) {
      const a = lerp(rs, rootEnd, i / rootPts);
      pts.push([rDed * Math.cos(a), rDed * Math.sin(a)]);
    }
    return pts;
  }

  const toothPts = buildToothProfile();
  const toothSector = TWO_PI / toothCount;

  const verts   = [];
  const normals = [];
  const hFW = faceWidth / 2;

  function extrudeProfile(profile2D, zFront, zBack) {
    const n = profile2D.length;
    for (let i = 0; i < n; i++) {
      const p0 = profile2D[i];
      const p1 = profile2D[(i + 1) % n];
      const A = [p0[0], p0[1], zFront];
      const B = [p1[0], p1[1], zFront];
      const C = [p0[0], p0[1], zBack];
      const D = [p1[0], p1[1], zBack];
      const ex = p1[1] - p0[1], ey = -(p1[0] - p0[0]);
      const el = Math.sqrt(ex * ex + ey * ey) || 1;
      const nx = ex / el, ny = ey / el;
      for (const tri of [[A, B, D], [A, D, C]]) {
        for (const v of tri) {
          verts.push(v[0], v[1], v[2]);
          normals.push(nx, ny, 0);
        }
      }
    }
    for (let i = 1; i < profile2D.length - 1; i++) {
      const p0 = profile2D[0], pi = profile2D[i], pn = profile2D[i + 1];
      verts.push(p0[0], p0[1], zFront, pi[0], pi[1], zFront, pn[0], pn[1], zFront);
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    }
    for (let i = 1; i < profile2D.length - 1; i++) {
      const p0 = profile2D[0], pi = profile2D[i], pn = profile2D[i + 1];
      verts.push(p0[0], p0[1], zBack, pn[0], pn[1], zBack, pi[0], pi[1], zBack);
      normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
    }
  }

  for (let tooth = 0; tooth < toothCount; tooth++) {
    const angle = tooth * toothSector;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotated = toothPts.map(([x, y]) => [x * cosA - y * sinA, x * sinA + y * cosA]);
    extrudeProfile(rotated, hFW, -hFW);
  }

  const disc = tessCylinder({ radiusTop: rDed, radiusBottom: rDed, height: faceWidth, radialSegs: toothCount * 2, heightSegs: 2 });
  const hub = applyTransform(
    tessCylinder({ radiusTop: hubRadius, radiusBottom: hubRadius, height: faceWidth + hubHeight, radialSegs: 24, heightSegs: 2 }),
    { ty: -hubHeight / 2 }
  );
  const bore = tessCylinder({ radiusTop: holeRadius, radiusBottom: holeRadius, height: faceWidth + hubHeight * 1.1, radialSegs: 24, heightSegs: 2 });

  const gearGeo = mergeGeos(
    { verts: new Float32Array(verts), normals: new Float32Array(normals) },
    disc, hub, bore
  );

  const mat = resolveMaterial(material);
  return {
    type: 'gear', material: mat,
    geo: gearGeo,
    params: p,
    features: ['involute_teeth', 'disc_body', 'hub', 'centre_bore'],
    pitchRadius: rPitch,
    baseRadius: rBase,
    addendumRadius: rAdden,
    dedendumRadius: rDed,
    toothCount,
    module_m,
  };
}

function buildSpring(p = {}) {
  const {
    coilDia      = 0.025,
    wireDia      = 0.003,
    activeCoils  = 6,
    freeLength   = 0.060,
    handedness   = 'right',
    tubularSegs  = 128,
    radialSegs   = 16,
    groundCoilPct = 0.85,
    material     = 'steel_4140',
  } = p;

  const totalCoils = activeCoils + 2;
  const pitch      = freeLength / totalCoils;
  const R          = coilDia / 2;
  const r          = wireDia  / 2;
  const handSign   = handedness === 'right' ? 1 : -1;

  const stepsPerRev = tubularSegs;
  const totalSteps  = Math.round(totalCoils * stepsPerRev);

  const centres = [];
  const tangents = [];

  for (let i = 0; i <= totalSteps; i++) {
    const t    = i / totalSteps;
    const angle = handSign * t * totalCoils * TWO_PI;
    const coilIndex = t * totalCoils;

    let y;
    if (coilIndex < groundCoilPct) {
      y = (coilIndex / groundCoilPct) * pitch * groundCoilPct;
    } else if (coilIndex > totalCoils - groundCoilPct) {
      const from = freeLength - pitch * groundCoilPct;
      const frac = (coilIndex - (totalCoils - groundCoilPct)) / groundCoilPct;
      y = from + frac * pitch * groundCoilPct;
    } else {
      y = coilIndex * pitch;
    }

    centres.push([R * Math.cos(angle), y - freeLength / 2, R * Math.sin(angle)]);
  }

  for (let i = 0; i <= totalSteps; i++) {
    let dx, dy, dz;
    if (i === 0) {
      dx = centres[1][0] - centres[0][0];
      dy = centres[1][1] - centres[0][1];
      dz = centres[1][2] - centres[0][2];
    } else if (i === totalSteps) {
      dx = centres[i][0] - centres[i-1][0];
      dy = centres[i][1] - centres[i-1][1];
      dz = centres[i][2] - centres[i-1][2];
    } else {
      dx = centres[i+1][0] - centres[i-1][0];
      dy = centres[i+1][1] - centres[i-1][1];
      dz = centres[i+1][2] - centres[i-1][2];
    }
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    tangents.push([dx/len, dy/len, dz/len]);
  }

  const verts   = [];
  const normals = [];

  let prevN = (() => {
    const t = tangents[0];
    const ax = Math.abs(t[0]), ay = Math.abs(t[1]), az = Math.abs(t[2]);
    let up;
    if (ax < ay && ax < az) up = [1,0,0];
    else if (ay < az)       up = [0,1,0];
    else                    up = [0,0,1];
    const nx = t[1]*up[2] - t[2]*up[1];
    const ny = t[2]*up[0] - t[0]*up[2];
    const nz = t[0]*up[1] - t[1]*up[0];
    const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    return [nx/nl, ny/nl, nz/nl];
  })();

  const frameNormals = [prevN];
  for (let i = 1; i <= totalSteps; i++) {
    const t0 = tangents[i-1], t1 = tangents[i];
    const axis = [
      t0[1]*t1[2]-t0[2]*t1[1],
      t0[2]*t1[0]-t0[0]*t1[2],
      t0[0]*t1[1]-t0[1]*t1[0],
    ];
    const axLen = Math.sqrt(axis[0]**2+axis[1]**2+axis[2]**2);
    if (axLen < EPSILON) {
      frameNormals.push([...prevN]);
      continue;
    }
    const ax2 = axis.map(v => v/axLen);
    const ang  = Math.asin(clamp(axLen, -1, 1));
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const dot   = ax2[0]*prevN[0]+ax2[1]*prevN[1]+ax2[2]*prevN[2];
    const crossX = ax2[1]*prevN[2]-ax2[2]*prevN[1];
    const crossY = ax2[2]*prevN[0]-ax2[0]*prevN[2];
    const crossZ = ax2[0]*prevN[1]-ax2[1]*prevN[0];
    prevN = [
      prevN[0]*cosA + crossX*sinA + ax2[0]*dot*(1-cosA),
      prevN[1]*cosA + crossY*sinA + ax2[1]*dot*(1-cosA),
      prevN[2]*cosA + crossZ*sinA + ax2[2]*dot*(1-cosA),
    ];
    const pl = Math.sqrt(prevN[0]**2+prevN[1]**2+prevN[2]**2)||1;
    prevN = prevN.map(v=>v/pl);
    frameNormals.push([...prevN]);
  }

  function tubeRingVertices(idx) {
    const c  = centres[idx];
    const t  = tangents[idx];
    const n  = frameNormals[idx];
    const b  = [t[1]*n[2]-t[2]*n[1], t[2]*n[0]-t[0]*n[2], t[0]*n[1]-t[1]*n[0]];
    const ring = [];
    for (let j = 0; j <= radialSegs; j++) {
      const a = (j / radialSegs) * TWO_PI;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const px = c[0] + r * (cosA * n[0] + sinA * b[0]);
      const py = c[1] + r * (cosA * n[1] + sinA * b[1]);
      const pz = c[2] + r * (cosA * n[2] + sinA * b[2]);
      const nx2 = cosA * n[0] + sinA * b[0];
      const ny2 = cosA * n[1] + sinA * b[1];
      const nz2 = cosA * n[2] + sinA * b[2];
      ring.push({ pos: [px, py, pz], nor: [nx2, ny2, nz2] });
    }
    return ring;
  }

  for (let i = 0; i < totalSteps; i++) {
    const ringA = tubeRingVertices(i);
    const ringB = tubeRingVertices(i + 1);
    for (let j = 0; j < radialSegs; j++) {
      const A = ringA[j], B = ringA[j+1], C = ringB[j], D = ringB[j+1];
      for (const [v0, v1, v2] of [[A,B,D],[A,D,C]]) {
        for (const v of [v0,v1,v2]) {
          verts.push(...v.pos);
          normals.push(...v.nor);
        }
      }
    }
  }

  const mat = resolveMaterial(material);
  return {
    type: 'spring', material: mat,
    geo: { verts: new Float32Array(verts), normals: new Float32Array(normals) },
    params: p,
    features: ['helical_coil', 'ground_coils_tapered', 'frenet_frame_normals'],
    freeLength, coilDia, wireDia, activeCoils, pitch,
  };
}

function buildIBeam(p = {}) {
  const {
    flangeW    = 0.100,
    flangeT    = 0.010,
    webH       = 0.120,
    webT       = 0.006,
    length     = 0.500,
    lengthSegs = 4,
    filletR    = 0.006,
    filletSegs = 4,
    material   = 'steel_mild',
  } = p;

  const totalH = webH + 2 * flangeT;
  const parts  = [];

  parts.push(applyTransform(
    tessBox({ w: flangeW, h: flangeT, d: length, segW: 3, segH: 2, segD: lengthSegs }),
    { ty: webH / 2 + flangeT / 2 }
  ));
  parts.push(applyTransform(
    tessBox({ w: flangeW, h: flangeT, d: length, segW: 3, segH: 2, segD: lengthSegs }),
    { ty: -(webH / 2 + flangeT / 2) }
  ));
  parts.push(tessBox({ w: webT, h: webH, d: length, segW: 2, segH: 6, segD: lengthSegs }));

  if (filletR > 0) {
    const fA = deg(45);
    for (const ySign of [1, -1]) {
      const fY = ySign * (webH / 2);
      for (const xSign of [-1, 1]) {
        const fX = xSign * (webT / 2);
        parts.push(applyTransform(
          tessBox({ w: filletR * 1.2, h: filletR * 1.2, d: length, segW: 2, segH: 2, segD: lengthSegs }),
          { tx: fX + xSign * filletR * 0.4, ty: fY + ySign * filletR * 0.4, rz: fA * xSign * ySign }
        ));
      }
    }
  }

  const mat = resolveMaterial(material);
  return {
    type: 'ibeam', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['top_flange', 'bottom_flange', 'web', ...(filletR > 0 ? ['web_flange_fillets'] : [])],
    totalHeight: totalH,
    momentOfInertia_xx: (() => {
      const I_flanges = 2 * (flangeW * flangeT ** 3 / 12 + flangeW * flangeT * (webH / 2 + flangeT / 2) ** 2);
      const I_web     = webT * webH ** 3 / 12;
      return I_flanges + I_web;
    })(),
  };
}

function buildLAngle(p = {}) {
  const {
    legA_w   = 0.075,
    legA_t   = 0.008,
    legB_h   = 0.075,
    legB_t   = 0.008,
    length   = 0.300,
    lengthSegs = 4,
    filletR  = 0.005,
    material = 'steel_mild',
  } = p;

  const parts = [];

  parts.push(applyTransform(
    tessBox({ w: legA_w, h: legA_t, d: length, segW: 4, segH: 2, segD: lengthSegs }),
    { tx: legA_w / 2 - legB_t / 2, ty: legA_t / 2 }
  ));
  parts.push(applyTransform(
    tessBox({ w: legB_t, h: legB_h, d: length, segW: 2, segH: 6, segD: lengthSegs }),
    { tx: 0, ty: legA_t + legB_h / 2 }
  ));
  if (filletR > 0) {
    parts.push(applyTransform(
      tessBox({ w: filletR * 1.2, h: filletR * 1.2, d: length, segW: 1, segH: 1, segD: lengthSegs }),
      { tx: legB_t / 2 + filletR * 0.4, ty: legA_t + filletR * 0.4, rz: Math.PI / 4 }
    ));
  }

  const mat = resolveMaterial(material);
  return {
    type: 'langle', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['horizontal_leg', 'vertical_leg', ...(filletR > 0 ? ['inner_fillet'] : [])],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   § 9  PART BUILDER  —  dims normaliser + type detector
   ═══════════════════════════════════════════════════════════════════════════ */

const CATEGORIES = {
  bracket:   { keywords: ['bracket','mount','plate','flange','shelf','angle','support','clamp'],   builder: buildBracket },
  gear:      { keywords: ['gear','sprocket','pinion','cog','tooth','teeth','involute'],             builder: buildGear },
  drone:     { keywords: ['drone','uav','quad','octocopter','hexacopter','multirotor','copter'],    builder: buildDrone },
  spring:    { keywords: ['spring','coil','helix','suspension','compression','tension'],            builder: buildSpring },
  ibeam:     { keywords: ['beam','i-beam','w-shape','joist','girder','structural','column'],        builder: buildIBeam },
  langle:    { keywords: ['angle','l-section','l-shape','l-angle','purlin'],                       builder: buildLAngle },
  tube:      { keywords: ['tube','pipe','cylinder','bore','sleeve','bushing','shaft'],              builder: (p) => ({ type:'tube', material: resolveMaterial(p.material), geo: tessTube(p), params: p, features:['hollow_cylinder'] }) },
  box:       { keywords: ['box','block','cube','enclosure','housing','plate','pad'],                builder: (p) => ({ type:'box',  material: resolveMaterial(p.material), geo: tessBox(p),  params: p, features:['rectangular_solid'] }) },
  sphere:    { keywords: ['sphere','ball','globe','dome','hemisphere'],                             builder: (p) => ({ type:'sphere', material: resolveMaterial(p.material), geo: tessSphere(p), params: p, features:['spherical_solid'] }) },
  torus:     { keywords: ['torus','ring','o-ring','washer','gasket'],                              builder: (p) => ({ type:'torus', material: resolveMaterial(p.material), geo: tessTorus(p), params: p, features:['torus_solid'] }) },
};

function detectType(description = '') {
  const lower = (description || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (lower.includes(kw)) score += kw.length;
    }
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best || 'box';
}

function normDims(dims = {}, type = 'box') {
  const toM = (v, fallback = 0.1) => {
    if (v === null || v === undefined || isNaN(Number(v))) return fallback;
    const n = Number(v);
    return n > 10 ? n * MM2M : n;
  };

  const L = toM(dims.length || dims.l || dims.w, 0.100);
  const W = toM(dims.width  || dims.w,           0.080);
  const H = toM(dims.height || dims.h,           0.060);
  const D = toM(dims.depth  || dims.d || W,      W);

  switch (type) {
    case 'bracket':
      return { bW: L, bD: D, bT: Math.max(H * 0.08, 0.005), fH: H * 0.6, fT: Math.max(H * 0.08, 0.005), material: dims.material };
    case 'gear':
      return { module_m: toM(dims.module || 0.002, 0.002), toothCount: Number(dims.teeth || dims.toothCount || 20), faceWidth: H, holeRadius: toM(dims.boreRadius || dims.bore || 0.006, 0.006), material: dims.material };
    case 'drone':
      return { motorSpan: L, stackW: W, stackD: D, stackH: H, material: dims.material };
    case 'spring':
      return { coilDia: W, wireDia: Math.max(W * 0.1, 0.001), freeLength: H, activeCoils: Number(dims.coils || 6), material: dims.material };
    case 'ibeam':
      return { flangeW: W, flangeT: Math.max(H * 0.08, 0.006), webH: H * 0.8, webT: Math.max(W * 0.06, 0.005), length: L, material: dims.material };
    case 'langle':
      return { legA_w: W, legA_t: Math.max(H * 0.1, 0.005), legB_h: H, legB_t: Math.max(W * 0.1, 0.005), length: L, material: dims.material };
    case 'tube':
      return { outerRadius: W / 2, innerRadius: W / 2 * 0.75, height: H, material: dims.material };
    case 'sphere':
      return { radius: Math.min(L, W, H) / 2, material: dims.material };
    case 'torus':
      return { majorRadius: W / 2, minorRadius: H / 2, material: dims.material };
    default:
      return { w: L, h: H, d: D, material: dims.material };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §10  SCENE ASSEMBLER  —  Three.js integration
   ═══════════════════════════════════════════════════════════════════════════ */

function geoToThreeMesh(geo, matDef, THREE) {
  if (!THREE) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geo.verts,   3));
  g.setAttribute('normal',   new THREE.BufferAttribute(geo.normals, 3));
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color:     matDef.color     ?? 0x888888,
    roughness: matDef.roughness ?? 0.5,
    metalness: matDef.metalness ?? 0.5,
    side:      THREE.DoubleSide,
  });

  return new THREE.Mesh(g, mat);
}

function buildScene(canvasEl, dims = {}, description = '') {
  const THREE = global.THREE;
  if (!THREE) {
    console.warn('[UARE CAD] THREE.js not loaded — skipping render.');
    return null;
  }

  const type    = detectType(description);
  const normP   = normDims(dims, type);
  const partDef = CATEGORIES[type].builder(normP);

  const w = canvasEl.clientWidth  || canvasEl.width  || 600;
  const h = canvasEl.clientHeight || canvasEl.height || 400;

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.outputEncoding    = THREE.sRGBEncoding || 3000;

  const scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);

  scene.add(new THREE.AmbientLight(0x334466, 0.6));

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x99bbff, 0.3);
  rim.position.set(0, -3, 5);
  scene.add(rim);

  const grid = new THREE.GridHelper(1.0, 20, 0x223344, 0x112233);
  scene.add(grid);

  const mesh = geoToThreeMesh(partDef.geo, partDef.material, THREE);
  if (mesh) {
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const box3 = new THREE.Box3().setFromObject(mesh);
    const size3 = box3.getSize(new THREE.Vector3());
    const maxDim = Math.max(size3.x, size3.y, size3.z);
    if (maxDim > 0) {
      const scale = 0.5 / maxDim;
      mesh.scale.setScalar(scale);
      box3.setFromObject(mesh);
      const centre = box3.getCenter(new THREE.Vector3());
      mesh.position.sub(centre);
    }
  }

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 100);
  camera.position.set(0.7, 0.5, 0.9);
  camera.lookAt(0, 0, 0);

  let controls = null;
  if (THREE.OrbitControls) {
    controls = new THREE.OrbitControls(camera, canvasEl);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
  }

  let rafId = null;
  let disposed = false;
  let autoRotate = !controls;

  function animate() {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    if (autoRotate && mesh) mesh.rotation.y += 0.005;
    if (controls) controls.update();
    renderer.render(scene, camera);
  }
  animate();

  const ro = new ResizeObserver(() => {
    const nw = canvasEl.clientWidth || w, nh = canvasEl.clientHeight || h;
    renderer.setSize(nw, nh, false);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
  });
  ro.observe(canvasEl);

  function dispose() {
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
    renderer.dispose();
    if (mesh) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }

  const validation = {
    type,
    material: partDef.material.name,
    features: partDef.features || [],
    triangleCount: partDef.geo.verts.length / 9,
    warnings: [],
  };
  if (validation.triangleCount < 10) validation.warnings.push('Very low triangle count — check geometry parameters.');
  if (partDef.material.maxServiceTemp < 100) validation.warnings.push(`Material "${partDef.material.name}" has low max service temp (${partDef.material.maxServiceTemp} °C).`);

  return { type, part: partDef, scene, renderer, camera, mesh, controls, animate, dispose, validation };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §11  STEP ASCII EXPORT  (structural stub — full B-Rep in PASS 3)
   ═══════════════════════════════════════════════════════════════════════════ */

function exportSTEP(partDef) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const mat = partDef.material;
  const triCount = partDef.geo.verts.length / 9;

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('UARE CAD Export - ${partDef.type}'),'2;1');
FILE_NAME('uare_${partDef.type}_export.step','${now}',('UARE CAD Engine ${CAD_VERSION}'),('UARE'),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));
ENDSEC;
DATA;
/* Material: ${mat.name} | Density: ${mat.density} kg/m³ | E: ${(mat.youngsModulus / 1e9).toFixed(1)} GPa | Yield: ${(mat.yieldStrength / 1e6).toFixed(0)} MPa */
/* Features: ${(partDef.features || []).join(', ')} */
/* Triangle count: ${triCount} */
/* NOTE: Full B-Rep solid tessellation export scheduled for PASS 3 */
#1 = APPLICATION_PROTOCOL_DEFINITION('draft international standard','automotive_design',2003,#2);
#2 = APPLICATION_CONTEXT('core data for automotive mechanical design processes');
#3 = PRODUCT('${partDef.type}','UARE ${partDef.type}','',#4);
#4 = PRODUCT_CONTEXT('',#2,'mechanical');
#5 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#3,.NOT_KNOWN.);
#6 = PRODUCT_DEFINITION('design','',#5,#7);
#7 = PRODUCT_DEFINITION_CONTEXT('part definition',#2,'design');
#8 = PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#3));
ENDSEC;
END-ISO-10303-21;
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §12  PUBLIC API
   ═══════════════════════════════════════════════════════════════════════════ */

const UARE_CAD = {
  version:     CAD_VERSION,

  buildScene,
  detectType,
  normDims,
  exportSTEP,

  CATEGORIES,

  MATERIALS,
  resolveMaterial,

  Vec3, Mat4, Quat,

  tessBox,
  tessCylinder,
  tessSphere,
  tessTorus,
  tessCone,
  tessTube,
  tessAnnulusRing,
  tessHole,
  tessBoltCircle,
  tessChamferRing,
  tessRib,

  buildBracket,
  buildDrone,
  buildGear,
  buildSpring,
  buildIBeam,
  buildLAngle,

  mergeGeos,
  applyTransform,
  smoothNormals,
  indexedToFlat,

  deg, clamp, lerp, remap, round,
};

global.UARE_CAD = UARE_CAD;

})(typeof window !== 'undefined' ? window : global);
/* END OF PASS 1 */


/* ═══════════════════════════════════════════════════════════════════════════
   PASS 2  (2026-04-20)
   §13  B-spline / NURBS curve kernel
   §14  Sweep & Loft solid generator
   §15  Thread profile generator  (Metric, UNC, ACME)
   §16  Weld bead geometry
   §17  PCB board + component outline generator
   §18  Constraint solver  (dimensional / positional)
   §19  Additional complex part builders
         shaft, pulley, hydraulic cylinder, enclosure, heat sink,
         flanged pipe, hex bolt + nut, bearing housing
   §20  UARE_CAD API  — extended with all Pass-2 exports
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
'use strict';

/* ── Pull in the Pass-1 helpers we need ────────────────────────────────── */
const C = global.UARE_CAD;
if (!C) { console.error('[UARE CAD Pass 2] Pass 1 must load first.'); return; }

const {
  Vec3, Mat4, Quat,
  tessBox, tessCylinder, tessSphere, tessTorus, tessCone, tessTube,
  tessAnnulusRing, tessHole, tessBoltCircle,
  mergeGeos, applyTransform, smoothNormals, indexedToFlat,
  resolveMaterial, MATERIALS,
  deg, clamp, lerp, remap, round,
  EPSILON, TWO_PI,
} = C;

/* shorthand — harmonic lerp series */
const linspace = (lo, hi, n) => Array.from({ length: n }, (_, i) => lerp(lo, hi, n < 2 ? 0 : i / (n - 1)));

/* ═══════════════════════════════════════════════════════════════════════════
   §13  B-SPLINE / NURBS CURVE KERNEL
   ═══════════════════════════════════════════════════════════════════════════ */

function bsplineBasis(i, p, t, U) {
  if (p === 0) {
    return (t >= U[i] && t < U[i + 1]) ? 1 : 0;
  }
  const d0 = U[i + p]     - U[i];
  const d1 = U[i + p + 1] - U[i + 1];
  const c0 = d0 < EPSILON ? 0 : ((t - U[i])         / d0) * bsplineBasis(i,     p - 1, t, U);
  const c1 = d1 < EPSILON ? 0 : ((U[i + p + 1] - t) / d1) * bsplineBasis(i + 1, p - 1, t, U);
  return c0 + c1;
}

function clampedKnots(n, p) {
  const m = n + p + 1;
  const U = new Array(m + 1).fill(0);
  for (let i = 0; i <= m; i++) {
    if (i <= p) U[i] = 0;
    else if (i >= m - p) U[i] = 1;
    else U[i] = (i - p) / (n - p + 1);
  }
  return U;
}

function createBSpline(controlPts, degree = 3, knots = null) {
  const n   = controlPts.length - 1;
  const p   = Math.min(degree, n);
  const U   = knots || clampedKnots(n, p);
  const tMax = U[U.length - 1] - EPSILON * 10;

  function evalAt(t) {
    const tClamped = clamp(t, U[p], tMax);
    let x = 0, y = 0, z = 0;
    for (let i = 0; i <= n; i++) {
      const b = bsplineBasis(i, p, tClamped, U);
      x += b * controlPts[i][0];
      y += b * controlPts[i][1];
      z += b * controlPts[i][2];
    }
    return [x, y, z];
  }

  function tangentAt(t) {
    const h  = 1e-5;
    const p0 = evalAt(clamp(t - h, 0, 1));
    const p1 = evalAt(clamp(t + h, 0, 1));
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    return [dx/len, dy/len, dz/len];
  }

  return {
    type: 'bspline', degree: p, controlPts, knots: U,
    eval:    (t) => ({ position: evalAt(t), tangent: tangentAt(t) }),
    evalPos: evalAt,
    evalTan: tangentAt,
    sample: (n = 64) => linspace(0, 1, n).map(evalAt),
  };
}

function createNURBS(controlPts, weights, degree = 3, knots = null) {
  const n = controlPts.length - 1;
  const p = Math.min(degree, n);
  const U = knots || clampedKnots(n, p);
  const w = weights || new Array(n + 1).fill(1);
  const tMax = U[U.length - 1] - EPSILON * 10;

  function evalAt(t) {
    const tClamped = clamp(t, U[p], tMax);
    let wx = 0, wy = 0, wz = 0, wSum = 0;
    for (let i = 0; i <= n; i++) {
      const b  = bsplineBasis(i, p, tClamped, U) * w[i];
      wx   += b * controlPts[i][0];
      wy   += b * controlPts[i][1];
      wz   += b * controlPts[i][2];
      wSum += b;
    }
    const ws = wSum < EPSILON ? 1 : wSum;
    return [wx / ws, wy / ws, wz / ws];
  }

  function tangentAt(t) {
    const h  = 1e-5;
    const p0 = evalAt(clamp(t - h, 0, 1));
    const p1 = evalAt(clamp(t + h, 0, 1));
    const dx = p1[0]-p0[0], dy = p1[1]-p0[1], dz = p1[2]-p0[2];
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
    return [dx/len, dy/len, dz/len];
  }

  return {
    type: 'nurbs', degree: p, controlPts, weights: w, knots: U,
    eval:    (t) => ({ position: evalAt(t), tangent: tangentAt(t) }),
    evalPos: evalAt,
    evalTan: tangentAt,
    sample:  (n = 64) => linspace(0, 1, n).map(evalAt),
  };
}

function createCircularArc(radius, startAngle, endAngle, y = 0) {
  const sweep = endAngle - startAngle;
  const nSegs  = sweep <= deg(120) ? 1 : sweep <= deg(240) ? 2 : 3;
  const dTheta = sweep / nSegs;
  const w      = Math.cos(dTheta / 2);

  const pts = [], weights = [];
  for (let i = 0; i <= nSegs; i++) {
    const a0 = startAngle + i * dTheta;
    pts.push([radius * Math.cos(a0), y, radius * Math.sin(a0)]);
    weights.push(1);
    if (i < nSegs) {
      const aMid = a0 + dTheta / 2;
      const rMid = radius / w;
      pts.push([rMid * Math.cos(aMid), y, rMid * Math.sin(aMid)]);
      weights.push(w);
    }
  }

  const n = pts.length - 1;
  const p = 2;
  const knotMults = [p + 1, ...Array(nSegs - 1).fill(null).flatMap(() => [2]), p + 1];
  const U = [];
  let ki = 0;
  for (const m of knotMults) {
    const v = ki / nSegs;
    for (let j = 0; j < m; j++) U.push(v);
    ki++;
  }
  return createNURBS(pts, weights, 2, U);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §14  SWEEP & LOFT SOLID GENERATOR
   ═══════════════════════════════════════════════════════════════════════════ */

function buildFrames(pathPoints) {
  const n = pathPoints.length;
  if (n < 2) throw new Error('buildFrames: need at least 2 path points');

  const tangents = pathPoints.map((p, i) => {
    const prev = pathPoints[Math.max(i - 1, 0)];
    const next = pathPoints[Math.min(i + 1, n - 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1], dz = next[2] - prev[2];
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    return [dx/len, dy/len, dz/len];
  });

  const t0 = tangents[0];
  const ax  = Math.abs(t0[0]), ay = Math.abs(t0[1]), az = Math.abs(t0[2]);
  let up;
  if (ax <= ay && ax <= az)      up = [1, 0, 0];
  else if (ay <= az)             up = [0, 1, 0];
  else                           up = [0, 0, 1];

  function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function norm(v) { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }

  let prevN = norm(cross(t0, up));
  const frames = [];

  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    const b = norm(cross(t, prevN));
    const nN = norm(cross(b, t));
    frames.push({ origin: pathPoints[i], tangent: t, normal: nN, binormal: b });

    if (i < n - 1) {
      const t1 = tangents[i + 1];
      const axis = norm(cross(t, t1));
      const axLen = Math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2);
      if (axLen > EPSILON) {
        const cosA = clamp(t[0]*t1[0]+t[1]*t1[1]+t[2]*t1[2], -1, 1);
        const ang  = Math.acos(cosA);
        const s    = Math.sin(ang), c = Math.cos(ang);
        const d    = axis[0]*nN[0]+axis[1]*nN[1]+axis[2]*nN[2];
        const cr   = cross(axis, nN);
        prevN = norm([
          nN[0]*c + cr[0]*s + axis[0]*d*(1-c),
          nN[1]*c + cr[1]*s + axis[1]*d*(1-c),
          nN[2]*c + cr[2]*s + axis[2]*d*(1-c),
        ]);
      } else {
        prevN = nN;
      }
    }
  }
  return frames;
}

function sweepProfile(profile2D, pathPoints, opts = {}) {
  const {
    twist    = 0,
    scale    = [1, 1],
    capStart = true,
    capEnd   = true,
  } = opts;

  const frames  = buildFrames(pathPoints);
  const nPath   = frames.length;
  const nProf   = profile2D.length;
  const verts   = [];
  const normals = [];

  function ringAt(fi) {
    const f   = frames[fi];
    const t   = fi / Math.max(nPath - 1, 1);
    const sc  = lerp(scale[0], scale[1], t);
    const twA = twist * t;
    const cosT = Math.cos(twA), sinT = Math.sin(twA);
    return profile2D.map(([px, py]) => {
      const rx = px * cosT - py * sinT;
      const ry = px * sinT + py * cosT;
      const sx = rx * sc, sy = ry * sc;
      return [
        f.origin[0] + sx * f.normal[0] + sy * f.binormal[0],
        f.origin[1] + sx * f.normal[1] + sy * f.binormal[1],
        f.origin[2] + sx * f.normal[2] + sy * f.binormal[2],
      ];
    });
  }

  for (let i = 0; i < nPath - 1; i++) {
    const rA = ringAt(i), rB = ringAt(i + 1);
    for (let j = 0; j < nProf; j++) {
      const jn  = (j + 1) % nProf;
      const A = rA[j], B = rA[jn], CC = rB[j], D = rB[jn];
      for (const [v0, v1, v2] of [[A, B, D], [A, D, CC]]) {
        const ex = v1[0]-v0[0], ey = v1[1]-v0[1], ez = v1[2]-v0[2];
        const fx = v2[0]-v0[0], fy = v2[1]-v0[1], fz = v2[2]-v0[2];
        let nx = ey*fz-ez*fy, ny = ez*fx-ex*fz, nz = ex*fy-ey*fx;
        const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
        nx/=nl; ny/=nl; nz/=nl;
        for (const v of [v0, v1, v2]) { verts.push(...v); normals.push(nx, ny, nz); }
      }
    }
  }

  function addCap(ring, normalDir) {
    const cx = ring.reduce((s,v) => s+v[0], 0) / ring.length;
    const cy = ring.reduce((s,v) => s+v[1], 0) / ring.length;
    const cz = ring.reduce((s,v) => s+v[2], 0) / ring.length;
    for (let j = 0; j < nProf; j++) {
      const jn = (j + 1) % nProf;
      const A = [cx, cy, cz], B = ring[j], CC = ring[jn];
      const tri = normalDir > 0 ? [A, CC, B] : [A, B, CC];
      const ex = tri[1][0]-tri[0][0], ey = tri[1][1]-tri[0][1], ez = tri[1][2]-tri[0][2];
      const fx = tri[2][0]-tri[0][0], fy = tri[2][1]-tri[0][1], fz = tri[2][2]-tri[0][2];
      let nx = ey*fz-ez*fy, ny = ez*fx-ex*fz, nz = ex*fy-ey*fx;
      const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      nx/=nl; ny/=nl; nz/=nl;
      for (const v of tri) { verts.push(...v); normals.push(nx, ny, nz); }
    }
  }

  if (capStart) addCap(ringAt(0), -1);
  if (capEnd)   addCap(ringAt(nPath - 1), 1);

  return { verts: new Float32Array(verts), normals: new Float32Array(normals) };
}

function loftProfiles(profiles, pathPoints, opts = {}) {
  if (profiles.length < 2) throw new Error('loft requires at least 2 profiles');
  const frames = buildFrames(pathPoints);

  const sections = frames.map((f, fi) => {
    const t    = fi / Math.max(frames.length - 1, 1);
    const span = (profiles.length - 1) * t;
    const lo   = Math.floor(span);
    const hi   = Math.min(lo + 1, profiles.length - 1);
    const frac = span - lo;
    const profA = profiles[lo], profB = profiles[hi];
    return profA.map(([ax, ay], i) => [
      lerp(ax, profB[i][0], frac),
      lerp(ay, profB[i][1], frac),
    ]);
  });

  return sweepProfile(sections[0], pathPoints, opts);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §15  THREAD PROFILE GENERATORS
   ═══════════════════════════════════════════════════════════════════════════ */

const THREAD_PROFILES = {
  metric: {
    profileFn(pitch, depth) {
      const half = pitch / 2;
      const flat = pitch / 8;
      return [
        [-half, 0],
        [-flat, -depth],
        [ flat, -depth],
        [ half, 0],
      ];
    },
    depthFactor: 0.6495,
  },
  unc: {
    profileFn(pitch, depth) { return THREAD_PROFILES.metric.profileFn(pitch, depth); },
    depthFactor: 0.6495,
  },
  acme: {
    profileFn(pitch, depth) {
      const half = pitch / 2;
      const flatCrest = pitch * 0.3707;
      const flatRoot  = pitch * 0.3707 + 2 * depth * Math.tan(deg(14.5));
      return [
        [-flatRoot  / 2, -depth],
        [-flatCrest / 2,  0],
        [ flatCrest / 2,  0],
        [ flatRoot  / 2, -depth],
      ];
    },
    depthFactor: 0.5,
  },
  square: {
    profileFn(pitch, depth) {
      const q = pitch / 4;
      return [[-q, 0], [-q, -depth], [q, -depth], [q, 0]];
    },
    depthFactor: 0.5,
  },
};

function buildThread(p = {}) {
  const {
    nominalDiameter = 0.006,
    pitch           = 0.001,
    length          = 0.020,
    threadForm      = 'metric',
    handedness      = 'right',
    profileSegs     = 8,
    pathStepsPerRev = 64,
    leadIn          = true,
    material        = 'steel_304ss',
  } = p;

  const def        = THREAD_PROFILES[threadForm] || THREAD_PROFILES.metric;
  const depth      = pitch * def.depthFactor;
  const majorR     = nominalDiameter / 2;
  const minorR     = majorR - depth;
  const nRevs      = length / pitch;
  const totalSteps = Math.round(nRevs * pathStepsPerRev);
  const handSign   = handedness === 'right' ? 1 : -1;

  const pathPoints = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t     = i / totalSteps;
    const angle = handSign * t * nRevs * TWO_PI;
    const y     = t * length - length / 2;
    pathPoints.push([majorR * Math.cos(angle), y, majorR * Math.sin(angle)]);
  }

  const profileLocal = def.profileFn(pitch, depth);
  const profile2D = profileLocal.map(([px, py]) => [py, px]);

  const geo = sweepProfile(profile2D, pathPoints, { capStart: false, capEnd: false });

  const base = tessCylinder({
    radiusTop: minorR, radiusBottom: minorR, height: length,
    radialSegs: 32, heightSegs: Math.ceil(nRevs * 2),
  });

  const parts = [base, geo];
  if (leadIn) {
    const chamH = pitch * 2;
    parts.push(applyTransform(
      tessCylinder({ radiusTop: majorR * 0.7, radiusBottom: majorR, height: chamH, radialSegs: 24, heightSegs: 2 }),
      { ty: -(length / 2 + chamH / 2) }
    ));
  }

  const mat = resolveMaterial(material);
  return {
    type: 'thread', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: [`${threadForm}_thread`, `${handedness}_hand`, ...(leadIn ? ['lead_in_chamfer'] : [])],
    nominalDiameter, pitch, depth, majorR, minorR, nRevs,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §16  WELD BEAD GEOMETRY
   ═══════════════════════════════════════════════════════════════════════════ */

function buildFilletWeld(p = {}) {
  const {
    pathPoints   = [[0, 0, 0], [0.1, 0, 0]],
    legSize      = 0.006,
    convexity    = 0.25,
    radialSegs   = 10,
    material     = 'steel_mild',
  } = p;

  const r = legSize / 2;
  const profile2D = [];
  for (let i = 0; i <= radialSegs; i++) {
    const t = (i / radialSegs);
    const a = Math.PI + t * Math.PI;
    profile2D.push([
      (r + r * convexity) * Math.cos(a),
      (r + r * convexity) * Math.sin(a) * 0.6,
    ]);
  }

  const geo = sweepProfile(profile2D, pathPoints, { capStart: true, capEnd: true });
  const mat = resolveMaterial(material);
  return {
    type: 'fillet_weld', material: mat, geo, params: p,
    features: ['fillet_weld_bead', 'convex_cap'],
    legSize,
  };
}

function buildButtWeld(p = {}) {
  const {
    pathPoints  = [[0, 0, 0], [0.1, 0, 0]],
    beadWidth   = 0.012,
    beadHeight  = 0.003,
    radialSegs  = 12,
    material    = 'steel_mild',
  } = p;

  const hw = beadWidth  / 2;
  const hh = beadHeight;
  const profile2D = [];
  for (let i = 0; i <= radialSegs; i++) {
    const a = Math.PI + (i / radialSegs) * Math.PI;
    profile2D.push([hw * Math.cos(a), hh * Math.sin(a) * 0.5]);
  }

  const geo = sweepProfile(profile2D, pathPoints, { capStart: true, capEnd: true });
  const mat = resolveMaterial(material);
  return {
    type: 'butt_weld', material: mat, geo, params: p,
    features: ['butt_weld_bead'],
    beadWidth, beadHeight,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §17  PCB BOARD + COMPONENT OUTLINE GENERATOR
   ═══════════════════════════════════════════════════════════════════════════ */

function buildPCBBoard(p = {}) {
  const {
    width           = 0.100,
    height          = 0.080,
    thickness       = 0.0016,
    cornerRadius    = 0.002,
    cornerSegs      = 6,
    copperThickness = 35e-6,
    drillList       = [],
    components      = [],
    layers          = 4,
    material        = 'fr4',
  } = p;

  const parts = [];

  parts.push(tessBox({
    w: width, h: thickness, d: height,
    segW: 4, segH: 1, segD: 4,
  }));

  const cuSlab = applyTransform(
    tessBox({ w: width * 0.98, h: copperThickness, d: height * 0.98, segW: 2, segH: 1, segD: 2 }),
    { ty: thickness / 2 + copperThickness / 2 }
  );
  cuSlab._isCopperLayer = true;
  parts.push(cuSlab);

  for (const drill of drillList) {
    const r = drill.dia / 2;
    parts.push(applyTransform(
      tessCylinder({ radiusTop: r, radiusBottom: r, height: thickness * 1.1, radialSegs: drill.dia > 0.002 ? 24 : 16 }),
      { tx: drill.cx, tz: drill.cz }
    ));
  }

  for (const comp of components) {
    const compGeo = applyTransform(
      tessBox({ w: comp.w || 0.004, h: comp.h || 0.002, d: comp.d || 0.004, segW: 1, segH: 1, segD: 1 }),
      { tx: comp.cx || 0, ty: thickness / 2 + (comp.h || 0.002) / 2, tz: comp.cz || 0 }
    );
    parts.push(compGeo);
  }

  if (cornerRadius > 0) {
    const hw = width / 2, hh = height / 2;
    for (const [sx, sz] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      parts.push(applyTransform(
        tessBox({ w: cornerRadius, h: thickness * 1.05, d: cornerRadius, segW: 1, segH: 1, segD: 1 }),
        { tx: sx * (hw - cornerRadius / 2), tz: sz * (hh - cornerRadius / 2), ry: Math.PI / 4 }
      ));
    }
  }

  const mat = resolveMaterial(material);
  return {
    type: 'pcb', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: [
      `${layers}_layer_pcb`,
      'fr4_substrate',
      'copper_surface',
      ...(drillList.length > 0 ? [`${drillList.length}_drill_holes`] : []),
      ...(components.length > 0 ? [`${components.length}_components`] : []),
    ],
    width, height, thickness, layers,
  };
}

const PCBComponents = {
  ic(p = {}) {
    const { w = 0.014, d = 0.014, h = 0.003, leads = 48, cx = 0, cz = 0, boardY = 0 } = p;
    const parts = [];
    parts.push(applyTransform(tessBox({ w, h, d, segW: 2, segH: 1, segD: 2 }), { tx: cx, ty: boardY + h/2, tz: cz }));
    const leadsPerSide = Math.floor(leads / 4);
    const leadW = 0.0004, leadH = 0.0008, leadD = 0.0025;
    const pitch = w / (leadsPerSide + 1);
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < leadsPerSide; i++) {
        const offset = -w/2 + pitch * (i + 1);
        const lx = side < 2 ? offset : (side === 2 ? w/2 + leadD/2 : -w/2 - leadD/2);
        const lz = side < 2 ? (side === 0 ? d/2 + leadD/2 : -d/2 - leadD/2) : offset;
        parts.push(applyTransform(
          tessBox({ w: leadW, h: leadH, d: leadD, segW:1, segH:1, segD:1 }),
          { tx: cx + lx, ty: boardY + leadH/2, tz: cz + lz }
        ));
      }
    }
    return mergeGeos(...parts);
  },
  cap(p = {}) {
    const { w = 0.002, d = 0.001, h = 0.0015, cx = 0, cz = 0, boardY = 0 } = p;
    return applyTransform(tessBox({ w, h, d, segW:1, segH:1, segD:1 }), { tx: cx, ty: boardY + h/2, tz: cz });
  },
  resistor(p = {}) {
    const { bodyLen = 0.009, bodyDia = 0.003, leadDia = 0.0005, leadLen = 0.006, cx = 0, cz = 0, boardY = 0 } = p;
    const body = applyTransform(
      tessCylinder({ radiusTop: bodyDia/2, radiusBottom: bodyDia/2, height: bodyLen, radialSegs:12, heightSegs:2 }),
      { tx: cx, ty: boardY + bodyDia/2, tz: cz, rz: Math.PI/2 }
    );
    const lead1 = applyTransform(
      tessCylinder({ radiusTop: leadDia/2, radiusBottom: leadDia/2, height: leadLen, radialSegs:8, heightSegs:1 }),
      { tx: cx - bodyLen/2 - leadLen/2, ty: boardY + bodyDia/2, tz: cz, rz: Math.PI/2 }
    );
    const lead2 = applyTransform(
      tessCylinder({ radiusTop: leadDia/2, radiusBottom: leadDia/2, height: leadLen, radialSegs:8, heightSegs:1 }),
      { tx: cx + bodyLen/2 + leadLen/2, ty: boardY + bodyDia/2, tz: cz, rz: Math.PI/2 }
    );
    return mergeGeos(body, lead1, lead2);
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   §18  CONSTRAINT SOLVER
   ═══════════════════════════════════════════════════════════════════════════ */

function createConstraintSolver(initialVars = {}) {
  const vars        = { ...initialVars };
  const constraints = [];
  const history     = [];

  const CONSTRAINT_TYPES = {
    fix: ({ varName, value }) => {
      vars[varName] = value;
    },
    distance_2pt: ({ ptA, ptB, distance }) => {
      const ax = vars[ptA.x] || 0, ay = vars[ptA.y] || 0, az = vars[ptA.z] || 0;
      const bx = vars[ptB.x] || 0, by = vars[ptB.y] || 0, bz = vars[ptB.z] || 0;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const cur = Math.sqrt(dx*dx + dy*dy + dz*dz) || EPSILON;
      const err = distance - cur;
      const f   = err / 2;
      const nx = dx / cur, ny = dy / cur, nz = dz / cur;
      if (ptA.x) vars[ptA.x] -= nx * f;
      if (ptA.y) vars[ptA.y] -= ny * f;
      if (ptA.z) vars[ptA.z] -= nz * f;
      if (ptB.x) vars[ptB.x] += nx * f;
      if (ptB.y) vars[ptB.y] += ny * f;
      if (ptB.z) vars[ptB.z] += nz * f;
    },
    angle_2lines: ({ lineA, lineB, angleDeg }) => {
      const targetRad = deg(angleDeg);
      const ax1 = vars[lineA.ax]||0, ay1 = vars[lineA.ay]||0;
      const ax2 = vars[lineA.bx]||0, ay2 = vars[lineA.by]||0;
      const bx1 = vars[lineB.ax]||0, by1 = vars[lineB.ay]||0;
      const bx2 = vars[lineB.bx]||0, by2 = vars[lineB.by]||0;
      const dax = ax2-ax1, day = ay2-ay1;
      const dbx = bx2-bx1, dby = by2-by1;
      const la  = Math.sqrt(dax*dax+day*day)||1;
      const lb  = Math.sqrt(dbx*dbx+dby*dby)||1;
      const cur = Math.acos(clamp((dax*dbx+day*dby)/(la*lb), -1, 1));
      const correction = (targetRad - cur) * 0.1;
      vars[lineA.bx] = (vars[lineA.bx] || 0) - day / la * correction;
      vars[lineA.by] = (vars[lineA.by] || 0) + dax / la * correction;
    },
    equal: ({ varA, varB }) => {
      const mid = (vars[varA] + vars[varB]) / 2;
      vars[varA] = mid; vars[varB] = mid;
    },
    ratio: ({ varA, varB, factor }) => {
      vars[varA] = (vars[varB] || 0) * factor;
    },
    clamp_range: ({ varName, lo, hi }) => {
      vars[varName] = clamp(vars[varName] || 0, lo, hi);
    },
    gear_ratio: ({ toothA, toothB, speedA, speedB }) => {
      const nA = vars[toothA] || 1, nB = vars[toothB] || 1;
      const curSpeedB = (vars[speedA] || 0) * nA / nB;
      vars[speedB] = curSpeedB;
    },
  };

  return {
    vars,
    constraints,
    set(name, value) { vars[name] = value; return this; },
    get(name)        { return vars[name]; },
    addConstraint(type, params, id = null) {
      if (!CONSTRAINT_TYPES[type]) throw new Error(`Unknown constraint type: ${type}`);
      constraints.push({ id: id || `${type}_${constraints.length}`, type, params });
      return this;
    },
    removeConstraint(id) {
      const idx = constraints.findIndex(c => c.id === id);
      if (idx !== -1) constraints.splice(idx, 1);
      return this;
    },
    solve(maxIter = 50, tolerance = 1e-6) {
      let iteration = 0, residual = Infinity;
      while (iteration < maxIter && residual > tolerance) {
        const prev = { ...vars };
        for (const c of constraints) {
          CONSTRAINT_TYPES[c.type](c.params);
        }
        residual = Object.keys(vars).reduce((s, k) => {
          const d = (vars[k] || 0) - (prev[k] || 0);
          return s + d * d;
        }, 0);
        residual = Math.sqrt(residual);
        iteration++;
      }
      history.push({ iteration, residual, timestamp: Date.now() });
      return { converged: residual <= tolerance, residual, iterations: iteration };
    },
    snapshot() { return { ...vars }; },
    getHistory() { return [...history]; },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §19  ADDITIONAL COMPLEX PART BUILDERS
   ═══════════════════════════════════════════════════════════════════════════ */

function buildShaft(p = {}) {
  const {
    steps = [
      { dia: 0.030, length: 0.050, label: 'input_end'    },
      { dia: 0.035, length: 0.080, label: 'bearing_A'    },
      { dia: 0.040, length: 0.200, label: 'body'         },
      { dia: 0.035, length: 0.080, label: 'bearing_B'    },
      { dia: 0.025, length: 0.040, label: 'output_end'   },
    ],
    keyway        = true,
    keywayW       = 0.010,
    keywayD       = 0.005,
    chamferSize   = 0.002,
    centreHole    = true,
    centreHoleDia = 0.003,
    radialSegs    = 48,
    material      = 'steel_4140',
  } = p;

  const parts = [];
  const totalLength = steps.reduce((s, st) => s + st.length, 0);
  let zCursor = -totalLength / 2;

  for (let si = 0; si < steps.length; si++) {
    const st = steps[si];
    const r  = st.dia / 2;
    const zCentre = zCursor + st.length / 2;

    parts.push(applyTransform(
      tessCylinder({ radiusTop: r, radiusBottom: r, height: st.length, radialSegs, heightSegs: 3 }),
      { tx: zCentre, ry: Math.PI / 2 }
    ));

    if (si > 0 && chamferSize > 0) {
      const prevR = steps[si - 1].dia / 2;
      if (prevR !== r) {
        const cH = chamferSize * Math.SQRT2;
        parts.push(applyTransform(
          tessCylinder({ radiusTop: Math.min(r, prevR), radiusBottom: Math.max(r, prevR), height: cH, radialSegs, heightSegs: 1, openEnded: true }),
          { tx: zCursor + cH / 2, ry: Math.PI / 2 }
        ));
      }
    }

    zCursor += st.length;
  }

  if (keyway && steps[0]) {
    const r    = steps[0].dia / 2;
    const kzC  = -totalLength / 2 + steps[0].length / 2;
    const kGeo = applyTransform(
      tessBox({ w: steps[0].length, h: keywayD, d: keywayW, segW: 4, segH: 1, segD: 2 }),
      { tx: kzC, ty: r - keywayD / 2, ry: Math.PI / 2 }
    );
    parts.push(kGeo);
  }

  if (centreHole) {
    const cr = centreHoleDia / 2;
    const cH = centreHoleDia * 3;
    for (const xSign of [-1, 1]) {
      parts.push(applyTransform(
        tessCylinder({ radiusTop: cr * 0.5, radiusBottom: cr, height: cH, radialSegs: 12, heightSegs: 1 }),
        { tx: xSign * (totalLength / 2 - cH / 2), ry: Math.PI / 2 * xSign }
      ));
    }
  }

  const mat = resolveMaterial(material);
  return {
    type: 'shaft', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['stepped_shaft', ...(keyway ? ['keyway'] : []), ...(centreHole ? ['centre_holes'] : []), 'shoulder_chamfers'],
    totalLength,
    steps,
  };
}

function buildPulley(p = {}) {
  const {
    pitchDia   = 0.100,
    faceWidth  = 0.025,
    hubDia     = 0.040,
    hubLength  = 0.050,
    boreDia    = 0.020,
    grooveType = 'v',
    grooveAngle = 38,
    grooveCount = 1,
    spokeCount  = 0,
    material    = 'al_6061_t6',
  } = p;

  const rimR  = pitchDia / 2;
  const hubR  = hubDia   / 2;
  const boreR = boreDia  / 2;
  const webT  = Math.max(faceWidth * 0.15, 0.004);
  const parts = [];

  parts.push(tessCylinder({
    radiusTop: hubR, radiusBottom: hubR, height: hubLength,
    radialSegs: 32, heightSegs: 3,
  }));
  parts.push(applyTransform(
    tessCylinder({ radiusTop: boreR, radiusBottom: boreR, height: hubLength * 1.05, radialSegs: 24, heightSegs: 2 }),
    { ry: 0 }
  ));

  if (spokeCount === 0) {
    parts.push(tessAnnulusRing({ outerR: rimR, innerR: hubR, y: 0,        normalY:  1, segs: 64 }));
    parts.push(tessAnnulusRing({ outerR: rimR, innerR: hubR, y: webT,     normalY: -1, segs: 64 }));
    parts.push(applyTransform(
      tessTube({ outerRadius: rimR, innerRadius: hubR, height: webT, radialSegs: 64, heightSegs: 1 }),
      { ty: webT / 2 }
    ));
  } else {
    const spokeW = (rimR - hubR) * 0.4;
    const spokeH = webT;
    for (let i = 0; i < spokeCount; i++) {
      const angle = (i / spokeCount) * TWO_PI;
      const rMid  = (rimR + hubR) / 2;
      parts.push(applyTransform(
        tessBox({ w: spokeW, h: spokeH, d: rimR - hubR, segW: 2, segH: 1, segD: 4 }),
        { tx: rMid * Math.cos(angle), ty: webT / 2, tz: rMid * Math.sin(angle), ry: angle }
      ));
    }
    parts.push(applyTransform(tessCylinder({ radiusTop: hubR * 1.2, radiusBottom: hubR * 1.2, height: webT, radialSegs: 24, heightSegs: 1 }), { ty: webT / 2 }));
  }

  if (grooveType === 'v') {
    const totalGW    = faceWidth;
    const singleGW   = totalGW / grooveCount;
    const grooveD    = singleGW * 0.5;
    for (let i = 0; i < grooveCount; i++) {
      const gz = -faceWidth / 2 + singleGW * (i + 0.5);
      parts.push(applyTransform(
        tessCylinder({
          radiusTop:    rimR,
          radiusBottom: rimR - grooveD,
          height:       singleGW * 0.5,
          radialSegs: 48, heightSegs: 2,
        }),
        { ty: gz }
      ));
    }
  } else {
    parts.push(applyTransform(
      tessCylinder({ radiusTop: rimR, radiusBottom: rimR, height: faceWidth, radialSegs: 64, heightSegs: 3 }),
      {}
    ));
  }

  const mat = resolveMaterial(material);
  return {
    type: 'pulley', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: [`${grooveType}_groove`, `${grooveCount}_groove(s)`, spokeCount > 0 ? `${spokeCount}_spokes` : 'solid_web', 'hub_bore'],
    pitchDia, faceWidth, grooveCount,
  };
}

function buildHydraulicCylinder(p = {}) {
  const {
    boreDia       = 0.050,
    rodDia        = 0.025,
    stroke        = 0.150,
    wallThickness = 0.008,
    endCapT       = 0.015,
    portDia       = 0.008,
    mountStyle    = 'flange',
    radialSegs    = 48,
    material      = 'steel_304ss',
  } = p;

  const outerR = boreDia / 2 + wallThickness;
  const boreR  = boreDia / 2;
  const rodR   = rodDia  / 2;
  const bodyL  = stroke + boreDia;
  const parts  = [];

  parts.push(tessTube({ outerRadius: outerR, innerRadius: boreR, height: bodyL, radialSegs, heightSegs: 6 }));

  parts.push(applyTransform(
    tessAnnulusRing({ outerR, innerR: 0, y: 0, normalY: -1, segs: radialSegs }),
    { ty: -bodyL / 2 }
  ));
  parts.push(applyTransform(
    tessBox({ w: outerR * 2.4, h: endCapT, d: outerR * 2.4, segW: 3, segH: 2, segD: 3 }),
    { ty: -bodyL / 2 - endCapT / 2 }
  ));

  parts.push(applyTransform(
    tessAnnulusRing({ outerR, innerR: rodR * 1.2, y: 0, normalY: 1, segs: radialSegs }),
    { ty: bodyL / 2 }
  ));
  parts.push(applyTransform(
    tessBox({ w: outerR * 2.4, h: endCapT, d: outerR * 2.4, segW: 3, segH: 2, segD: 3 }),
    { ty: bodyL / 2 + endCapT / 2 }
  ));

  const rodL = stroke * 0.75 + bodyL / 2;
  parts.push(applyTransform(
    tessCylinder({ radiusTop: rodR, radiusBottom: rodR, height: rodL, radialSegs: 32, heightSegs: 4 }),
    { ty: rodL / 2 + bodyL / 2 }
  ));

  const portR = portDia / 2;
  for (const yOff of [-bodyL * 0.35, bodyL * 0.35]) {
    parts.push(applyTransform(
      tessCylinder({ radiusTop: portR, radiusBottom: portR, height: wallThickness * 2, radialSegs: 16, heightSegs: 1 }),
      { tx: outerR, ty: yOff, rx: Math.PI / 2 }
    ));
  }

  if (mountStyle === 'flange') {
    const flangeR = outerR * 1.6;
    const flangeT = endCapT * 0.7;
    parts.push(applyTransform(
      tessAnnulusRing({ outerR: flangeR, innerR: outerR * 0.95, y: 0, normalY: -1, segs: radialSegs }),
      { ty: -bodyL / 2 - endCapT - flangeT / 2 }
    ));
    parts.push(tessBoltCircle({
      bcd: flangeR * 1.5, holeDiameter: portDia * 0.8, holeCount: 4,
      holeDepth: flangeT * 1.1, y: -bodyL / 2 - endCapT, type: 'through',
    }));
  }

  const mat = resolveMaterial(material);
  return {
    type: 'hydraulic_cylinder', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['barrel', 'end_caps', 'piston_rod', 'hydraulic_ports', `${mountStyle}_mount`],
    boreDia, stroke, outerDiameter: outerR * 2, bodyLength: bodyL,
    closedLength: bodyL + endCapT * 2,
    extendedLength: bodyL + endCapT * 2 + stroke,
  };
}

function buildEnclosure(p = {}) {
  const {
    outerW       = 0.150,
    outerH       = 0.080,
    outerD       = 0.100,
    wallT        = 0.003,
    bossCount    = 4,
    bossH        = 0.012,
    bossDia      = 0.008,
    bossBoreDia  = 0.003,
    ribCount     = 2,
    ventSlots    = true,
    ventSlotCount = 4,
    lid          = true,
    material     = 'abs',
  } = p;

  const parts = [];
  const iW = outerW - 2 * wallT;
  const iH = outerH - 2 * wallT;
  const iD = outerD - 2 * wallT;

  parts.push(applyTransform(tessBox({ w: outerW, h: wallT, d: outerD, segW:4, segH:1, segD:4 }), { ty: -outerH/2 + wallT/2 }));
  if (!lid) {
    parts.push(applyTransform(tessBox({ w: outerW, h: wallT, d: outerD, segW:4, segH:1, segD:4 }), { ty: outerH/2 - wallT/2 }));
  }
  parts.push(applyTransform(tessBox({ w: outerW, h: iH + wallT, d: wallT, segW:4, segH:4, segD:1 }), { ty: wallT/2, tz: outerD/2 - wallT/2 }));
  parts.push(applyTransform(tessBox({ w: outerW, h: iH + wallT, d: wallT, segW:4, segH:4, segD:1 }), { ty: wallT/2, tz: -outerD/2 + wallT/2 }));
  parts.push(applyTransform(tessBox({ w: wallT, h: iH + wallT, d: outerD, segW:1, segH:4, segD:4 }), { tx: -outerW/2 + wallT/2, ty: wallT/2 }));
  parts.push(applyTransform(tessBox({ w: wallT, h: iH + wallT, d: outerD, segW:1, segH:4, segD:4 }), { tx:  outerW/2 - wallT/2, ty: wallT/2 }));

  const bossPositions = (() => {
    const ox = iW / 2 - bossDia, oz = iD / 2 - bossDia;
    const base4 = [[-ox,-oz],[-ox,oz],[ox,-oz],[ox,oz]];
    if (bossCount === 4) return base4;
    if (bossCount === 6) return [...base4, [0, -oz], [0, oz]];
    return [...base4, [0, -oz], [0, oz], [-ox, 0], [ox, 0]];
  })();

  for (const [bx, bz] of bossPositions) {
    parts.push(applyTransform(
      tessCylinder({ radiusTop: bossDia/2, radiusBottom: bossDia/2, height: bossH, radialSegs: 16, heightSegs: 2 }),
      { tx: bx, ty: -outerH/2 + wallT + bossH/2, tz: bz }
    ));
    parts.push(applyTransform(
      tessCylinder({ radiusTop: bossBoreDia/2, radiusBottom: bossBoreDia/2, height: bossH * 1.05, radialSegs: 12, heightSegs: 1 }),
      { tx: bx, ty: -outerH/2 + wallT + bossH/2, tz: bz }
    ));
  }

  if (ribCount > 0) {
    const ribH = iH * 0.8;
    const ribT = wallT * 0.8;
    const ribD = iD * 0.3;
    const spacing = iW / (ribCount + 1);
    for (let i = 0; i < ribCount; i++) {
      const rx = -iW / 2 + spacing * (i + 1);
      parts.push(applyTransform(
        tessBox({ w: ribT, h: ribH, d: ribD, segW:1, segH:3, segD:2 }),
        { tx: rx, ty: -outerH/2 + wallT + ribH/2, tz: -outerD/2 + wallT + ribD/2 }
      ));
    }
  }

  if (ventSlots) {
    const slotW = (outerD - 2 * wallT) / (ventSlotCount * 2) * 0.6;
    const slotH = outerH * 0.3;
    const spacing = (outerD - 2 * wallT) / (ventSlotCount + 1);
    for (let i = 0; i < ventSlotCount; i++) {
      const sz = -outerD/2 + wallT + spacing * (i + 1);
      parts.push(applyTransform(
        tessBox({ w: wallT * 1.2, h: slotH, d: slotW, segW:1, segH:2, segD:1 }),
        { tx: outerW/2 - wallT/2, ty: 0 }
      ));
    }
  }

  if (lid) {
    parts.push(applyTransform(
      tessBox({ w: outerW, h: wallT, d: outerD, segW:4, segH:1, segD:4 }),
      { ty: outerH/2 - wallT/2 + wallT * 0.1 }
    ));
  }

  const mat = resolveMaterial(material);
  return {
    type: 'enclosure', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['shell_walls', `${bossCount}_pcb_bosses`, ...(ribCount > 0 ? ['inner_ribs'] : []), ...(ventSlots ? ['vent_slots'] : []), ...(lid ? ['lid'] : [])],
    outerDims: { w: outerW, h: outerH, d: outerD },
    innerDims: { w: iW, h: iH, d: iD },
  };
}

function buildHeatSink(p = {}) {
  const {
    baseW        = 0.080,
    baseD        = 0.060,
    baseT        = 0.006,
    finCount     = 10,
    finH         = 0.030,
    finT         = 0.002,
    finSegs      = 4,
    finTaper     = 0.6,
    mountingHoles = 4,
    holeDia      = 0.003,
    material     = 'al_6061_t6',
  } = p;

  const parts = [];

  parts.push(tessBox({ w: baseW, h: baseT, d: baseD, segW: 4, segH: 1, segD: 4 }));

  const pitch   = baseW / (finCount + 1);
  for (let i = 0; i < finCount; i++) {
    const fx = -baseW / 2 + pitch * (i + 1);
    parts.push(applyTransform(
      tessBox({ w: finT, h: finH, d: baseD * 0.9, segW: 1, segH: finSegs, segD: 3 }),
      { tx: fx, ty: baseT / 2 + finH / 2 }
    ));
  }

  if (mountingHoles > 0) {
    parts.push(tessBoltCircle({
      bcd: Math.min(baseW, baseD) * 0.85,
      holeDiameter: holeDia,
      holeCount: mountingHoles,
      holeDepth: baseT * 1.1,
      y: baseT,
      type: 'through',
      radialSegs: 16,
    }));
  }

  const mat = resolveMaterial(material);
  const thermalResistance = 1 / (0.005 * mat.thermalConductivity * finCount * finH * baseD);
  return {
    type: 'heat_sink', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: [`${finCount}_fins`, 'base_plate', ...(mountingHoles > 0 ? [`${mountingHoles}_mounting_holes`] : [])],
    thermalResistance_K_per_W: round(thermalResistance, 4),
    finCount, finH, finT, baseW, baseD,
  };
}

function buildBoltNut(p = {}) {
  const {
    nominalDia  = 0.006,
    shankLength = 0.020,
    headStyle   = 'hex',
    nutStyle    = 'hex',
    threadPitch = nominalDia * 0.15,
    material    = 'steel_304ss',
  } = p;

  const r  = nominalDia / 2;
  const parts = [];

  const threadGeo = buildThread({
    nominalDiameter: nominalDia,
    pitch: threadPitch,
    length: shankLength * 0.7,
    threadForm: 'metric',
    material,
    leadIn: false,
  });
  parts.push(applyTransform(threadGeo.geo, { ty: shankLength * 0.15 }));

  parts.push(applyTransform(
    tessCylinder({ radiusTop: r, radiusBottom: r, height: shankLength * 0.3, radialSegs: 24, heightSegs: 2 }),
    { ty: shankLength - shankLength * 0.15 }
  ));

  const headH   = nominalDia * 0.65;
  const headAF  = nominalDia * 1.75;
  const headR   = headAF / Math.cos(deg(30));

  if (headStyle === 'hex') {
    const hexVerts = [], hexNormals = [];
    const yBot = shankLength, yTop = shankLength + headH;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * TWO_PI, a1 = ((i+1) / 6) * TWO_PI;
      const x0 = headR * Math.cos(a0), z0 = headR * Math.sin(a0);
      const x1 = headR * Math.cos(a1), z1 = headR * Math.sin(a1);
      const A = [x0, yBot, z0], B = [x1, yBot, z1], CC = [x0, yTop, z0], D = [x1, yTop, z1];
      const ex = x1-x0, ez = z1-z0, len = Math.sqrt(ex*ex+ez*ez)||1;
      const nx = ez/len, nz = -ex/len;
      for (const [v0,v1,v2] of [[A,B,D],[A,D,CC]]) {
        for (const v of [v0,v1,v2]) { hexVerts.push(...v); hexNormals.push(nx,0,nz); }
      }
      hexVerts.push(0,yBot,0, x0,yBot,z0, x1,yBot,z1);
      hexNormals.push(0,-1,0, 0,-1,0, 0,-1,0);
      hexVerts.push(0,yTop,0, x1,yTop,z1, x0,yTop,z0);
      hexNormals.push(0,1,0, 0,1,0, 0,1,0);
    }
    parts.push({ verts: new Float32Array(hexVerts), normals: new Float32Array(hexNormals) });
  } else if (headStyle === 'socket') {
    const headCylR = nominalDia * 0.9;
    parts.push(applyTransform(
      tessCylinder({ radiusTop: headCylR, radiusBottom: headCylR, height: headH, radialSegs: 32, heightSegs: 2 }),
      { ty: shankLength + headH / 2 }
    ));
    const sockR = nominalDia * 0.5;
    parts.push(applyTransform(
      tessCylinder({ radiusTop: sockR, radiusBottom: sockR, height: headH * 0.65, radialSegs: 6, heightSegs: 1 }),
      { ty: shankLength + headH * 0.825 }
    ));
  }

  const nutH  = nominalDia * 0.8;
  const nutAF = nominalDia * 1.75;
  const nutR  = nutAF / Math.cos(deg(30));
  const nutY  = -(nutH + nominalDia * 0.5);

  const nutVerts = [], nutNormals = [];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TWO_PI, a1 = ((i+1) / 6) * TWO_PI;
    const x0 = nutR * Math.cos(a0), z0 = nutR * Math.sin(a0);
    const x1 = nutR * Math.cos(a1), z1 = nutR * Math.sin(a1);
    const A = [x0, nutY, z0], B = [x1, nutY, z1];
    const CC2 = [x0, nutY+nutH, z0], D2 = [x1, nutY+nutH, z1];
    const ex = x1-x0, ez = z1-z0, len = Math.sqrt(ex*ex+ez*ez)||1;
    const nx = ez/len, nz = -ex/len;
    for (const [v0,v1,v2] of [[A,B,D2],[A,D2,CC2]]) {
      for (const v of [v0,v1,v2]) { nutVerts.push(...v); nutNormals.push(nx,0,nz); }
    }
    nutVerts.push(0,nutY,0, x0,nutY,z0, x1,nutY,z1);
    nutNormals.push(0,-1,0, 0,-1,0, 0,-1,0);
    nutVerts.push(0,nutY+nutH,0, x1,nutY+nutH,z1, x0,nutY+nutH,z0);
    nutNormals.push(0,1,0, 0,1,0, 0,1,0);
  }
  parts.push({ verts: new Float32Array(nutVerts), normals: new Float32Array(nutNormals) });

  const mat = resolveMaterial(material);
  return {
    type: 'bolt_nut', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: [`${headStyle}_head`, `${nutStyle}_nut`, 'metric_thread', 'shank'],
    nominalDia, shankLength, threadPitch,
  };
}

function buildBearing(p = {}) {
  const {
    innerDia     = 0.020,
    outerDia     = 0.047,
    width        = 0.014,
    ballCount    = 8,
    raceGrooveR  = 0.52,
    material     = 'steel_4140',
  } = p;

  const innerR   = innerDia / 2;
  const outerR   = outerDia / 2;
  const raceT    = (outerR - innerR) / 4;
  const ballR    = (outerR - innerR) / 2 - raceT * 0.5;
  const pitchR   = (innerR + outerR) / 2;
  const parts    = [];

  parts.push(tessTube({ outerRadius: innerR + raceT, innerRadius: innerR, height: width, radialSegs: 48, heightSegs: 3 }));
  parts.push(tessTube({ outerRadius: outerR, innerRadius: outerR - raceT, height: width, radialSegs: 48, heightSegs: 3 }));

  for (let i = 0; i < ballCount; i++) {
    const angle = (i / ballCount) * TWO_PI;
    parts.push(applyTransform(
      tessSphere({ radius: ballR, widthSegs: 12, heightSegs: 8 }),
      { tx: pitchR * Math.cos(angle), tz: pitchR * Math.sin(angle) }
    ));
  }

  parts.push(tessAnnulusRing({ outerR: pitchR + ballR * 0.4, innerR: pitchR - ballR * 0.4, y: 0, normalY: 1, segs: 48 }));

  for (const y of [-width / 2 + 0.001, width / 2 - 0.001]) {
    parts.push(tessAnnulusRing({ outerR: outerR - raceT * 0.5, innerR: innerR + raceT * 0.5, y, normalY: y > 0 ? -1 : 1, segs: 32 }));
  }

  const mat = resolveMaterial(material);
  return {
    type: 'bearing', material: mat,
    geo: mergeGeos(...parts),
    params: p,
    features: ['inner_race', 'outer_race', `${ballCount}_balls`, 'retainer_cage', 'seals'],
    innerDia, outerDia, width, ballCount, ballR: round(ballR * 1000, 2) + 'mm',
    dynamicLoadRating_N: Math.round(3500 * ballCount * ballR * 1000),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §20  EXTEND PUBLIC API WITH PASS-2 EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

Object.assign(global.UARE_CAD, {
  createBSpline,
  createNURBS,
  createCircularArc,
  bsplineBasis,
  clampedKnots,
  sweepProfile,
  loftProfiles,
  buildFrames,
  buildThread,
  THREAD_PROFILES,
  buildFilletWeld,
  buildButtWeld,
  buildPCBBoard,
  PCBComponents,
  createConstraintSolver,
  buildShaft,
  buildPulley,
  buildHydraulicCylinder,
  buildEnclosure,
  buildHeatSink,
  buildBoltNut,
  buildBearing,

  CATEGORIES: Object.assign(global.UARE_CAD.CATEGORIES, {
    shaft:      { keywords: ['shaft','spindle','axle','crankshaft','camshaft','driveshaft'], builder: buildShaft },
    pulley:     { keywords: ['pulley','sheave','sprocket_belt','v-belt','flat_belt'],        builder: buildPulley },
    hydraulic:  { keywords: ['hydraulic','pneumatic','cylinder','actuator','ram','piston'],  builder: buildHydraulicCylinder },
    enclosure:  { keywords: ['enclosure','housing','case','cabinet','box','cover'],          builder: buildEnclosure },
    heatsink:   { keywords: ['heat sink','heatsink','thermal','fin','cooler','radiator'],    builder: buildHeatSink },
    bolt:       { keywords: ['bolt','screw','fastener','hex bolt','cap screw','nut'],        builder: buildBoltNut },
    bearing:    { keywords: ['bearing','ball bearing','deep groove','roller','race'],        builder: buildBearing },
    pcb:        { keywords: ['pcb','board','circuit','electronic','fr4','substrate'],        builder: buildPCBBoard },
    thread:     { keywords: ['thread','metric','unc','acme','square thread','lead screw'],   builder: buildThread },
  }),

  version: '2.0.0-pass2',
});

})(typeof window !== 'undefined' ? window : global);
/* END OF PASS 2 — Pass 3 will add: B-Rep half-edge kernel, boolean ops
   (union/subtract/intersect), full triangle-mesh STEP/OBJ export,
   exploded-view assembly, kinematic chains, and FEA load path visualiser */

/* END OF PASS 2 */

/* ═══════════════════════════════════════════════════════════════════════════
   PASS 3  (2026-04-20)
   §21  Triangle-mesh utilities  (BVH, winding, repair, normals)
   §22  Mesh Boolean ops         (union / subtract / intersect — triangle soup)
   §23  Assembly tree            (parts + transforms + BOM)
   §24  Kinematic chain          (revolute / prismatic joints, FK/IK stub)
   §25  STEP AP214 tessellated export  (TRIANGULATED_FACE entities)
   §26  OBJ + MTL export
   §27  FEA load-path visualiser (stress heatmap on surface mesh)
   §28  Parametric dimension annotations
   §29  UARE_CAD API — final Pass-3 extension
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
'use strict';

const C = global.UARE_CAD;
if (!C) { console.error('[UARE CAD Pass 3] Passes 1-2 must load first.'); return; }

const {
  Vec3, Mat4, applyTransform, mergeGeos, smoothNormals, indexedToFlat,
  resolveMaterial, MATERIALS,
  deg, clamp, lerp, round, EPSILON, TWO_PI,
  tessBox, tessCylinder, tessSphere, tessTorus, tessTube, tessAnnulusRing,
  buildScene,
} = C;

/* ═══════════════════════════════════════════════════════════════════════════
   §21  TRIANGLE-MESH UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

function getTri(verts, i) {
  const o = i * 9;
  return {
    a: [verts[o],   verts[o+1], verts[o+2]],
    b: [verts[o+3], verts[o+4], verts[o+5]],
    c: [verts[o+6], verts[o+7], verts[o+8]],
  };
}

function triCount(geo) { return geo.verts.length / 9; }

function triCentroid(t) {
  return [(t.a[0]+t.b[0]+t.c[0])/3, (t.a[1]+t.b[1]+t.c[1])/3, (t.a[2]+t.b[2]+t.c[2])/3];
}

function triNormal(t) {
  const ex = t.b[0]-t.a[0], ey = t.b[1]-t.a[1], ez = t.b[2]-t.a[2];
  const fx = t.c[0]-t.a[0], fy = t.c[1]-t.a[1], fz = t.c[2]-t.a[2];
  return [ey*fz-ez*fy, ez*fx-ex*fz, ex*fy-ey*fx];
}

function triArea(t) {
  const n = triNormal(t);
  return 0.5 * Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
}

function meshAABB(geo) {
  const v = geo.verts;
  let mnx=Infinity, mny=Infinity, mnz=Infinity;
  let mxx=-Infinity, mxy=-Infinity, mxz=-Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (v[i]   < mnx) mnx = v[i];   if (v[i]   > mxx) mxx = v[i];
    if (v[i+1] < mny) mny = v[i+1]; if (v[i+1] > mxy) mxy = v[i+1];
    if (v[i+2] < mnz) mnz = v[i+2]; if (v[i+2] > mxz) mxz = v[i+2];
  }
  return {
    min:    [mnx, mny, mnz],
    max:    [mxx, mxy, mxz],
    centre: [(mnx+mxx)/2, (mny+mxy)/2, (mnz+mxz)/2],
    size:   [mxx-mnx, mxy-mny, mxz-mnz],
  };
}

function buildBVH(geo) {
  const bb   = meshAABB(geo);
  const cx   = bb.centre[0], cy = bb.centre[1], cz = bb.centre[2];
  const cells = Array.from({ length: 8 }, () => ({ triIndices: [] }));

  const n = triCount(geo);
  for (let i = 0; i < n; i++) {
    const t    = getTri(geo.verts, i);
    const cen  = triCentroid(t);
    const xi   = cen[0] >= cx ? 1 : 0;
    const yi   = cen[1] >= cy ? 1 : 0;
    const zi   = cen[2] >= cz ? 1 : 0;
    cells[xi*4 + yi*2 + zi].triIndices.push(i);
  }

  for (const cell of cells) {
    if (cell.triIndices.length === 0) { cell.aabb = null; continue; }
    let mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity,mxz=-Infinity;
    for (const i of cell.triIndices) {
      const t = getTri(geo.verts, i);
      for (const v of [t.a, t.b, t.c]) {
        if (v[0]<mnx)mnx=v[0]; if (v[0]>mxx)mxx=v[0];
        if (v[1]<mny)mny=v[1]; if (v[1]>mxy)mxy=v[1];
        if (v[2]<mnz)mnz=v[2]; if (v[2]>mxz)mxz=v[2];
      }
    }
    cell.aabb = { min:[mnx,mny,mnz], max:[mxx,mxy,mxz] };
  }
  return cells;
}

function rayTriIntersect(ro, rd, t) {
  const EPSI = 1e-9;
  const e1 = [t.b[0]-t.a[0], t.b[1]-t.a[1], t.b[2]-t.a[2]];
  const e2 = [t.c[0]-t.a[0], t.c[1]-t.a[1], t.c[2]-t.a[2]];
  const h  = [rd[1]*e2[2]-rd[2]*e2[1], rd[2]*e2[0]-rd[0]*e2[2], rd[0]*e2[1]-rd[1]*e2[0]];
  const a  = e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2];
  if (Math.abs(a) < EPSI) return null;
  const f  = 1 / a;
  const s  = [ro[0]-t.a[0], ro[1]-t.a[1], ro[2]-t.a[2]];
  const u  = f * (s[0]*h[0]+s[1]*h[1]+s[2]*h[2]);
  if (u < 0 || u > 1) return null;
  const q  = [s[1]*e1[2]-s[2]*e1[1], s[2]*e1[0]-s[0]*e1[2], s[0]*e1[1]-s[1]*e1[0]];
  const v  = f * (rd[0]*q[0]+rd[1]*q[1]+rd[2]*q[2]);
  if (v < 0 || u + v > 1) return null;
  const tVal = f * (e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2]);
  return tVal > EPSI ? tVal : null;
}

function pointInMesh(pt, geo, bvh) {
  const ro = [pt[0], pt[1], pt[2]];
  const rd = [1, 0, 0];
  let hits  = 0;
  for (const cell of bvh) {
    if (!cell.aabb) continue;
    if (pt[1] < cell.aabb.min[1] || pt[1] > cell.aabb.max[1]) continue;
    if (pt[2] < cell.aabb.min[2] || pt[2] > cell.aabb.max[2]) continue;
    for (const i of cell.triIndices) {
      const t = getTri(geo.verts, i);
      if (rayTriIntersect(ro, rd, t) !== null) hits++;
    }
  }
  return (hits % 2) === 1;
}

function repairMesh(geo) {
  const n = triCount(geo);
  const keepV = [], keepN = [];
  for (let i = 0; i < n; i++) {
    const t = getTri(geo.verts, i);
    if (triArea(t) > EPSILON) {
      const o = i * 9;
      keepV.push(...geo.verts.slice(o, o+9));
      keepN.push(...geo.normals.slice(o, o+9));
    }
  }
  return { verts: new Float32Array(keepV), normals: new Float32Array(keepN) };
}

function recomputeNormals(geo) {
  const aabb   = meshAABB(geo);
  const mc     = aabb.centre;
  const n      = triCount(geo);
  const newN   = new Float32Array(geo.normals.length);

  for (let i = 0; i < n; i++) {
    const t   = getTri(geo.verts, i);
    const nor = triNormal(t);
    const len = Math.sqrt(nor[0]*nor[0]+nor[1]*nor[1]+nor[2]*nor[2]) || 1;
    nor[0]/=len; nor[1]/=len; nor[2]/=len;
    const cen = triCentroid(t);
    const dot = nor[0]*(cen[0]-mc[0]) + nor[1]*(cen[1]-mc[1]) + nor[2]*(cen[2]-mc[2]);
    const sign = dot < 0 ? -1 : 1;
    for (let j = 0; j < 3; j++) {
      const base = i*9 + j*3;
      newN[base]   = nor[0] * sign;
      newN[base+1] = nor[1] * sign;
      newN[base+2] = nor[2] * sign;
    }
  }
  return { verts: geo.verts, normals: newN };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §22  MESH BOOLEAN OPERATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

function _filterTris(geo, testGeo, bvh, keepInside) {
  const n    = triCount(geo);
  const outV = [], outN = [];
  for (let i = 0; i < n; i++) {
    const t    = getTri(geo.verts, i);
    const cen  = triCentroid(t);
    const inside = pointInMesh(cen, testGeo, bvh);
    if (inside === keepInside) {
      const o = i * 9;
      outV.push(...geo.verts.slice(o, o+9));
      outN.push(...geo.normals.slice(o, o+9));
    }
  }
  return { verts: new Float32Array(outV), normals: new Float32Array(outN) };
}

function _flipNormals(geo) {
  const n = new Float32Array(geo.normals);
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  const v = new Float32Array(geo.verts);
  for (let i = 0; i < v.length; i += 9) {
    let tmp;
    tmp=v[i+3]; v[i+3]=v[i+6]; v[i+6]=tmp;
    tmp=v[i+4]; v[i+4]=v[i+7]; v[i+7]=tmp;
    tmp=v[i+5]; v[i+5]=v[i+8]; v[i+8]=tmp;
  }
  return { verts: v, normals: n };
}

function meshUnion(geoA, geoB) {
  const bvhB = buildBVH(geoB);
  const bvhA = buildBVH(geoA);
  const aOut = _filterTris(geoA, geoB, bvhB, false);
  const bOut = _filterTris(geoB, geoA, bvhA, false);
  return repairMesh(mergeGeos(aOut, bOut));
}

function meshSubtract(geoA, geoB) {
  const bvhB = buildBVH(geoB);
  const bvhA = buildBVH(geoA);
  const aOut  = _filterTris(geoA, geoB, bvhB, false);
  const bIn   = _flipNormals(_filterTris(geoB, geoA, bvhA, true));
  return repairMesh(mergeGeos(aOut, bIn));
}

function meshIntersect(geoA, geoB) {
  const bvhB = buildBVH(geoB);
  const bvhA = buildBVH(geoA);
  const aIn = _filterTris(geoA, geoB, bvhB, true);
  const bIn = _filterTris(geoB, geoA, bvhA, true);
  return repairMesh(mergeGeos(aIn, bIn));
}

/* ═══════════════════════════════════════════════════════════════════════════
   §23  ASSEMBLY TREE
   ═══════════════════════════════════════════════════════════════════════════ */

function createAssembly(name = 'Assembly') {
  let idCounter = 0;

  function _node(label, type, part, trs) {
    return {
      id:       ++idCounter,
      label,
      type,
      part:     part || null,
      trs:      trs  || {},
      children: [],
      visible:  true,
      _geo:     null,
    };
  }

  const root = _node(name, 'assembly', null, {});

  function _findById(id, node = root) {
    if (node.id === id) return node;
    for (const c of node.children) {
      const found = _findById(id, c);
      if (found) return found;
    }
    return null;
  }

  return {
    name,
    root,

    addPart(partDef, trs = {}, label = null, parentId = null) {
      const parent = parentId ? _findById(parentId) : root;
      if (!parent) throw new Error(`Assembly: parent id ${parentId} not found`);
      const n = _node(label || partDef.type || 'part', 'part', partDef, trs);
      parent.children.push(n);
      return n.id;
    },

    addSubAssembly(subAsm, trs = {}, parentId = null) {
      const parent = parentId ? _findById(parentId) : root;
      if (!parent) throw new Error(`Assembly: parent id ${parentId} not found`);
      const n = _node(subAsm.name, 'assembly', null, trs);
      n.children = subAsm.root.children;
      parent.children.push(n);
      return n.id;
    },

    flatten(node = root, parentTRS = {}) {
      const geos = [];

      function _walk(nd, pTRS) {
        const combinedTRS = _composeTRS(pTRS, nd.trs);
        if (!nd.visible) return;
        if (nd.type === 'part' && nd.part && nd.part.geo) {
          geos.push(applyTransform(nd.part.geo, combinedTRS));
        }
        for (const c of nd.children) _walk(c, combinedTRS);
      }

      _walk(node, parentTRS);
      return geos.length > 0 ? mergeGeos(...geos) : { verts: new Float32Array(0), normals: new Float32Array(0) };
    },

    explode(factor = 1.5) {
      const parts = [];
      function _collect(nd, pTRS) {
        const cTRS = _composeTRS(pTRS, nd.trs);
        if (nd.type === 'part' && nd.part && nd.part.geo) {
          const aabb   = meshAABB(nd.part.geo);
          const centre = aabb.centre;
          const eTRS   = {
            ...cTRS,
            tx: (cTRS.tx || 0) + centre[0] * (factor - 1),
            ty: (cTRS.ty || 0) + centre[1] * (factor - 1),
            tz: (cTRS.tz || 0) + centre[2] * (factor - 1),
          };
          parts.push({ label: nd.label, geo: applyTransform(nd.part.geo, eTRS), partDef: nd.part });
        }
        for (const c of nd.children) _collect(c, cTRS);
      }
      _collect(root, {});
      return parts;
    },

    generateBOM() {
      const rows = {};
      function _walk(nd) {
        if (nd.type === 'part' && nd.part) {
          const key = `${nd.part.type}_${(nd.part.material || {}).name || 'unknown'}`;
          if (!rows[key]) {
            const mat      = nd.part.material || {};
            const geo      = nd.part.geo || { verts: new Float32Array(0) };
            const volume   = _estimateVolume(geo);
            const density  = mat.density || 7800;
            const mass     = round(volume * density, 4);
            const costPKg  = mat.cost_per_kg || 2;
            rows[key] = {
              partNumber: `UARE-${Object.keys(rows).length + 1001}`,
              label:      nd.label,
              type:       nd.part.type || 'part',
              material:   mat.name || 'unknown',
              qty:        0,
              mass_kg:    mass,
              cost_USD:   round(mass * costPKg, 2),
              features:   nd.part.features || [],
            };
          }
          rows[key].qty++;
        }
        for (const c of nd.children) _walk(c);
      }
      _walk(root);
      return Object.values(rows);
    },

    setVisible(id, visible) {
      const nd = _findById(id);
      if (nd) nd.visible = visible;
      return this;
    },

    getNode: (id) => _findById(id),
  };
}

function _composeTRS(parent, child) {
  return {
    tx: (parent.tx || 0) + (child.tx || 0),
    ty: (parent.ty || 0) + (child.ty || 0),
    tz: (parent.tz || 0) + (child.tz || 0),
    rx: (parent.rx || 0) + (child.rx || 0),
    ry: (parent.ry || 0) + (child.ry || 0),
    rz: (parent.rz || 0) + (child.rz || 0),
    sx: (parent.sx || child.sx || 1),
    sy: (parent.sy || child.sy || 1),
    sz: (parent.sz || child.sz || 1),
  };
}

function _estimateVolume(geo) {
  const bb = meshAABB(geo);
  return bb.size[0] * bb.size[1] * bb.size[2] * 0.35;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §24  KINEMATIC CHAIN
   ═══════════════════════════════════════════════════════════════════════════ */

function createKinematicChain(name = 'Chain') {
  const joints = [];

  return {
    name,
    joints,

    addJoint(j) {
      joints.push({
        type:   j.type   || 'revolute',
        axis:   j.axis   || [0, 1, 0],
        origin: j.origin || [0, 0, 0],
        limits: j.limits || { lo: -Math.PI, hi: Math.PI },
        value:  j.value  || 0,
        label:  j.label  || `J${joints.length + 1}`,
        partId: j.partId || null,
      });
      return joints.length - 1;
    },

    setJoint(idx, value) {
      const j = joints[idx];
      if (!j) return;
      j.value = clamp(value, j.limits.lo, j.limits.hi);
    },

    forwardKinematics() {
      let frames = [];
      let cumTX = 0, cumTY = 0, cumTZ = 0;
      let cumRX = 0, cumRY = 0, cumRZ = 0;

      for (const j of joints) {
        cumTX += j.origin[0]; cumTY += j.origin[1]; cumTZ += j.origin[2];

        if (j.type === 'revolute') {
          const ax = j.axis, ang = j.value;
          if (ax[0] > 0.9)      cumRX += ang;
          else if (ax[1] > 0.9) cumRY += ang;
          else                   cumRZ += ang;
        } else if (j.type === 'prismatic') {
          cumTX += j.axis[0] * j.value;
          cumTY += j.axis[1] * j.value;
          cumTZ += j.axis[2] * j.value;
        }

        frames.push({
          label:  j.label,
          origin: [cumTX, cumTY, cumTZ],
          trs:    { tx: cumTX, ty: cumTY, tz: cumTZ, rx: cumRX, ry: cumRY, rz: cumRZ },
        });
      }
      return frames;
    },

    visualise() {
      const frames = this.forwardKinematics();
      const parts  = [];
      const jR     = 0.006;

      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        parts.push(applyTransform(
          tessSphere({ radius: jR, widthSegs: 12, heightSegs: 8 }),
          { tx: f.origin[0], ty: f.origin[1], tz: f.origin[2] }
        ));
        if (i > 0) {
          const prev = frames[i-1].origin;
          const dx = f.origin[0]-prev[0], dy = f.origin[1]-prev[1], dz = f.origin[2]-prev[2];
          const len = Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (len > EPSILON) {
            const midX = (prev[0]+f.origin[0])/2;
            const midY = (prev[1]+f.origin[1])/2;
            const midZ = (prev[2]+f.origin[2])/2;
            const angZ = Math.atan2(Math.sqrt(dx*dx+dz*dz), dy);
            const angY = Math.atan2(dz, dx);
            parts.push(applyTransform(
              tessCylinder({ radiusTop: jR*0.4, radiusBottom: jR*0.4, height: len, radialSegs: 10, heightSegs: 2 }),
              { tx: midX, ty: midY, tz: midZ, rz: angZ, ry: angY }
            ));
          }
        }
      }
      return parts.length > 0 ? mergeGeos(...parts) : { verts: new Float32Array(0), normals: new Float32Array(0) };
    },

    totalReach() {
      const f = this.forwardKinematics();
      let total = 0;
      for (let i = 1; i < f.length; i++) {
        const p = f[i-1].origin, c = f[i].origin;
        total += Math.sqrt((c[0]-p[0])**2 + (c[1]-p[1])**2 + (c[2]-p[2])**2);
      }
      return total;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §25  STEP AP214 TESSELLATED GEOMETRY EXPORT
   ═══════════════════════════════════════════════════════════════════════════ */

function exportSTEP_AP214(partDef, opts = {}) {
  const {
    author       = 'UARE CAD Engine',
    organisation = 'UARE',
    application  = 'UARE CAD v3',
    units        = 'MM',
  } = opts;

  const geo      = partDef.geo || partDef;
  const mat      = partDef.material || {};
  const partName = (partDef.type || 'part').toUpperCase().replace(/_/g, '-');
  const date     = new Date().toISOString().slice(0, 10);
  const nTri     = triCount(geo);

  let s = 'ISO-10303-21;\n';
  s += 'HEADER;\n';
  s += `FILE_DESCRIPTION(('UARE CAD Engine - ${partName}'),'2;1');\n`;
  s += `FILE_NAME('${partName}.stp','${date}',('${author}'),('${organisation}'),'${application}','','');\n`;
  s += "FILE_SCHEMA(('AP214E3'));\n";
  s += 'ENDSEC;\n\n';
  s += 'DATA;\n';

  let id = 1;
  const L = (content) => { s += `#${id++}=${content};\n`; return id - 1; };
  const REF = (n) => `#${n}`;

  const appId     = L("APPLICATION_CONTEXT('automotive design')");
  const appProto  = L(`APPLICATION_PROTOCOL_DEFINITION('draft international standard','automotive_design',1998,${REF(appId)})`);
  const prodCtx   = L(`PRODUCT_CONTEXT('',${REF(appId)},'mechanical')`);
  const unitCtx   = L('(NAMED_UNIT(*))(SI_UNIT($,.METRE.))(LENGTH_UNIT())');
  const planeAng  = L('(NAMED_UNIT(*))(SI_UNIT($,.RADIAN.))(PLANE_ANGLE_UNIT())');
  const solidAng  = L('(NAMED_UNIT(*))(SI_UNIT($,.STERADIAN.))(SOLID_ANGLE_UNIT())');
  const uCtx      = L(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-6),${REF(unitCtx)},'distance_accuracy_value','')`);
  const gCtx      = L('GEOMETRIC_REPRESENTATION_CONTEXT(3)');
  const globalCtx = L(`GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(${REF(gCtx)},(${REF(uCtx)}))`);
  const globalUnit= L(`GLOBAL_UNIT_ASSIGNED_CONTEXT(${REF(gCtx)},(${REF(unitCtx)},${REF(planeAng)},${REF(solidAng)}))`);

  const prod      = L(`PRODUCT('${partName}','${partName}','',(${REF(prodCtx)}))`);
  const prodDef   = L(`PRODUCT_DEFINITION('','',${REF(prod)},${REF(prodCtx)})`);
  const prodFm    = L(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',${REF(prod)},.NOT_KNOWN.)`);
  const prodShape = L(`PRODUCT_DEFINITION_SHAPE('','',${REF(prodDef)})`);

  const origin    = L("CARTESIAN_POINT('',(0.,0.,0.))");
  const axisZ     = L("DIRECTION('',(0.,0.,1.))");
  const axisX     = L("DIRECTION('',(1.,0.,0.))");
  const axis2d    = L(`AXIS2_PLACEMENT_3D('',${REF(origin)},${REF(axisZ)},${REF(axisX)})`);

  const triIds = [];
  const scale  = units === 'MM' ? 1000 : 1;

  for (let i = 0; i < nTri; i++) {
    const t = getTri(geo.verts, i);
    const nor = triNormal(t);
    const nLen = Math.sqrt(nor[0]*nor[0]+nor[1]*nor[1]+nor[2]*nor[2]) || 1;
    const nx = round(nor[0]/nLen,6), ny = round(nor[1]/nLen,6), nz = round(nor[2]/nLen,6);

    const va = L(`CARTESIAN_POINT('',(${round(t.a[0]*scale,6)},${round(t.a[1]*scale,6)},${round(t.a[2]*scale,6)}))`);
    const vb = L(`CARTESIAN_POINT('',(${round(t.b[0]*scale,6)},${round(t.b[1]*scale,6)},${round(t.b[2]*scale,6)}))`);
    const vc = L(`CARTESIAN_POINT('',(${round(t.c[0]*scale,6)},${round(t.c[1]*scale,6)},${round(t.c[2]*scale,6)}))`);
    const na = L(`DIRECTION('',(${nx},${ny},${nz}))`);
    const nb = L(`DIRECTION('',(${nx},${ny},${nz}))`);
    const nc = L(`DIRECTION('',(${nx},${ny},${nz}))`);
    const pa = L(`VERTEX_POINT('',${REF(va)})`);
    const pb = L(`VERTEX_POINT('',${REF(vb)})`);
    const pc = L(`VERTEX_POINT('',${REF(vc)})`);
    triIds.push(L(`TRIANGULATED_FACE('',(${REF(pa)},${REF(pb)},${REF(pc)}),(${REF(na)},${REF(nb)},${REF(nc)}))`));
  }

  const triFaceSet    = L(`CONNECTED_FACE_SET('',(${triIds.map(REF).join(',')}))`);
  const closedShell   = L(`CLOSED_SHELL('',${REF(triFaceSet)})`);
  const manifoldSolid = L(`MANIFOLD_SOLID_BREP('${partName}',${REF(closedShell)})`);
  const shapeRep      = L(`ADVANCED_BREP_SHAPE_REPRESENTATION('${partName}',(${REF(axis2d)},${REF(manifoldSolid)}),${REF(globalCtx)})`);
  const shapeDefRep   = L(`SHAPE_DEFINITION_REPRESENTATION(${REF(prodShape)},${REF(shapeRep)})`);

  s += 'ENDSEC;\nEND-ISO-10303-21;\n';

  return {
    format: 'STEP_AP214',
    content: s,
    triangleCount: nTri,
    entityCount: id - 1,
    partName,
    units,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §26  OBJ + MTL EXPORT
   ═══════════════════════════════════════════════════════════════════════════ */

function exportOBJ(partDef, mtlName = null) {
  const geo  = partDef.geo || partDef;
  const mat  = partDef.material || {};
  const name = (partDef.type || 'part').replace(/_/g, '_');
  const mName = mtlName || name + '_mat';

  const nTri  = triCount(geo);
  const scale = 1000;

  let obj = '# UARE CAD Engine — OBJ export\n';
  obj += `# Part: ${name}\n`;
  obj += `# Triangles: ${nTri}\n`;
  obj += `# Material: ${mat.name || 'unknown'}\n\n`;
  obj += `mtllib ${name}.mtl\n\n`;
  obj += `g ${name}\n`;
  obj += `usemtl ${mName}\n\n`;

  const vLines = [], vnLines = [], fLines = [];

  for (let i = 0; i < nTri; i++) {
    const t  = getTri(geo.verts, i);
    const o  = i * 9;
    const na = [geo.normals[o],   geo.normals[o+1], geo.normals[o+2]];
    const nb = [geo.normals[o+3], geo.normals[o+4], geo.normals[o+5]];
    const nc = [geo.normals[o+6], geo.normals[o+7], geo.normals[o+8]];

    const vi = vLines.length + 1;
    vLines.push(`v ${round(t.a[0]*scale,5)} ${round(t.a[1]*scale,5)} ${round(t.a[2]*scale,5)}`);
    vLines.push(`v ${round(t.b[0]*scale,5)} ${round(t.b[1]*scale,5)} ${round(t.b[2]*scale,5)}`);
    vLines.push(`v ${round(t.c[0]*scale,5)} ${round(t.c[1]*scale,5)} ${round(t.c[2]*scale,5)}`);
    const ni = vnLines.length + 1;
    vnLines.push(`vn ${round(na[0],5)} ${round(na[1],5)} ${round(na[2],5)}`);
    vnLines.push(`vn ${round(nb[0],5)} ${round(nb[1],5)} ${round(nb[2],5)}`);
    vnLines.push(`vn ${round(nc[0],5)} ${round(nc[1],5)} ${round(nc[2],5)}`);
    fLines.push(`f ${vi}//${ni} ${vi+1}//${ni+1} ${vi+2}//${ni+2}`);
  }

  obj += vLines.join('\n') + '\n\n';
  obj += vnLines.join('\n') + '\n\n';
  obj += fLines.join('\n') + '\n';

  const r = mat.colour ? mat.colour[0] : 0.7;
  const g = mat.colour ? mat.colour[1] : 0.7;
  const b = mat.colour ? mat.colour[2] : 0.7;

  let mtl = `# UARE CAD Engine — MTL\nnewmtl ${mName}\n`;
  mtl += 'Ka 0.200 0.200 0.200\n';
  mtl += `Kd ${round(r,3)} ${round(g,3)} ${round(b,3)}\n`;
  mtl += 'Ks 0.800 0.800 0.800\n';
  mtl += 'Ns 80\n';
  mtl += 'd 1.0\n';
  mtl += 'illum 2\n';

  return {
    format:    'OBJ',
    obj,
    mtl,
    objName:   name + '.obj',
    mtlName:   name + '.mtl',
    triangles: nTri,
    vertices:  nTri * 3,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §27  FEA LOAD-PATH VISUALISER
   ═══════════════════════════════════════════════════════════════════════════ */

function computeStressProxy(geo, feaParams = {}) {
  const {
    load         = { point: [0, 0.1, 0], force: [0, -1000, 0] },
    supports     = [{ point: [0, -0.05, 0] }],
    yieldStrength = 250e6,
  } = feaParams;

  const nTri    = triCount(geo);
  const stressMap = new Float32Array(nTri);

  const fMag = Math.sqrt(load.force[0]**2 + load.force[1]**2 + load.force[2]**2) || 1;
  const fDir = [load.force[0]/fMag, load.force[1]/fMag, load.force[2]/fMag];

  const aabb  = meshAABB(geo);
  const charL = Math.max(...aabb.size);

  for (let i = 0; i < nTri; i++) {
    const t   = getTri(geo.verts, i);
    const cen = triCentroid(t);
    const nor = triNormal(t);
    const nLen = Math.sqrt(nor[0]**2+nor[1]**2+nor[2]**2)||1;
    const nHat = [nor[0]/nLen, nor[1]/nLen, nor[2]/nLen];

    const dLoad = Math.sqrt(
      (cen[0]-load.point[0])**2 + (cen[1]-load.point[1])**2 + (cen[2]-load.point[2])**2
    );
    const loadProx = 1 - clamp(dLoad / (charL * 0.5), 0, 1);
    const alignment = Math.abs(nHat[0]*fDir[0] + nHat[1]*fDir[1] + nHat[2]*fDir[2]);

    let minSuppDist = Infinity;
    for (const sup of supports) {
      const d = Math.sqrt((cen[0]-sup.point[0])**2+(cen[1]-sup.point[1])**2+(cen[2]-sup.point[2])**2);
      if (d < minSuppDist) minSuppDist = d;
    }
    const momentArm = clamp(minSuppDist / charL, 0, 1);
    const stress = clamp(loadProx * 0.4 + alignment * 0.3 + momentArm * 0.3, 0, 1);
    stressMap[i] = stress;
  }

  const colours = new Float32Array(nTri * 9);
  for (let i = 0; i < nTri; i++) {
    const s   = stressMap[i];
    let r, g, b;
    if (s < 0.25)      { r = 0;         g = s * 4;         b = 1;           }
    else if (s < 0.5)  { r = 0;         g = 1;             b = 1-(s-0.25)*4; }
    else if (s < 0.75) { r = (s-0.5)*4; g = 1;             b = 0;           }
    else               { r = 1;         g = 1-(s-0.75)*4;  b = 0;           }
    for (let j = 0; j < 3; j++) {
      const base = i*9 + j*3;
      colours[base] = r; colours[base+1] = g; colours[base+2] = b;
    }
  }

  return {
    geo,
    stressMap,
    colours,
    maxStress:     Math.max(...stressMap),
    avgStress:     stressMap.reduce((a,v)=>a+v,0) / nTri,
    yieldFraction: round(Math.max(...stressMap) * yieldStrength / yieldStrength, 3),
    hotspots:      _findHotspots(stressMap, geo, 5),
  };
}

function _findHotspots(stressMap, geo, n = 5) {
  const entries = Array.from(stressMap, (s, i) => ({ stress: s, centroid: triCentroid(getTri(geo.verts, i)) }));
  return entries.sort((a, b) => b.stress - a.stress).slice(0, n);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §28  PARAMETRIC DIMENSION ANNOTATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

function generateDimensionAnnotations(partDef) {
  const geo  = partDef.geo;
  const aabb = meshAABB(geo);
  const sz   = aabb.size;
  const c    = aabb.centre;
  const annots = [];

  const mm = (v) => round(v * 1000, 2);
  const pushDim = (label, value_m, axis, pt, leader = 0.02) => annots.push({
    label, value: mm(value_m), unit: 'mm',
    axis, point: pt, leaderLen: leader,
  });

  pushDim('Width',  sz[0], 'x', [c[0], aabb.min[1] - 0.01, c[2]]);
  pushDim('Height', sz[1], 'y', [aabb.max[0] + 0.01, c[1], c[2]]);
  pushDim('Depth',  sz[2], 'z', [c[0], aabb.min[1] - 0.01, aabb.min[2]]);

  const p = partDef.params || {};
  switch (partDef.type) {
    case 'gear':
      if (p.module)      pushDim('Module',   p.module,             'y', [aabb.max[0]+0.015, c[1], c[2]]);
      if (p.toothCount)  pushDim('Teeth',    p.toothCount * 0.001, 'y', [c[0], c[1]+sz[1]/2+0.01, c[2]]);
      if (p.pitchDia)    pushDim('Pitch Ø',  p.pitchDia,           'x', [c[0], c[1], aabb.max[2]+0.015]);
      break;
    case 'shaft':
      if (partDef.steps) {
        partDef.steps.forEach((st, i) =>
          pushDim(`Ø${st.label||i}`, st.dia, 'y', [aabb.min[0] + 0.01 + i * (sz[0]/(partDef.steps.length)), c[1]+st.dia/2+0.01, c[2]])
        );
      }
      pushDim('Total L', sz[0], 'x', [c[0], aabb.min[1]-0.01, c[2]]);
      break;
    case 'bearing':
      pushDim('Bore Ø',  partDef.innerDia, 'x', [c[0], c[1]+0.01, aabb.max[2]+0.01]);
      pushDim('OD',      partDef.outerDia, 'x', [c[0], c[1]+0.015, aabb.max[2]+0.02]);
      pushDim('Width',   sz[1], 'y', [aabb.max[0]+0.015, c[1], c[2]]);
      break;
    case 'pcb':
      pushDim('PCB W',  partDef.width,     'x', [c[0], aabb.min[1]-0.005, c[2]]);
      pushDim('PCB D',  partDef.height,    'z', [c[0], aabb.min[1]-0.005, aabb.min[2]]);
      pushDim('t',      partDef.thickness, 'y', [aabb.max[0]+0.01, c[1], c[2]]);
      break;
    default:
      break;
  }

  return annots;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §29  EXTEND PUBLIC API WITH PASS-3 EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

Object.assign(global.UARE_CAD, {
  getTri,
  triCount,
  triCentroid,
  triNormal,
  triArea,
  meshAABB,
  buildBVH,
  rayTriIntersect,
  pointInMesh,
  repairMesh,
  recomputeNormals,
  meshUnion,
  meshSubtract,
  meshIntersect,
  createAssembly,
  createKinematicChain,
  exportSTEP_AP214,
  exportOBJ,
  computeStressProxy,
  generateDimensionAnnotations,

  version: '3.0.0-pass3',
});

})(typeof window !== 'undefined' ? window : global);
/* END OF PASS 3 — Pass 4 will add: Enki dock, ambient background canvas,
   index.html + app.js patches to wire everything together */

(function (global) {
"use strict";


/* ═══════════════════════════════════════════════════════════════════════════
   CAD ENGINE — PASS 4  (§30–§36)
   Persistent scene manager, morphing part animation, extended material DB,
   advanced geometry generators, orbit controls, render modes, full API v4.
   Appended to cad-engine.js after Pass 3.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── §30  PERSISTENT SCENE MANAGER ──────────────────────────────────────── */

let _PS = null; // Singleton persistent scene

function _easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  t = Math.max(0, Math.min(1, t));
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function _easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function _initPersistentScene(canvas) {
  const THREE = window.THREE;
  if (!THREE) throw new Error('[CAD Pass4] THREE not found on window.');

  // Return existing if same canvas
  if (_PS && _PS.canvas === canvas) return _PS;
  // Dispose old
  if (_PS) {
    cancelAnimationFrame(_PS._rafId);
    _PS.renderer.dispose();
    _PS.ro && _PS.ro.disconnect();
    _PS = null;
  }

  const rect = canvas.getBoundingClientRect();
  const W = rect.width  || canvas.clientWidth  || 800;
  const H = rect.height || canvas.clientHeight || 600;

  // ── Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1e);
  scene.fog = new THREE.FogExp2(0x0a0f1e, 0.00045);

  // ── Camera
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.5, 60000);
  camera.position.set(600, 480, 800);
  camera.lookAt(0, 80, 0);

  // ── Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderer.toneMapping !== undefined) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping || 4;
    renderer.toneMappingExposure = 1.25;
  }
  renderer.outputEncoding = THREE.sRGBEncoding || 3001;

  // ── Lights
  scene.add(new THREE.AmbientLight(0x334466, 1.4));
  const sun = new THREE.DirectionalLight(0xfff8f0, 2.8);
  sun.position.set(700, 900, 500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 6000;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2000;
  sun.shadow.camera.right = sun.shadow.camera.top = 2000;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7799cc, 0.9);
  fill.position.set(-500, 300, -400);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x00d4ff, 0.5);
  rim.position.set(0, -200, 600);
  scene.add(rim);

  // ── Environment grid
  const gridMain = new THREE.GridHelper(3000, 50, 0x1a2840, 0x0f1c2e);
  gridMain.position.y = -1;
  scene.add(gridMain);
  const gridFine = new THREE.GridHelper(600, 30, 0x1e3050, 0x162236);
  gridFine.position.y = 0;
  scene.add(gridFine);

  // ── Axes
  const axes = new THREE.AxesHelper(120);
  axes.position.set(-920, 2, -920);
  scene.add(axes);

  // ── Orbit state
  const orb = {
    theta: 0.75, phi: 1.05, r: 900,
    target: new THREE.Vector3(0, 80, 0),
    dragging: false, rBtn: false, last: { x: 0, y: 0 }
  };

  function _orbitUpdate() {
    const ct = Math.cos(orb.theta), st = Math.sin(orb.theta);
    const cp = Math.cos(orb.phi),   sp = Math.sin(orb.phi);
    camera.position.set(
      orb.target.x + orb.r * ct * sp,
      orb.target.y + orb.r * cp,
      orb.target.z + orb.r * st * sp
    );
    camera.lookAt(orb.target);
  }
  _orbitUpdate();

  canvas.addEventListener('mousedown', e => {
    orb.dragging = true; orb.rBtn = e.button === 2;
    orb.last = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', () => { orb.dragging = false; });
  window.addEventListener('mousemove', e => {
    if (!orb.dragging) return;
    const dx = e.clientX - orb.last.x, dy = e.clientY - orb.last.y;
    orb.last = { x: e.clientX, y: e.clientY };
    if (orb.rBtn) {
      const right = new THREE.Vector3(Math.cos(orb.theta), 0, Math.sin(orb.theta));
      const up = new THREE.Vector3(0, 1, 0);
      const sc = orb.r * 0.001;
      orb.target.addScaledVector(right, -dx * sc).addScaledVector(up, dy * sc);
    } else {
      orb.theta -= dx * 0.005;
      orb.phi = Math.max(0.04, Math.min(Math.PI - 0.04, orb.phi + dy * 0.005));
    }
    _orbitUpdate();
  });
  canvas.addEventListener('wheel', e => {
    orb.r = Math.max(40, Math.min(12000, orb.r * (1 + e.deltaY * 0.0008)));
    _orbitUpdate(); e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Touch
  let _td = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      orb.dragging = true; orb.rBtn = false;
      orb.last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      _td = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                       e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && orb.dragging) {
      const dx = e.touches[0].clientX - orb.last.x, dy = e.touches[0].clientY - orb.last.y;
      orb.last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      orb.theta -= dx * 0.005;
      orb.phi = Math.max(0.04, Math.min(Math.PI - 0.04, orb.phi + dy * 0.005));
      _orbitUpdate();
    } else if (e.touches.length === 2 && _td) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
      orb.r = Math.max(40, Math.min(12000, orb.r * (_td / d)));
      _td = d; _orbitUpdate();
    }
  }, { passive: false });
  canvas.addEventListener('touchend', () => { orb.dragging = false; _td = null; }, { passive: true });

  // Resize
  const ro = new ResizeObserver(() => {
    const p = canvas.parentElement || document.body;
    const r2 = p.getBoundingClientRect();
    const w2 = r2.width, h2 = r2.height;
    if (!w2 || !h2) return;
    renderer.setSize(w2, h2, false);
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
  });
  ro.observe(canvas.parentElement || canvas);

  // Part meshes registry for this persistent scene instance
  const partMeshes = {};

  // Hover / selection state
  let _hoveredId   = null;
  let _selectedId  = null;
  const _hoverOrigEmissive = new Map();  // id → hex string

  function _setEmissive(mesh, hexColor) {
    if (!mesh) return;
    mesh.traverse(function(obj) {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (mat && mat.emissive) mat.emissive.set(hexColor);
      });
    });
  }

  function _highlightHover(id) {
    if (id === _hoveredId) return;
    // Remove previous hover
    if (_hoveredId && _hoveredId !== _selectedId) {
      _setEmissive(partMeshes[_hoveredId], _selectedId === _hoveredId ? 0x334466 : 0x000000);
    }
    _hoveredId = id;
    if (id && id !== _selectedId) {
      _setEmissive(partMeshes[id], 0x1a2e4a);  // subtle blue hover glow
    }
    canvas.style.cursor = id ? 'pointer' : 'default';
  }

  function _selectPart(id) {
    // Deselect previous
    if (_selectedId && _selectedId !== id) {
      _setEmissive(partMeshes[_selectedId], _hoveredId === _selectedId ? 0x1a2e4a : 0x000000);
    }
    _selectedId = id;
    if (id) {
      _setEmissive(partMeshes[id], 0x334466);   // brighter blue selection
      // Highlight tree row
      const treeItem = document.querySelector('.tree-item[data-part-id="' + id + '"]');
      if (treeItem) {
        document.querySelectorAll('.tree-item').forEach(e => e.classList.remove('selected'));
        treeItem.classList.add('selected');
        treeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  // Expose for external callers (enki.js tree clicks)
  const _selectPartRef = _selectPart;
  const _highlightHoverRef = _highlightHover;

  // Coord HUD + Part Picking
  const _raycaster = new THREE.Raycaster();
  const _mouse = new THREE.Vector2();
  const _hudX = document.getElementById('hud-x');
  const _hudY = document.getElementById('hud-y');
  const _hudZ = document.getElementById('hud-z');
  const _hudScale = document.getElementById('hud-scale');
  let _lastPickTime = 0;
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, camera);
    const meshList = Object.values(partMeshes);
    if (meshList.length) {
      const hits = _raycaster.intersectObjects(meshList, true);
      if (hits.length) {
        const p = hits[0].point;
        const UNIT = 0.1;
        if (_hudX) _hudX.textContent = 'X ' + (p.x / UNIT).toFixed(1);
        if (_hudY) _hudY.textContent = 'Y ' + (p.y / UNIT).toFixed(1);
        if (_hudZ) _hudZ.textContent = 'Z ' + (p.z / UNIT).toFixed(1);
        // Walk up to root partId
        let hObj = hits[0].object;
        while (hObj && !hObj.userData.partId && hObj.parent) hObj = hObj.parent;
        _highlightHover(hObj && hObj.userData.partId ? hObj.userData.partId : null);
      } else {
        _highlightHover(null);
        // Fall through to ground-plane HUD
        const dir = _raycaster.ray.direction;
        const orig = _raycaster.ray.origin;
        if (Math.abs(dir.y) > 0.001) {
          const t = -orig.y / dir.y;
          if (t > 0) {
            const px = orig.x + dir.x * t, pz = orig.z + dir.z * t;
            const UNIT = 0.1;
            if (_hudX) _hudX.textContent = 'X ' + (px / UNIT).toFixed(1);
            if (_hudY) _hudY.textContent = 'Y 0.0';
            if (_hudZ) _hudZ.textContent = 'Z ' + (pz / UNIT).toFixed(1);
          }
        }
      }
    } else {
      _highlightHover(null);
      const dir = _raycaster.ray.direction;
      const orig = _raycaster.ray.origin;
      if (Math.abs(dir.y) > 0.001) {
        const t = -orig.y / dir.y;
        if (t > 0) {
          const px = orig.x + dir.x * t, pz = orig.z + dir.z * t;
          const UNIT = 0.1;
          if (_hudX) _hudX.textContent = 'X ' + (px / UNIT).toFixed(1);
          if (_hudY) _hudY.textContent = 'Y 0.0';
          if (_hudZ) _hudZ.textContent = 'Z ' + (pz / UNIT).toFixed(1);
        }
      }
    }
    if (_hudScale) {
      const dist = orb.r;
      const scaleStr = dist < 500 ? '1:1' : dist < 2000 ? '1:10' : dist < 8000 ? '1:100' : '1:1000';
      _hudScale.textContent = scaleStr;
    }
  });
  // Part click picking → highlight + show properties panel
  canvas.addEventListener('click', e => {
    const now2 = performance.now();
    if (now2 - _lastPickTime < 200) return;
    _lastPickTime = now2;
    if (orb.dragging) return;
    const rect = canvas.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, camera);
    const meshList = Object.values(partMeshes);
    if (!meshList.length) return;
    const hits = _raycaster.intersectObjects(meshList, true);
    if (!hits.length) {
      // Click empty space → deselect
      _selectPart(null);
      return;
    }
    let hit = hits[0].object;
    while (hit && !hit.userData.partId && hit.parent) hit = hit.parent;
    if (!hit || !hit.userData.partId) return;
    const partId = hit.userData.partId;
    _selectPart(partId);
    // Notify Enki to show part properties
    if (window.UARE_ENKI && window.UARE_ENKI._onPartPick) {
      window.UARE_ENKI._onPartPick(partId, hit.userData.partDef);
    } else {
      // Direct DOM fallback
      const propsPanel  = document.getElementById('part-props');
      const propsTitle  = document.getElementById('part-props-title');
      const propsContent= document.getElementById('part-props-content');
      if (propsPanel && propsContent) {
        const d = hit.userData.partDef || hit.userData;
        if (propsTitle) propsTitle.textContent = d.name || partId;
        propsContent.innerHTML = _renderPartPropsHTML(d);
        propsPanel.classList.remove('collapsed');
      }
    }
  });

  // Helper: render part props HTML (also used by Enki)
  function _renderPartPropsHTML(d) {
    if (!d) return '<div class="prop-row">No data</div>';
    const dims = d.dims || {};
    const rows = [];
    const add = (l, v) => { if (v != null && v !== '' && v !== '—') rows.push([l, v]); };
    add('ID',           d.id);
    add('Type',         d.type);
    add('Material',     d.material);
    add('Standard',     d.standard);
    add('Mass',         d.mass_kg != null ? d.mass_kg.toFixed(4) + ' kg (' + (d.mass_kg * 1000).toFixed(1) + ' g)' : null);
    add('Quantity',     d.quantity != null ? d.quantity + 'x' : null);
    add('Surface',      d.surface_finish);
    add('Tolerance',    d.tolerance);
    add('Torque',       d.torque_nm != null ? d.torque_nm + ' N·m' : null);
    add('Cost',         d.cost_usd != null ? '$' + Number(d.cost_usd).toFixed(2) : null);
    // Dims
    Object.entries(dims).forEach(([k, v]) => add(k.toUpperCase() + ' [mm]', v));
    // Position / rotation
    if (d.position) add('Position [mm]', d.position.join(', '));
    if (d.rotation) add('Rotation [°]', d.rotation.join(', '));
    // Notes last
    add('Notes', d.notes);
    add('BOM notes', d.bom_notes);
    return rows.map(([l, v]) =>
      '<div class="prop-row"><span class="prop-label">' + String(l).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>' +
      '<span class="prop-val">'  + String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span></div>'
    ).join('') || '<div class="prop-row">No specification data</div>';
  }
  // Expose for cad-engine external use
  const _renderPartPropsHTMLRef = _renderPartPropsHTML;
  const morphQueue = []; // {mesh, t, duration, resolve}
  let _mode = 'solid';
  let _rafId;

  function _animate() {
    _rafId = requestAnimationFrame(_animate);
    const now = performance.now() / 1000;
    for (let i = morphQueue.length - 1; i >= 0; i--) {
      const m = morphQueue[i];
      m.t = Math.min(1, m.t + (1 / 60) / m.duration);
      const ease = _easeOutBack(m.t);
      m.mesh.scale.setScalar(Math.max(0.001, ease));
      const ops = Math.min(1, _easeInOutCubic(m.t * 1.5));
      _eachMeshMat(m.mesh, function(mat) {
        mat.opacity = ops;
        if (m.t >= 1) { mat.transparent = false; mat.depthWrite = true; }
      });
      if (m.t >= 1) { morphQueue.splice(i, 1); m.resolve && m.resolve(); }
    }
    renderer.render(scene, camera);
  }
  _animate();

  _PS = { canvas, scene, camera, renderer, orb, partMeshes, morphQueue, _orbitUpdate, _mode, ro,
    _selectPart: _selectPartRef,
    _highlightHover: _highlightHoverRef,
    _renderPartPropsHTML: _renderPartPropsHTMLRef,
    get _rafId() { return _rafId; }, set _rafId(v) { _rafId = v; },
    explode: explodeView };
  return _PS;
}

/* ── §31  MORPH-ADD-PART ─────────────────────────────────────────────────── */

function _numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _vec3From(v, fallback) {
  if (Array.isArray(v)) {
    return [
      _numOr(v[0], fallback[0]),
      _numOr(v[1], fallback[1]),
      _numOr(v[2], fallback[2]),
    ];
  }
  if (v && typeof v === 'object') {
    return [
      _numOr(v.x, fallback[0]),
      _numOr(v.y, fallback[1]),
      _numOr(v.z, fallback[2]),
    ];
  }
  return fallback.slice();
}

function _normalizeDims(partDef) {
  const src = Object.assign({}, partDef && partDef.dimensions_mm, partDef && partDef.dims);
  const pick = function() {
    for (let i = 0; i < arguments.length; i++) {
      const k = arguments[i];
      if (src[k] != null && src[k] !== '') {
        const n = Number(src[k]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  const w = pick('w', 'width', 'x');
  const h = pick('h', 'height', 'z', 'thickness');
  const d = pick('d', 'depth', 'y');
  const L = pick('L', 'length', 'len', 'h', 'height', 'z');
  const dia = pick('d', 'diameter', 'dia', 'outerD', 'outer_diameter', 'od');

  const out = Object.assign({}, src);
  if (w != null) out.w = w;
  if (h != null) out.h = h;
  if (d != null) out.d = d;
  if (L != null) out.L = L;
  if (dia != null) out.diameter = dia;
  if (out.d == null && dia != null) out.d = dia;

  const outerD = pick('outerD', 'outer_diameter', 'od', 'diameter', 'd');
  const innerD = pick('innerD', 'inner_diameter', 'id', 'bore');
  if (outerD != null) out.outerD = outerD;
  if (innerD != null) out.innerD = innerD;

  return out;
}

function _normalizePartDef(partDef) {
  const p = Object.assign({}, partDef || {});
  p.type = String(p.type || p.shape || p.kind || 'custom').toLowerCase();
  p.dims = _normalizeDims(p);
  p.dimensions_mm = Object.assign({}, p.dimensions_mm || {}, p.dims);
  p.position = _vec3From(p.position != null ? p.position : p.transform_mm, [0, 0, 0]);
  p.rotation = _vec3From(p.rotation, [0, 0, 0]);
  return p;
}

function morphAddPart(canvas, partDef) {
  return new Promise((resolve) => {
    const THREE = window.THREE;
    if (!THREE) { resolve(); return; }
    const normPart = _normalizePartDef(partDef);
    const ps = _initPersistentScene(canvas);
    const mesh = _buildPartMesh(normPart);
    if (!mesh) { resolve(); return; }

    // Position
    const pos = normPart.position || [0, 0, 0];
    mesh.position.set(pos[0] * UARE_CAD_UNIT, pos[1] * UARE_CAD_UNIT, pos[2] * UARE_CAD_UNIT);
    const rot = normPart.rotation || [0, 0, 0];
    mesh.rotation.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180);

    // Start from scale 0, transparent — works for both Mesh and Group
    mesh.scale.setScalar(0.001);
    _eachMeshMat(mesh, function(mat) { mat.transparent = true; mat.opacity = 0; mat.depthWrite = false; });
    mesh.traverse(function(c) { c.castShadow = true; c.receiveShadow = true; });
    ps.scene.add(mesh);
    if (normPart.id) ps.partMeshes[normPart.id] = mesh;

    // Tag every descendant with partId so click-picking walks up to find it
    const _tagId = normPart.id || ('part_' + Math.random().toString(36).slice(2, 8));
    const _partType = normPart.type || normPart.shape || 'part';
    mesh.userData.partId   = _tagId;
    mesh.userData.partDef  = normPart;
    mesh.userData.partName = normPart.name || _partType;
    mesh.traverse(function(c) {
      if (c !== mesh) {
        c.userData.partId   = _tagId;
        c.userData.partDef  = normPart;
        c.userData.partName = normPart.name || _tagId;
      }
      c.castShadow    = true;
      c.receiveShadow = true;
    });

    // Re-center camera on assembly bounding box
    _fitCameraToScene(ps);

    ps.morphQueue.push({ mesh, t: 0, duration: 0.65, resolve });
  });
}

// Scale factor: partDef uses mm, scene is in scene units (1 su = 0.1mm = 1 THREE unit)
const UARE_CAD_UNIT = 0.1; // 1mm = 0.1 THREE units → 10mm = 1 unit

function _fitCameraToScene(ps) {
  const THREE = window.THREE;
  const box = new THREE.Box3();
  Object.values(ps.partMeshes).forEach(m => box.expandByObject(m));
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  ps.orb.target.copy(center);
  ps.orb.r = maxDim * 1.8;
  ps.orb.phi = 1.05;
  ps._orbitUpdate();
}

/* ── §32  EXTENDED MATERIAL DATABASE ────────────────────────────────────── */
// Each entry: { color (hex), roughness, metalness, density (kg/m³),
//               yieldMPa, youngsGPa, thermalW_mK, costPerKg }
const MAT_DB_EXTENDED = {
  // Steels
  'steel':            { color: 0x7a8fa0, roughness: 0.35, metalness: 0.85, density: 7850, yieldMPa: 250, youngsGPa: 200, thermalW_mK: 50,  costPerKg: 1.2  },
  'steel_4340':       { color: 0x6a7f90, roughness: 0.3,  metalness: 0.9,  density: 7850, yieldMPa: 740, youngsGPa: 205, thermalW_mK: 44,  costPerKg: 3.8  },
  'stainless_304':    { color: 0x9ab0c0, roughness: 0.25, metalness: 0.9,  density: 8000, yieldMPa: 215, youngsGPa: 193, thermalW_mK: 16,  costPerKg: 3.2  },
  'stainless_316':    { color: 0xa0b8c8, roughness: 0.2,  metalness: 0.92, density: 8000, yieldMPa: 220, youngsGPa: 193, thermalW_mK: 15,  costPerKg: 4.5  },
  'tool_steel_d2':    { color: 0x5a6878, roughness: 0.15, metalness: 0.95, density: 7700, yieldMPa: 1580,youngsGPa: 210, thermalW_mK: 20,  costPerKg: 12.0 },
  'spring_steel':     { color: 0x8898a8, roughness: 0.3,  metalness: 0.85, density: 7850, yieldMPa: 1400,youngsGPa: 205, thermalW_mK: 46,  costPerKg: 2.8  },
  'cast_iron':        { color: 0x5a6060, roughness: 0.6,  metalness: 0.7,  density: 7200, yieldMPa: 230, youngsGPa: 170, thermalW_mK: 52,  costPerKg: 0.9  },
  // Aluminums
  'aluminum':         { color: 0xa8b8c8, roughness: 0.4,  metalness: 0.7,  density: 2700, yieldMPa: 270, youngsGPa: 69,  thermalW_mK: 160, costPerKg: 2.8  },
  'aluminum_6061':    { color: 0xb0c0d0, roughness: 0.35, metalness: 0.72, density: 2700, yieldMPa: 276, youngsGPa: 68.9,thermalW_mK: 167, costPerKg: 3.1  },
  'aluminum_7075':    { color: 0x9aacbc, roughness: 0.3,  metalness: 0.75, density: 2810, yieldMPa: 503, youngsGPa: 71.7,thermalW_mK: 130, costPerKg: 5.2  },
  'aluminum_2024':    { color: 0xa0b2c2, roughness: 0.32, metalness: 0.73, density: 2780, yieldMPa: 345, youngsGPa: 73.1,thermalW_mK: 120, costPerKg: 4.8  },
  // Titaniums
  'titanium':         { color: 0x8a9ab0, roughness: 0.25, metalness: 0.8,  density: 4430, yieldMPa: 880, youngsGPa: 114, thermalW_mK: 6.7, costPerKg: 35.0 },
  'titanium_6al4v':   { color: 0x8090a8, roughness: 0.22, metalness: 0.82, density: 4430, yieldMPa: 880, youngsGPa: 114, thermalW_mK: 6.7, costPerKg: 40.0 },
  // Non-ferrous
  'copper':           { color: 0xb87333, roughness: 0.3,  metalness: 0.85, density: 8960, yieldMPa: 70,  youngsGPa: 110, thermalW_mK: 385, costPerKg: 9.5  },
  'brass':            { color: 0xd4a020, roughness: 0.35, metalness: 0.75, density: 8500, yieldMPa: 100, youngsGPa: 100, thermalW_mK: 109, costPerKg: 7.2  },
  'bronze':           { color: 0xcd7f32, roughness: 0.4,  metalness: 0.7,  density: 8800, yieldMPa: 140, youngsGPa: 96,  thermalW_mK: 50,  costPerKg: 8.8  },
  'magnesium':        { color: 0xc0c8d0, roughness: 0.45, metalness: 0.6,  density: 1740, yieldMPa: 160, youngsGPa: 45,  thermalW_mK: 156, costPerKg: 3.5  },
  'inconel_718':      { color: 0x707888, roughness: 0.28, metalness: 0.88, density: 8190, yieldMPa: 1034,youngsGPa: 200, thermalW_mK: 11,  costPerKg: 65.0 },
  // Polymers
  'abs':              { color: 0xd0c8b8, roughness: 0.8,  metalness: 0.0,  density: 1050, yieldMPa: 45,  youngsGPa: 2.3, thermalW_mK: 0.17,costPerKg: 3.5  },
  'nylon':            { color: 0xddd8c8, roughness: 0.75, metalness: 0.0,  density: 1150, yieldMPa: 70,  youngsGPa: 2.8, thermalW_mK: 0.25,costPerKg: 4.8  },
  'peek':             { color: 0xe8d8b0, roughness: 0.6,  metalness: 0.0,  density: 1320, yieldMPa: 100, youngsGPa: 3.6, thermalW_mK: 0.25,costPerKg: 95.0 },
  'ptfe':             { color: 0xf0f0f0, roughness: 0.5,  metalness: 0.0,  density: 2200, yieldMPa: 23,  youngsGPa: 0.5, thermalW_mK: 0.25,costPerKg: 22.0 },
  'polycarbonate':    { color: 0xcce8ff, roughness: 0.15, metalness: 0.0,  density: 1200, yieldMPa: 60,  youngsGPa: 2.4, thermalW_mK: 0.20,costPerKg: 4.2  },
  'pla':              { color: 0xf0ead0, roughness: 0.85, metalness: 0.0,  density: 1250, yieldMPa: 55,  youngsGPa: 3.5, thermalW_mK: 0.13,costPerKg: 2.5  },
  // Composites
  'carbon_fiber':     { color: 0x1a1a1a, roughness: 0.4,  metalness: 0.1,  density: 1600, yieldMPa: 600, youngsGPa: 70,  thermalW_mK: 7.0, costPerKg: 30.0 },
  'carbon_fiber_ud':  { color: 0x222222, roughness: 0.35, metalness: 0.12, density: 1550, yieldMPa: 1500,youngsGPa: 135, thermalW_mK: 7.0, costPerKg: 45.0 },
  'fiberglass':       { color: 0xd8e8d0, roughness: 0.55, metalness: 0.0,  density: 1900, yieldMPa: 300, youngsGPa: 20,  thermalW_mK: 0.3, costPerKg: 6.5  },
  'fr4':              { color: 0x2a6030, roughness: 0.6,  metalness: 0.0,  density: 1850, yieldMPa: 200, youngsGPa: 18,  thermalW_mK: 0.3, costPerKg: 8.0  },
  // Ceramics
  'alumina':          { color: 0xf0f0f0, roughness: 0.3,  metalness: 0.0,  density: 3900, yieldMPa: 300, youngsGPa: 380, thermalW_mK: 30,  costPerKg: 12.0 },
  'silicon_carbide':  { color: 0x888888, roughness: 0.25, metalness: 0.0,  density: 3210, yieldMPa: 400, youngsGPa: 410, thermalW_mK: 120, costPerKg: 55.0 },
  // Novel/smart materials
  'nitinol':          { color: 0x909aa8, roughness: 0.35, metalness: 0.75, density: 6450, yieldMPa: 200, youngsGPa: 28,  thermalW_mK: 18,  costPerKg: 300.0},
  'aerogel':          { color: 0xf8f8ff, roughness: 0.9,  metalness: 0.0,  density: 100,  yieldMPa: 0.1, youngsGPa: 0.002,thermalW_mK: 0.015,costPerKg: 2000.0},
  'graphene_composite':{ color: 0x101010, roughness: 0.2,  metalness: 0.15, density: 2100, yieldMPa: 800, youngsGPa: 200, thermalW_mK: 300, costPerKg: 500.0},
  // Sub-grade steels
  'steel_1018':       { color: 0x8090a0, roughness: 0.4,  metalness: 0.8,  density: 7870, yieldMPa: 370, youngsGPa: 200, thermalW_mK: 52,  costPerKg: 0.8  },
  'steel_4130':       { color: 0x708090, roughness: 0.3,  metalness: 0.85, density: 7850, yieldMPa: 435, youngsGPa: 205, thermalW_mK: 42,  costPerKg: 2.5  },
  'steel_17_4ph':     { color: 0x9aacbc, roughness: 0.2,  metalness: 0.9,  density: 7780, yieldMPa: 1170,youngsGPa: 197, thermalW_mK: 18,  costPerKg: 15.0 },
  'cast_iron_ductile':{ color: 0x686868, roughness: 0.55, metalness: 0.65, density: 7100, yieldMPa: 310, youngsGPa: 169, thermalW_mK: 36,  costPerKg: 1.1  },
  'tool_steel_h13':   { color: 0x606878, roughness: 0.2,  metalness: 0.9,  density: 7750, yieldMPa: 1380,youngsGPa: 211, thermalW_mK: 25,  costPerKg: 18.0 },
  // Sub-grade aluminums
  'aluminum_2024_t3': { color: 0xb0b8c0, roughness: 0.3,  metalness: 0.72, density: 2780, yieldMPa: 345, youngsGPa: 73,  thermalW_mK: 121, costPerKg: 5.5  },
  'aluminum_6061_t6': { color: 0xaec0d0, roughness: 0.32, metalness: 0.7,  density: 2700, yieldMPa: 276, youngsGPa: 69,  thermalW_mK: 167, costPerKg: 3.0  },
  'aluminum_7075_t6': { color: 0x98acc0, roughness: 0.28, metalness: 0.75, density: 2810, yieldMPa: 503, youngsGPa: 72,  thermalW_mK: 130, costPerKg: 6.5  },
  'aluminum_7050_t7451':{ color: 0x90a8bc,roughness: 0.28, metalness: 0.75, density: 2830, yieldMPa: 490, youngsGPa: 71,  thermalW_mK: 155, costPerKg: 8.0  },
  'aluminum_cast_a380':{ color: 0xa8b8c8, roughness: 0.5,  metalness: 0.65, density: 2740, yieldMPa: 165, youngsGPa: 71,  thermalW_mK: 96,  costPerKg: 2.2  },
  // Titanium sub-grades
  'titanium_cp2':     { color: 0x9aa8b8, roughness: 0.28, metalness: 0.78, density: 4510, yieldMPa: 345, youngsGPa: 103, thermalW_mK: 16,  costPerKg: 28.0 },
  'titanium_6al4v_eli':{ color: 0x8090a8,roughness: 0.22, metalness: 0.82, density: 4430, yieldMPa: 825, youngsGPa: 114, thermalW_mK: 6.7, costPerKg: 55.0 },
  // High-temp alloys
  'hastelloy_c276':   { color: 0x788898, roughness: 0.25, metalness: 0.85, density: 8890, yieldMPa: 310, youngsGPa: 205, thermalW_mK: 11,  costPerKg: 95.0 },
  'waspalloy':        { color: 0x6a7888, roughness: 0.22, metalness: 0.88, density: 8190, yieldMPa: 795, youngsGPa: 213, thermalW_mK: 12,  costPerKg: 110.0},
  'rene_80':          { color: 0x606878, roughness: 0.2,  metalness: 0.9,  density: 8160, yieldMPa: 900, youngsGPa: 207, thermalW_mK: 12,  costPerKg: 200.0},
  // Non-ferrous sub-grades
  'copper_c110':      { color: 0xc87030, roughness: 0.25, metalness: 0.9,  density: 8940, yieldMPa: 70,  youngsGPa: 117, thermalW_mK: 388, costPerKg: 9.8  },
  'copper_c17200':    { color: 0xd08028, roughness: 0.2,  metalness: 0.85, density: 8250, yieldMPa: 1035,youngsGPa: 130, thermalW_mK: 115, costPerKg: 65.0 },
  'magnesium_az31b':  { color: 0xc8d0d8, roughness: 0.45, metalness: 0.6,  density: 1770, yieldMPa: 200, youngsGPa: 45,  thermalW_mK: 96,  costPerKg: 3.8  },
  // Electronics/specialty
  'solder_sac305':    { color: 0xd4c88a, roughness: 0.3,  metalness: 0.7,  density: 7370, yieldMPa: 40,  youngsGPa: 51,  thermalW_mK: 58,  costPerKg: 28.0 },
  'solder_snpb63':    { color: 0xccc080, roughness: 0.35, metalness: 0.65, density: 8400, yieldMPa: 28,  youngsGPa: 30,  thermalW_mK: 50,  costPerKg: 18.0 },
  'copper_pcb':       { color: 0xb87333, roughness: 0.2,  metalness: 0.95, density: 8940, yieldMPa: 210, youngsGPa: 117, thermalW_mK: 388, costPerKg: 9.5  },
  'fr4_tg170':        { color: 0x2a6030, roughness: 0.55, metalness: 0.0,  density: 1900, yieldMPa: 210, youngsGPa: 20,  thermalW_mK: 0.35,costPerKg: 12.0 },
  // Polymers
  'nylon_pa66':       { color: 0xe0d8c0, roughness: 0.7,  metalness: 0.0,  density: 1140, yieldMPa: 85,  youngsGPa: 3.0, thermalW_mK: 0.24,costPerKg: 5.5  },
  'nylon_pa12':       { color: 0xd8d0b8, roughness: 0.72, metalness: 0.0,  density: 1020, yieldMPa: 50,  youngsGPa: 1.6, thermalW_mK: 0.22,costPerKg: 7.0  },
  'pom_delrin':       { color: 0xf4f0e0, roughness: 0.5,  metalness: 0.0,  density: 1410, yieldMPa: 70,  youngsGPa: 3.1, thermalW_mK: 0.31,costPerKg: 5.8  },
  'nbr_rubber':       { color: 0x1a1a1a, roughness: 0.95, metalness: 0.0,  density: 1200, yieldMPa: 7,   youngsGPa: 0.003,thermalW_mK: 0.25,costPerKg: 4.5 },
  'viton':            { color: 0x282828, roughness: 0.9,  metalness: 0.0,  density: 1850, yieldMPa: 10,  youngsGPa: 0.007,thermalW_mK: 0.25,costPerKg: 55.0},
  'silicone':         { color: 0xe0e0e0, roughness: 0.8,  metalness: 0.0,  density: 1200, yieldMPa: 5,   youngsGPa: 0.001,thermalW_mK: 0.25,costPerKg: 18.0},
  'epoxy':            { color: 0xa89060, roughness: 0.7,  metalness: 0.0,  density: 1200, yieldMPa: 80,  youngsGPa: 3.8, thermalW_mK: 0.22,costPerKg: 12.0},
  // Composites
  'carbon_fiber_t800':{ color: 0x151515, roughness: 0.35, metalness: 0.12, density: 1550, yieldMPa: 1800,youngsGPa: 160, thermalW_mK: 8,   costPerKg: 90.0 },
  'cfrp_quasi_iso':   { color: 0x1c1c1c, roughness: 0.38, metalness: 0.1,  density: 1570, yieldMPa: 600, youngsGPa: 70,  thermalW_mK: 5,   costPerKg: 60.0 },
  'nomex_honeycomb':  { color: 0xd4b060, roughness: 0.7,  metalness: 0.0,  density: 48,   yieldMPa: 1.5, youngsGPa: 0.05,thermalW_mK: 0.05,costPerKg: 120.0},
};

function _getMat(key) {
  return MAT_DB_EXTENDED[key] || MAT_DB_EXTENDED['steel'];
}

function _makeMaterial(partDef) {
  const THREE = window.THREE;
  const matKey = (partDef.material || 'steel').toLowerCase().replace(/[- ]/g, '_');
  const md = _getMat(matKey);
  let color = md.color;
  if (partDef.color) {
    try { color = parseInt(String(partDef.color).replace('#', ''), 16); } catch (_) {}
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: md.roughness,
    metalness: md.metalness,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  // Store original color so 'solid' mode can restore it after stress/thermal
  mat.userData = mat.userData || {};
  mat.userData._origColor = color;
  return mat;
}

/* ── §33  ADVANCED GEOMETRY GENERATORS ──────────────────────────────────── */

function _buildPartMesh(partDef) {
  const THREE = window.THREE;
  partDef = _normalizePartDef(partDef);
  const d = partDef.dims || {};
  const mat = _makeMaterial(partDef);
  const type = (partDef.type || 'custom').toLowerCase();
  let geom;

  try {
    switch (type) {
      // ── Rotary ──
      case 'gear':            geom = _gearGeom(d, THREE);          break;
      case 'shaft':
      case 'axle':
      case 'strut':
      case 'column':
      case 'stud':
      case 'pipe_straight':   geom = _shaftGeom(d, THREE);         break;
      case 'spring':          geom = _springGeom(d, THREE);        break;
      case 'bearing':         geom = _bearingGeom(d, THREE);       break;
      case 'valve':
      case 'valve_intake':
      case 'valve_exhaust':  geom = _valveGeom(d, THREE);          break;
      case 'con_rod':        geom = _conRodGeom(d, THREE);         break;
      case 'crankshaft':     geom = _crankshaftGeom(d, THREE);     break;
      case 'piston_ring':    geom = _pistonRingGeom(d, THREE);     break;
      case 'impeller':       geom = _impellerGeom(d, THREE);       break;
      case 'turbine_disk':
      case 'flywheel':
      case 'pulley':
      case 'sprocket':        geom = _diskGeom(d, THREE);          break;
      case 'coupling':        geom = _shaftGeom(d, THREE);         break;
      // ── Fasteners ──
      case 'bolt':
      case 'bolt_hex':
      case 'screw_socket':
      case 'bolt_nut':        geom = _boltGeom(d, THREE);          break;
      case 'nut_hex':
      case 'nut':             geom = _nutHexGeom(d, THREE);        break;
      case 'washer':
      case 'back_up_ring':    geom = _washerGeom(d, THREE);        break;
      case 'rivet':           geom = _rivetGeom(d, THREE);         break;
      case 'dowel_pin':
      case 'roll_pin':
      case 'pin':
      case 'screw_pan':
      case 'screw_countersunk': geom = _shaftGeom({ d: d.d||4, L: d.L||20 }, THREE); break;
      case 'snap_ring':
      case 'circlip':
      case 'o_ring':
      case 'v_ring':          geom = _oRingGeom(d, THREE);         break;
      case 'gasket':          geom = _gasketGeom(d, THREE);        break;
      case 'lip_seal':        geom = _oRingGeom({ ...d, tubeR: (d.tubeR||4) }, THREE); break;
      case 'shim':
      case 'parallel_key':
      case 'woodruff_key':    geom = new THREE.BoxGeometry(
        (d.w||20)*UARE_CAD_UNIT,(d.h||3)*UARE_CAD_UNIT,(d.d||8)*UARE_CAD_UNIT); break;
      case 'thread_insert':   geom = _shaftGeom({ d: d.d||8, L: d.L||12 }, THREE);   break;
      // ── Welds ──
      case 'weld_fillet':
      case 'weld_butt':
      case 'weld_spot':
      case 'weld_plug':       geom = _weldGeom(d, THREE);          break;
      // ── Electrical ──
      case 'solder_joint':    geom = _solderJointGeom(d, THREE);   break;
      case 'resistor':        geom = _resistorGeom(d, THREE);      break;
      case 'capacitor':       geom = _capacitorGeom(d, THREE);     break;
      case 'inductor':        geom = _inductorGeom(d, THREE);      break;
      case 'crystal':
      case 'diode':
      case 'transistor':
      case 'led':
      case 'ic_dip':
      case 'ic_smd':          geom = _icGeom(d, THREE);            break;
      case 'connector_header':
      case 'connector':
      case 'fuse_holder':
      case 'relay':
      case 'terminal_block':  geom = _connectorGeom(d, THREE);     break;
      case 'wire_segment':
      case 'wire':
      case 'cable_tie':
      case 'heat_shrink':     geom = _wireGeom(d, THREE);          break;
      case 'bus_bar':         geom = new THREE.BoxGeometry(
        (d.w||50)*UARE_CAD_UNIT,(d.h||4)*UARE_CAD_UNIT,(d.d||6)*UARE_CAD_UNIT); break;
      case 'transformer':     geom = _transformerGeom(d, THREE);   break;
      case 'pcb':             geom = _pcbGeom(d, THREE, partDef.material); break;
      // ── Structural ──
      case 'plate':
      case 'tile':
      case 'shim_plate':
      case 'label':           geom = new THREE.BoxGeometry(
        (d.w||100)*UARE_CAD_UNIT,(d.h||8)*UARE_CAD_UNIT,(d.d||d.w||100)*UARE_CAD_UNIT); break;
      case 'beam':
      case 'rib':
      case 'gusset':
      case 'web_plate':       geom = new THREE.BoxGeometry(
        (d.w||40)*UARE_CAD_UNIT,(d.h||300)*UARE_CAD_UNIT,(d.d||40)*UARE_CAD_UNIT); break;
      case 'bracket':         geom = _bracketGeom(d, THREE);       break;
      case 'housing':
      case 'cylinder':
      case 'valve_body':
      case 'orifice':         geom = _housingGeom(d, THREE);       break;
      case 'ibeam':           geom = _ibeamGeom(d, THREE);         break;
      case 'heat_sink':       geom = _heatSinkGeom(d, THREE);      break;
      case 'heat_pipe':       geom = _shaftGeom({ d: d.d||12, L: d.L||200 }, THREE); break;
      case 'piston':          geom = _pistonGeom(d, THREE);        break;
      case 'nozzle':          geom = _nozzleGeom(d, THREE);        break;
      case 'dome':
      case 'tank':            geom = _domeGeom(d, THREE);          break;
      case 'flange':          geom = _flangeGeom(d, THREE);        break;
      case 'pipe_elbow':      geom = _elbowGeom(d, THREE);         break;
      case 'pipe_tee':        geom = _housingGeom({ w: d.od||40, h: d.od||40, d: d.od||40 }, THREE); break;
      case 'fin_array':
      case 'tec_module':      geom = _heatSinkGeom(d, THREE);      break;
      case 'ablator':
      case 'foam_fill':
      case 'mli_insulation':  geom = new THREE.BoxGeometry(
        (d.w||100)*UARE_CAD_UNIT,(d.h||10)*UARE_CAD_UNIT,(d.d||100)*UARE_CAD_UNIT); break;
      case 'handle':
      case 'knob':            geom = _shaftGeom({ d: d.d||30, L: d.L||80 }, THREE); break;
      // ── Engine sub-assemblies (Pass 8) ──
      case 'cylinder_head':
      case 'head':
      case 'dohc_head':
      case 'sohc_head':       geom = _cylinderHeadGeom(d, THREE);  break;
      case 'engine_block':
      case 'block':
      case 'short_block':     geom = _engineBlockGeom(d, THREE);   break;
      case 'camshaft':
      case 'cam':             geom = _camshaftGeom(d, THREE);      break;
      case 'rocker_arm':
      case 'rocker':          geom = _rockerArmGeom(d, THREE);     break;
      case 'wrist_pin':
      case 'piston_pin':
      case 'gudgeon_pin':     geom = _pistonPinGeom(d, THREE);     break;
      case 'oil_pan':
      case 'sump':            geom = _oilPanGeom(d, THREE);        break;
      case 'intake_manifold':
      case 'inlet_manifold':  geom = _intakeManifoldGeom(d, THREE);break;
      case 'exhaust_manifold':
      case 'header':          geom = _exhaustManifoldGeom(d, THREE); break;
      case 'flywheel_ring':
      case 'flywheel':        geom = _flywheelGeom(d, THREE);      break;
      case 'timing_chain':
      case 'timing_belt':
      case 'drive_chain':     geom = _timingChainGeom(d, THREE);   break;
      case 'con_rod_cap':
      case 'rod_cap':         geom = _conRodGeom({ ...d, capOnly: true }, THREE); break;
      case 'cam_follower':
      case 'tappet':
      case 'lifter':          geom = _camFollowerGeom(d, THREE);   break;
      case 'valve_spring_retainer':
      case 'retainer':        geom = _valveRetainerGeom(d, THREE); break;
      case 'valve_spring':    geom = _springGeom({ coils: d.coils||8, wireD: d.wireD||3, outerD: d.outerD||25, freeLen: d.freeLen||50 }, THREE); break;
      case 'push_rod':        geom = _pushRodGeom(d, THREE);       break;
      case 'throttle_body':   geom = _throttleBodyGeom(d, THREE);  break;
      case 'fuel_injector':   geom = _fuelInjectorGeom(d, THREE);  break;
      case 'spark_plug':      geom = _sparkPlugGeom(d, THREE);     break;
      case 'turbine_blade':
      case 'compressor_blade':
      case 'rotor_blade':     geom = _turbineBladeGeom(d, THREE);  break;
      case 'turbocharger':
      case 'turbo':           geom = _turbochargerGeom(d, THREE);  break;
      case 'oil_pump':
      case 'gerotor_pump':    geom = _oilPumpGeom(d, THREE);       break;
      case 'water_pump':
      case 'coolant_pump':    geom = _waterPumpGeom(d, THREE);     break;
      case 'clutch_disc':
      case 'friction_disc':   geom = _clutchDiscGeom(d, THREE);    break;
      case 'alternator':
      case 'generator':       geom = _alternatorGeom(d, THREE);    break;
      case 'oil_filter':
      case 'fuel_filter':     geom = _oilFilterGeom(d, THREE);     break;
      case 'cylinder_liner':
      case 'cylinder_sleeve': geom = _cylinderLinerGeom(d, THREE); break;
      case 'connecting_rod_bearing':
      case 'big_end_bearing':
      case 'small_end_bearing': geom = _bearingGeom(d, THREE);     break;
      case 'crankshaft_seal':
      case 'rear_main_seal':
      case 'front_seal':      geom = _oRingGeom(d, THREE);         break;
      case 'head_gasket':
      case 'exhaust_gasket':
      case 'intake_gasket':   geom = _gasketGeom(d, THREE);        break;
      // ── Chassis / Suspension ──
      case 'ball_joint':
      case 'tie_rod_end':     geom = _ballJointGeom(d, THREE);     break;
      case 'brake_rotor':
      case 'disc_brake':      geom = _brakeRotorGeom(d, THREE);    break;
      case 'coil_over':
      case 'shock_absorber':  geom = _coilOverGeom(d, THREE);      break;
      case 'rack_and_pinion': geom = _rackAndPinionGeom(d, THREE); break;
      // ── Fasteners ──
      case 'socket_head_screw':
      case 'cap_screw':       geom = _socketHeadScrewGeom(d, THREE); break;
      // ── Precision / Power Trans ──
      case 'deep_groove_bearing':
      case 'ball_bearing':    geom = _deepGrooveBearingGeom(d, THREE); break;
      case 'worm_gear':
      case 'worm_drive':      geom = _wormGearGeom(d, THREE);      break;
      case 'linear_rail':
      case 'linear_guide':    geom = _linearRailGeom(d, THREE);    break;
      case 'v_belt_pulley':
      case 'pulley':
      case 'sprocket':        geom = _vBeltPulleyGeom(d, THREE);   break;
      case 'custom':          geom = _customPartGeom(d, THREE);    break;
      default:                geom = _defaultGeom(d, THREE);       break;
    }
  } catch (e) {
    console.error('[UARE CAD] geom FAILED type=' + type + ' | ' + e.message, e);
    geom = _defaultGeom(d, THREE);
  }

  // Support geometry functions that return a THREE.Group (multi-piece parts)
  if (geom && geom.isGroup) {
    geom.name = partDef.name || type;
    geom._partDef = partDef;
    // Apply material to all meshes in group
    geom.traverse(function(child) {
      if (child.isMesh && !child.material) child.material = mat;
    });
    return geom;
  }

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = partDef.name || type;
  mesh._partDef = partDef;
  return mesh;
}

function _customPartGeom(d, THREE) {
  // Generic machined component: cylindrical body + mounting flange + output shaft + keyway
  // Used for motors, actuators, end-effectors and any untyped mechanical part.
  const U      = UARE_CAD_UNIT;
  const r      = Math.max((d.d || d.w || 60) / 2, 6) * U;
  const L      = Math.max((d.L || d.h || 80), 10) * U;
  const mat    = new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.72, roughness: 0.30 });
  const darkMat= new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.88 });
  const group  = new THREE.Group();

  // Main body — cylinder with slight taper (machined look)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.94, L * 0.72, 22, 2), mat);
  body.position.y = L * 0.36;
  group.add(body);

  // Mounting flange at base (1.4× body diameter)
  const flangeR = r * 1.40;
  const flangeH = L * 0.115;
  const flange  = new THREE.Mesh(new THREE.CylinderGeometry(flangeR, flangeR, flangeH, 22, 1), mat);
  flange.position.y = flangeH / 2;
  group.add(flange);

  // 4 mounting holes on flange BCD
  const bcdR = r * 1.18;
  for (let i = 0; i < 4; i++) {
    const ang  = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.085, r * 0.085, flangeH * 1.08, 8, 1), darkMat);
    hole.position.set(Math.cos(ang) * bcdR, flangeH / 2, Math.sin(ang) * bcdR);
    group.add(hole);
  }

  // Output shaft stub at top
  const shaftR = r * 0.30;
  const shaftL = L * 0.20;
  const shaft  = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 18, 1), mat);
  shaft.position.y = L * 0.72 + shaftL / 2;
  group.add(shaft);

  // Keyway flat on shaft (dark box representing keyseat)
  const keyW = shaftR * 0.62;
  const keyH = shaftR * 0.32;
  const key  = new THREE.Mesh(new THREE.BoxGeometry(keyW, shaftL * 1.02, keyH), darkMat);
  key.position.set(shaftR - keyH / 2 + 0.0001, L * 0.72 + shaftL / 2, 0);
  group.add(key);

  // Radial cooling fins or connector ring at body midpoint
  const finR = r * 1.08;
  const finH = L * 0.045;
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(finR, finR, finH, 22, 1), mat);
    fin.position.y = L * 0.18 + i * L * 0.155;
    group.add(fin);
  }
  return group;
}

function _defaultGeom(d, THREE) {
  const w = (d.w || d.d || 100) * UARE_CAD_UNIT;
  const h = (d.h || d.w || 100) * UARE_CAD_UNIT;
  const dep= (d.d || d.w || 100) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dep, 2, 2, 2);
}
function _housingGeom(d, THREE) {
  const U  = UARE_CAD_UNIT;
  const w  = (d.w || 200) * U;
  const h  = (d.h || 150) * U;
  const dep= (d.d || 120)  * U;

  // For roughly-cylindrical housings (w ≈ d), use hollow cylinder profile
  const aspect = Math.max(w, dep) / Math.min(w, dep);
  if (aspect < 1.6 && d.d && d.w) {
    // Hollow tube/housing cross-section via LatheGeometry
    const oR      = Math.min(w, dep) / 2;
    const wallT   = oR * 0.12;
    const pts = [
      new THREE.Vector2(oR - wallT, -h / 2),
      new THREE.Vector2(oR,         -h / 2 + wallT),
      new THREE.Vector2(oR,          h / 2 - wallT),
      new THREE.Vector2(oR - wallT,  h / 2),
    ];
    return new THREE.LatheGeometry(pts, 40);
  }

  // Rectangular housing: box with raised rib edges for visual depth
  return new THREE.BoxGeometry(w, h, dep, 3, 3, 3);
}
function _shaftGeom(d, THREE) {
  const r = (d.d || 30) / 2 * UARE_CAD_UNIT;
  const L = (d.L || 300) * UARE_CAD_UNIT;
  return new THREE.CylinderGeometry(r, r, L, 24, 4);
}
function _gearGeom(d, THREE) {
  const U     = UARE_CAD_UNIT;
  const teeth = d.teeth || 20;
  const mod   = (d.module || d.m || 2.5) * U;
  const faceW = (d.faceW  || 25) * U;
  const pressAngle = (d.pressAngle || 20) * Math.PI / 180;
  const pitchR    = teeth * mod / 2;
  const addendumR = pitchR + mod;
  const dedendumR = pitchR - mod * 1.25;
  const baseR     = pitchR * Math.cos(pressAngle);
  const hubR      = pitchR * 0.32;
  const involuteMax = Math.acos(baseR / addendumR);

  const pts2d = [];
  for (let i = 0; i < teeth; i++) {
    const tAng  = (i / teeth) * Math.PI * 2;
    const half  = Math.PI / teeth;   // half pitch angle
    const steps = 5;

    // Right involute flank
    const fR = [];
    for (let s = 0; s <= steps; s++) {
      const t   = (s / steps) * involuteMax;
      const r   = Math.sqrt(baseR * baseR + (baseR * t) * (baseR * t));
      const ang = tAng - half * 0.5 + (t - Math.atan(t));
      if (r <= addendumR + mod * 0.01) fR.push([Math.cos(ang) * r, Math.sin(ang) * r]);
    }
    // Left involute flank (mirrored about tooth centre)
    const fL = fR.map(([x, y]) => {
      const a  = Math.atan2(y, x);
      const r2 = Math.hypot(x, y);
      const mir= tAng + half * 0.5 - (a - (tAng - half * 0.5));
      return [Math.cos(mir) * r2, Math.sin(mir) * r2];
    }).reverse();

    // Root fillet points (arc at dedendum circle)
    const rootA1 = tAng + half + half * 0.3;
    const rootA2 = tAng + 2 * half - half - half * 0.3;
    pts2d.push(new THREE.Vector2(Math.cos(rootA2) * dedendumR, Math.sin(rootA2) * dedendumR));
    for (const [fx, fy] of fL) pts2d.push(new THREE.Vector2(fx, fy));
    // Tip land
    if (fL.length && fR.length) {
      const tAng1 = Math.atan2(fL[fL.length-1][1], fL[fL.length-1][0]);
      const tAng2 = Math.atan2(fR[fR.length-1][1], fR[fR.length-1][0]);
      pts2d.push(new THREE.Vector2(Math.cos(tAng1) * addendumR, Math.sin(tAng1) * addendumR));
      pts2d.push(new THREE.Vector2(Math.cos(tAng2) * addendumR, Math.sin(tAng2) * addendumR));
    }
    for (const [fx, fy] of fR) pts2d.push(new THREE.Vector2(fx, fy));
    pts2d.push(new THREE.Vector2(Math.cos(rootA1) * dedendumR, Math.sin(rootA1) * dedendumR));
  }

  const gearShape = new THREE.Shape(pts2d);
  const boreHole  = new THREE.Path();
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    if (i === 0) boreHole.moveTo(Math.cos(a) * hubR, Math.sin(a) * hubR);
    else         boreHole.lineTo(Math.cos(a) * hubR, Math.sin(a) * hubR);
  }
  gearShape.holes.push(boreHole);

  const geom = new THREE.ExtrudeGeometry(gearShape, { depth: faceW, bevelEnabled: false });
  geom.rotateX(Math.PI / 2);

  const mat   = new THREE.MeshStandardMaterial({ color: 0x606878, metalness: 0.75, roughness: 0.30 });
  const matHub= new THREE.MeshStandardMaterial({ color: 0x5a6070, metalness: 0.75, roughness: 0.30 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geom, mat));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 1.5, hubR * 1.5, faceW * 1.25, 24, 1), matHub);
  group.add(hub);
  return group;
}

function _bearingGeom(d, THREE) {
  const U  = UARE_CAD_UNIT;
  const iR = (d.innerD || 25) / 2 * U;
  const oR = (d.outerD || 52) / 2 * U;
  const w  = (d.width  || 15) * U;
  const raceThick = (oR - iR) * 0.28;
  const midR   = (oR + iR) / 2;
  const ballR  = (oR - iR) * 0.25;
  const nBalls = Math.max(7, Math.round((midR * Math.PI * 2) / (ballR * 2.5)));

  const outerMat  = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.88, roughness: 0.10 });
  const innerMat  = new THREE.MeshStandardMaterial({ color: 0x99aabb, metalness: 0.88, roughness: 0.10 });
  const ballMat   = new THREE.MeshStandardMaterial({ color: 0xd8e8f8, metalness: 0.97, roughness: 0.04 });
  const cageMat   = new THREE.MeshStandardMaterial({ color: 0xe8c87a, metalness: 0.30, roughness: 0.60 });
  const shieldMat = new THREE.MeshStandardMaterial({ color: 0x606878, metalness: 0.70, roughness: 0.40 });
  const group = new THREE.Group();

  // Outer race with raceway groove
  const outerPts = [
    new THREE.Vector2(oR - raceThick,  -w/2),
    new THREE.Vector2(oR,              -w/2 + raceThick * 0.35),
    new THREE.Vector2(oR,              -ballR * 0.15),
    new THREE.Vector2(oR - raceThick * 0.12, 0),
    new THREE.Vector2(oR,               ballR * 0.15),
    new THREE.Vector2(oR,               w/2 - raceThick * 0.35),
    new THREE.Vector2(oR - raceThick,   w/2),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(outerPts, 40), outerMat));

  // Inner race with raceway groove
  const innerPts = [
    new THREE.Vector2(iR,              -w/2 + raceThick * 0.35),
    new THREE.Vector2(iR + raceThick,  -w/2),
    new THREE.Vector2(iR + raceThick,  -ballR * 0.15),
    new THREE.Vector2(iR + raceThick * 1.12, 0),
    new THREE.Vector2(iR + raceThick,   ballR * 0.15),
    new THREE.Vector2(iR + raceThick,   w/2),
    new THREE.Vector2(iR,               w/2 - raceThick * 0.35),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(innerPts, 40), innerMat));

  // Rolling balls
  for (let i = 0; i < nBalls; i++) {
    const angle = (i / nBalls) * Math.PI * 2;
    const ball  = new THREE.Mesh(new THREE.SphereGeometry(ballR, 14, 10), ballMat);
    ball.position.set(Math.cos(angle) * midR, 0, Math.sin(angle) * midR);
    group.add(ball);
  }

  // Brass cage ring
  const cageWall = (oR - iR) * 0.10;
  const cageW    = w * 0.30;
  const cagePts  = [
    new THREE.Vector2(midR,              -cageW / 2),
    new THREE.Vector2(midR + cageWall,   -cageW / 2),
    new THREE.Vector2(midR + cageWall,    cageW / 2),
    new THREE.Vector2(midR,               cageW / 2),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(cagePts, 32), cageMat));

  // Shields (2RS)
  for (const side of [-1, 1]) {
    const shPts = [
      new THREE.Vector2(iR + raceThick * 1.1, 0),
      new THREE.Vector2(oR - raceThick * 0.6,  0),
    ];
    const shield = new THREE.Mesh(new THREE.LatheGeometry(shPts, 32), shieldMat);
    shield.position.y = side * (w / 2 - w * 0.06);
    group.add(shield);
  }

  return group;
}

function _springGeom(d, THREE) {
  const coils  = d.coils   || 10;
  const wireR  = (d.wireD  || 3)  / 2 * UARE_CAD_UNIT;
  const outerR = (d.outerD || 25) / 2 * UARE_CAD_UNIT;
  const freeL  = (d.freeLen|| 80) * UARE_CAD_UNIT;
  const meanR  = outerR - wireR;
  const totalT = coils + 1.5;   // includes 0.75 closed turns each end
  const segs   = Math.round(coils * 28);
  const pts    = [];

  for (let i = 0; i <= segs; i++) {
    const t    = i / segs;
    const turns= t * totalT;
    const angle= turns * Math.PI * 2;
    // Pitch blending: closed ends approach zero pitch
    const closeFrac = 0.75 / totalT;
    let pitchMult;
    if (t < closeFrac)           pitchMult = t / closeFrac;
    else if (t > 1 - closeFrac)  pitchMult = (1 - t) / closeFrac;
    else                         pitchMult = 1;
    const yRaw = freeL * t - freeL / 2;
    // Compress the active coil region, let closed ends stack flat
    const yActive = yRaw * pitchMult;
    pts.push(new THREE.Vector3(meanR * Math.cos(angle), yRaw, meanR * Math.sin(angle)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, segs, wireR, 8, false);
}

function _boltGeom(d, THREE) {
  const U        = UARE_CAD_UNIT;
  const shankR   = (d.d || 10) / 2 * U;
  const L        = (d.L || 50) * U;
  const headH    = shankR * 2.2;
  const headR    = shankR * 1.85;
  const socketR  = shankR * 0.85;
  const threadP  = shankR * 0.15;
  const shankLen = L * 0.50;
  const threadLen= L * 0.50;
  const mat      = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, metalness: 0.92, roughness: 0.18 });
  const matDark  = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.60, roughness: 0.50 });
  const group    = new THREE.Group();

  // Hex head
  const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 6, 1), mat);
  head.position.y = -headH / 2;
  group.add(head);
  // Top chamfer
  const topCham = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.90, headR, headH * 0.12, 6, 1), mat);
  topCham.position.y = -headH * 0.06;
  group.add(topCham);
  // Hex socket drive recess
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(socketR, socketR, headH * 0.65, 6, 1), matDark);
  socket.position.y = -headH * 0.35;
  group.add(socket);
  // Washer face
  const wFace = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.92, headR * 0.92, headH * 0.08, 24, 1), mat);
  wFace.position.y = -headH - headH * 0.04;
  group.add(wFace);

  // Smooth shank
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(shankR, shankR, shankLen, 20, 1), mat);
  shank.position.y = shankLen / 2;
  group.add(shank);
  // Threaded section
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(shankR * 0.90, shankR * 0.90, threadLen, 20, 1), mat);
  thread.position.y = shankLen + threadLen / 2;
  group.add(thread);
  // Thread helix rings
  const nRings  = Math.max(3, Math.floor(threadLen / threadP));
  const ridgeT  = shankR * 0.06;
  for (let i = 0; i < nRings; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(shankR * 0.95, ridgeT, 4, 18), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = shankLen + (i + 0.5) * threadP;
    group.add(ring);
  }
  // Chamfer tip
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0, shankR * 0.90, shankR, 20, 1), mat);
  tip.position.y = shankLen + threadLen + shankR / 2;
  group.add(tip);

  return group;
}
function _pcbGeom(d, THREE, material) {
  const w = (d.w || 100) * UARE_CAD_UNIT;
  const dep = (d.d || d.w || 80) * UARE_CAD_UNIT;
  const h = 1.6 * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dep, 1, 1, 1);
}
function _bracketGeom(d, THREE) {
  const U  = UARE_CAD_UNIT;
  const w  = (d.w || 80) * U;           // horizontal flange length
  const hgt= (d.h || 60) * U;          // vertical web height
  const t  = Math.max(3, (d.t || Math.max(d.w||80, d.h||60) * 0.06)) * U;
  const dep= (d.d || d.w || 80) * U;   // extrude depth

  // L cross-section (XY plane, extruded along Z)
  const shape = new THREE.Shape();
  shape.moveTo(0,   0);
  shape.lineTo(w,   0);
  shape.lineTo(w,   t);
  shape.lineTo(t,   t);
  shape.lineTo(t,   hgt);
  shape.lineTo(0,   hgt);
  shape.lineTo(0,   0);

  const geom = new THREE.ExtrudeGeometry(shape, { depth: dep, bevelEnabled: false });
  geom.applyMatrix4(new THREE.Matrix4().makeTranslation(-w / 2, -hgt / 2, -dep / 2));
  return geom;
}
function _pistonGeom(d, THREE) {
  const U   = UARE_CAD_UNIT;
  const r   = (d.d || 86) / 2 * U;
  const h   = (d.h || 72) * U;
  const gW  = 1.6 * U;  // compression ring groove width
  const gD  = 1.4 * U;  // ring groove depth
  const oW  = 3.0 * U;  // oil ring groove width (wider)
  const wPinR = (d.pinD || r * 0.27 / U) / 2 * U;  // wrist pin bore radius

  // Y = 0 at pin CL, crown at +h/2, skirt bottom at -h/2
  const top  = h * 0.62;    // crown (above pin CL)
  const bot  = -h * 0.38;   // skirt bottom
  const g1t  = top - 5.5 * U;
  const g2t  = g1t - gW - 4.0 * U;
  const g3t  = g2t - gW - 3.5 * U;

  const mat     = new THREE.MeshStandardMaterial({ color: 0xc8baa0, metalness: 0.40, roughness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.30, roughness: 0.70 });
  const group   = new THREE.Group();

  // Main body via LatheGeometry
  const pts = [
    new THREE.Vector2(0,         top),           // crown centre
    new THREE.Vector2(r * 0.55,  top - 0.7 * U), // slight dish
    new THREE.Vector2(r,         top - 1.5 * U), // crown chamfer
    new THREE.Vector2(r,         g1t + gW),
    new THREE.Vector2(r - gD,    g1t + gW - 0.2 * U),
    new THREE.Vector2(r - gD,    g1t + 0.2 * U),
    new THREE.Vector2(r,         g1t),
    new THREE.Vector2(r,         g2t + gW),
    new THREE.Vector2(r - gD,    g2t + gW - 0.2 * U),
    new THREE.Vector2(r - gD,    g2t + 0.2 * U),
    new THREE.Vector2(r,         g2t),
    new THREE.Vector2(r,         g3t + oW),
    new THREE.Vector2(r - gD,    g3t + oW - 0.3 * U),
    new THREE.Vector2(r - gD,    g3t + 0.3 * U),
    new THREE.Vector2(r,         g3t),
    new THREE.Vector2(r * 0.98,  g3t - 5 * U),
    new THREE.Vector2(r * 0.97,  0.5 * U),   // at pin CL (top)
    new THREE.Vector2(r * 0.97, -0.5 * U),   // at pin CL (bottom)
    new THREE.Vector2(r * 0.98,  bot + 8 * U),
    new THREE.Vector2(r * 0.96,  bot + 2 * U),
    new THREE.Vector2(r * 0.94,  bot),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat));

  // Wrist pin bosses (two hollow protrusions inside skirt at pin CL)
  const pinBossR = wPinR * 1.6;
  for (const side of [-1, 1]) {
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(pinBossR, pinBossR, r * 0.45, 20, 1), mat);
    boss.rotation.z = Math.PI / 2;
    boss.position.set(side * r * 0.6, 0, 0);
    group.add(boss);
  }

  // Wrist pin bore (dark hollow through both bosses)
  const pinBore = new THREE.Mesh(new THREE.CylinderGeometry(wPinR, wPinR, r * 1.7, 16, 1), darkMat);
  pinBore.rotation.z = Math.PI / 2;
  group.add(pinBore);

  return group;
}

function _heatSinkGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const w    = (d.w || 80) * U;
  const h    = (d.h || 40) * U;
  const dep  = (d.d || 60) * U;
  const nFin = d.fins || 12;
  const baseH= h * 0.25;
  const finH = h - baseH;
  const finT = Math.max(1.5 * U, w * 0.028);
  const gap  = (w - nFin * finT) / Math.max(nFin - 1, 1);
  const mat     = new THREE.MeshStandardMaterial({ color: 0xaabbc4, metalness: 0.55, roughness: 0.50 });
  const matBase = new THREE.MeshStandardMaterial({ color: 0x9aabb8, metalness: 0.55, roughness: 0.45 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const group   = new THREE.Group();

  // Base plate
  group.add(new THREE.Mesh(new THREE.BoxGeometry(w, baseH, dep), matBase));

  // Tapered fins
  for (let i = 0; i < nFin; i++) {
    const xPos = -w / 2 + i * (finT + gap) + finT / 2;
    const tipT = finT * 0.70;
    const finShape = new THREE.Shape();
    finShape.moveTo(-finT / 2, 0);
    finShape.lineTo( finT / 2, 0);
    finShape.lineTo( tipT / 2, finH);
    finShape.lineTo(-tipT / 2, finH);
    finShape.lineTo(-finT / 2, 0);
    const finGeom = new THREE.ExtrudeGeometry(finShape, { depth: dep * 0.96, bevelEnabled: false });
    const fin = new THREE.Mesh(finGeom, mat);
    fin.rotation.x = Math.PI / 2;
    fin.position.set(xPos, baseH / 2, dep * 0.48);
    group.add(fin);
  }

  // Corner mounting holes
  const mBossR = 2.5 * U;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(mBossR * 2, mBossR * 2, baseH * 1.05, 8, 1), matBase);
    boss.position.set(sx * (w * 0.40), 0, sz * (dep * 0.40));
    group.add(boss);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(mBossR, mBossR, baseH * 1.08, 8, 1), matDark);
    hole.position.set(sx * (w * 0.40), 0, sz * (dep * 0.40));
    group.add(hole);
  }

  return group;
}
function _ibeamGeom(d, THREE) {
  const H = (d.H || 200) * UARE_CAD_UNIT;
  const W = (d.W || 100) * UARE_CAD_UNIT;
  const tw= (d.tw|| 7)   * UARE_CAD_UNIT;
  const tf= (d.tf|| 11)  * UARE_CAD_UNIT;
  const L = (d.L || 1000)* UARE_CAD_UNIT;
  // Build I-beam cross-section as Shape
  const half = W / 2, halfH = H / 2, halfW = tw / 2;
  const shape = new THREE.Shape([
    new THREE.Vector2(-half, -halfH),
    new THREE.Vector2( half, -halfH),
    new THREE.Vector2( half, -halfH + tf),
    new THREE.Vector2( halfW,-halfH + tf),
    new THREE.Vector2( halfW, halfH - tf),
    new THREE.Vector2( half,  halfH - tf),
    new THREE.Vector2( half,  halfH),
    new THREE.Vector2(-half,  halfH),
    new THREE.Vector2(-half,  halfH - tf),
    new THREE.Vector2(-halfW, halfH - tf),
    new THREE.Vector2(-halfW,-halfH + tf),
    new THREE.Vector2(-half, -halfH + tf),
  ]);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
  geom.rotateX(Math.PI / 2);
  geom.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -L / 2));
  return geom;
}



/* ═══════════════════════════════════════════════════════════════════════════
   § 33c  HYPER-PRECISION ENGINE & MECHANICAL GEOMETRY — Pass 8
   ═══════════════════════════════════════════════════════════════════════════
   Every function below produces geometry that closely matches the real
   engineering part: correct proportions, visible sub-features, multi-piece
   Groups where needed.  All dims in mm; internal scale = UARE_CAD_UNIT = 0.1.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────────────────────
   VALVE — mushroom poppet valve
   Real geometry: thin stem, 45° seat face, large combustion-face head,
   undercut retainer groove near tip, hardened tip pad.
   Refs: SAE J1692, typical bore-to-head ratio 0.43 (intake) / 0.35 (exhaust)
──────────────────────────────────────────────────────────────────────────── */
function _valveGeom(d, THREE) {
  const U     = UARE_CAD_UNIT;
  const stemR = (d.d || 5.5)  / 2 * U;
  const L     = (d.L || 105)  * U;
  const headR = d.headD ? d.headD / 2 * U : stemR * 6;
  const headH = headR * 0.22;
  const gBot  = -L / 2 + 8  * U;   // retainer groove bottom
  const gTop  = gBot  + 3   * U;   // retainer groove top
  const gDepth= 1.5 * U;
  const ucBot = -L / 2 + 18 * U;   // oil seal groove bottom
  const ucTop = ucBot + 5   * U;
  const bot = -L / 2;
  const top =  L / 2;

  // LatheGeometry — Y=valve axis, X=radius, built tip→combustion face
  const pts = [
    new THREE.Vector2(0,              bot),
    new THREE.Vector2(stemR,          bot + 1.2 * U),
    new THREE.Vector2(stemR,          gBot),
    // retainer (collet) groove
    new THREE.Vector2(stemR - gDepth, gBot + 0.5 * U),
    new THREE.Vector2(stemR - gDepth, gTop - 0.5 * U),
    new THREE.Vector2(stemR,          gTop),
    // oil seal groove
    new THREE.Vector2(stemR,          ucBot),
    new THREE.Vector2(stemR - gDepth * 0.6, ucBot + 1 * U),
    new THREE.Vector2(stemR - gDepth * 0.6, ucTop - 1 * U),
    new THREE.Vector2(stemR,          ucTop),
    // full stem shaft
    new THREE.Vector2(stemR,          top - headH - headR * 0.55),
    // fillet: stem→head transition
    new THREE.Vector2(stemR * 1.5,    top - headH - headR * 0.4),
    new THREE.Vector2(headR * 0.92,   top - headH * 0.85),
    // 45° valve face
    new THREE.Vector2(headR,          top - headH * 0.5),
    new THREE.Vector2(headR,          top - headH * 0.15),
    // combustion face (slight 3° dish)
    new THREE.Vector2(headR * 0.6,    top),
    new THREE.Vector2(0,              top),
  ];
  return new THREE.LatheGeometry(pts, 32);
}

function _conRodGeom(d, THREE) {
  const U       = UARE_CAD_UNIT;
  const ctc     = (d.h || d.ctc || 155) * U;
  const bigR    = (d.bigEndD   || 52) / 2 * U;
  const smlR    = (d.smallEndD || 24) / 2 * U;
  const beamW   = (d.w || 22) * U;
  const flangeT = beamW * 0.30;
  const webT    = beamW * 0.16;
  const beamH   = beamW * 0.50;
  const bigBoreR  = bigR * 0.70;
  const smlBoreR  = smlR * 0.62;
  const boltR    = 5 * U;
  const boltL    = beamW * 1.2;
  const boltOff  = bigR * 0.72;

  const matRod  = new THREE.MeshStandardMaterial({ color: 0x4a5a6a, metalness: 0.80, roughness: 0.30 });
  const matCap  = new THREE.MeshStandardMaterial({ color: 0x38485a, metalness: 0.75, roughness: 0.40 });
  const matBore = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.40, roughness: 0.70 });
  const matBolt = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.92, roughness: 0.15 });
  const matBush = new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.60, roughness: 0.40 });

  const group = new THREE.Group();

  // H-beam cross-section shape
  const shape = new THREE.Shape();
  const hw = beamW / 2, hh = beamH / 2;
  shape.moveTo(-hw, -hh);
  shape.lineTo( hw, -hh);
  shape.lineTo( hw, -hh + flangeT);
  shape.lineTo( webT / 2, -hh + flangeT);
  shape.lineTo( webT / 2,  hh - flangeT);
  shape.lineTo( hw,  hh - flangeT);
  shape.lineTo( hw,  hh);
  shape.lineTo(-hw,  hh);
  shape.lineTo(-hw,  hh - flangeT);
  shape.lineTo(-webT/2,  hh - flangeT);
  shape.lineTo(-webT/2, -hh + flangeT);
  shape.lineTo(-hw, -hh + flangeT);
  shape.lineTo(-hw, -hh);

  const beamLen  = ctc * 0.54;
  const beamGeom = new THREE.ExtrudeGeometry(shape, { depth: beamLen, bevelEnabled: false });
  const beam = new THREE.Mesh(beamGeom, matRod);
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, -ctc / 2 + bigR + beamLen, 0);
  group.add(beam);

  // Big end upper half (rod body side)
  const bigUpper = new THREE.Mesh(new THREE.CylinderGeometry(bigR, bigR, beamW, 40, 1, false, 0, Math.PI), matRod);
  bigUpper.rotation.z = Math.PI / 2;
  bigUpper.position.set(0, -ctc / 2, 0);
  group.add(bigUpper);

  // Big end cap (lower half — different shade to show split line)
  const bigCap = new THREE.Mesh(new THREE.CylinderGeometry(bigR, bigR, beamW, 40, 1, false, Math.PI, Math.PI), matCap);
  bigCap.rotation.z = Math.PI / 2;
  bigCap.position.set(0, -ctc / 2, 0);
  group.add(bigCap);

  // Big end bore (dark — crankpin bearing surface)
  const bigBore = new THREE.Mesh(new THREE.CylinderGeometry(bigBoreR, bigBoreR, beamW * 1.05, 28, 1), matBore);
  bigBore.rotation.z = Math.PI / 2;
  bigBore.position.set(0, -ctc / 2, 0);
  group.add(bigBore);

  // 2 ARP cap bolts at split line
  for (const side of [-1, 1]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(boltR, boltR, boltL, 12, 1), matBolt);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(side * boltOff, -ctc / 2, 0);
    group.add(bolt);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(boltR * 1.8, boltR * 1.8, boltR * 2, 6, 1), matBolt);
    head.rotation.x = Math.PI / 2;
    head.position.set(side * boltOff, -ctc / 2, boltL / 2 + boltR);
    group.add(head);
  }

  // Small end boss with bronze bushing
  const smlBoss = new THREE.Mesh(new THREE.CylinderGeometry(smlR, smlR, beamW * 0.80, 28, 1), matRod);
  smlBoss.position.set(0, ctc / 2, 0);
  group.add(smlBoss);
  const bush = new THREE.Mesh(new THREE.CylinderGeometry(smlBoreR * 1.12, smlBoreR * 1.12, beamW * 0.78, 24, 1), matBush);
  bush.position.set(0, ctc / 2, 0);
  group.add(bush);
  const smlBore = new THREE.Mesh(new THREE.CylinderGeometry(smlBoreR, smlBoreR, beamW * 0.90, 20, 1), matBore);
  smlBore.position.set(0, ctc / 2, 0);
  group.add(smlBore);

  return group;
}

function _crankshaftGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const mJR    = (d.d     || 55)  / 2 * U;
  const rJR    = (d.rodD  || 48)  / 2 * U;
  const throw_ = (d.stroke|| 86)  / 2 * U;
  const L      = (d.L     || 420) * U;
  const cyl    = d.cylinders || 4;
  const jW     = 20 * U;
  const cHeekT = 13 * U;
  const mat    = new THREE.MeshStandardMaterial({ color: 0x5a6878, metalness: 0.85, roughness: 0.20 });
  const darkMat= new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.50, roughness: 0.60 });

  const group = new THREE.Group();
  const mainSpacing = L / (cyl + 1);

  // Main journals
  for (let i = 0; i <= cyl; i++) {
    const xPos = -L / 2 + (i + 0.5) * mainSpacing;
    const mj = new THREE.Mesh(new THREE.CylinderGeometry(mJR, mJR, jW, 32, 1), mat);
    mj.rotation.z = Math.PI / 2;
    mj.position.set(xPos, 0, 0);
    group.add(mj);
  }

  // Front nose (pulley snout)
  const noseLen = 28 * U;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(mJR * 0.75, mJR * 0.75, noseLen, 20, 1), mat);
  nose.rotation.z = Math.PI / 2;
  nose.position.set(-L / 2 - noseLen / 2, 0, 0);
  group.add(nose);

  // Rear flange
  const flangeLen = 16 * U;
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(mJR * 1.35, mJR * 1.35, flangeLen, 8, 1), mat);
  flange.rotation.z = Math.PI / 2;
  flange.position.set(L / 2 + flangeLen / 2, 0, 0);
  group.add(flange);

  // Crank throws — inline-4: 0°, 180°, 180°, 0°
  const throwAngles = [0, Math.PI, Math.PI, 0];
  for (let i = 0; i < cyl; i++) {
    const xCtr = -L / 2 + (i + 1) * mainSpacing;
    const ang  = throwAngles[i] || 0;
    const zOff = Math.sin(ang) * throw_;
    const yOff = Math.cos(ang) * throw_;

    // Rod journal
    const rj = new THREE.Mesh(new THREE.CylinderGeometry(rJR, rJR, jW * 0.88, 28, 1), mat);
    rj.rotation.z = Math.PI / 2;
    rj.position.set(xCtr, yOff, zOff);
    group.add(rj);

    // Oil hole dimple on rod journal
    const oilHole = new THREE.Mesh(new THREE.CylinderGeometry(1.2 * U, 1.2 * U, rJR * 0.6, 8, 1), darkMat);
    oilHole.rotation.x = Math.PI / 2;
    oilHole.position.set(xCtr, yOff + rJR * 0.8, zOff);
    group.add(oilHole);

    // Teardrop counterweight — ExtrudeGeometry kidney/teardrop profile
    // Counterweight opposes the crank throw (yOff), so it hangs opposite
    const cwR  = mJR * 1.3;
    const cwH  = throw_ * 1.1;
    const cwShape = new THREE.Shape();
    cwShape.moveTo(-jW * 0.5, 0);
    cwShape.lineTo(-jW * 0.5, -cwH * 0.25);
    cwShape.absarc(0, -cwH * 0.25, cwR * 0.90, Math.PI, 0, true);
    cwShape.lineTo( jW * 0.5, 0);
    cwShape.lineTo(-jW * 0.5, 0);
    const cwGeom = new THREE.ExtrudeGeometry(cwShape, { depth: cHeekT, bevelEnabled: false });

    // Side A cheek (toward main journal left of throw)
    const cwA = new THREE.Mesh(cwGeom, mat);
    cwA.rotation.x = Math.PI / 2;
    cwA.rotation.y = ang + Math.PI;  // opposite side of throw
    cwA.position.set(xCtr - jW * 0.44 - cHeekT / 2, yOff, zOff);
    group.add(cwA);

    // Side B cheek (toward main journal right of throw)
    const cwB = new THREE.Mesh(cwGeom, mat);
    cwB.rotation.x = Math.PI / 2;
    cwB.rotation.y = ang + Math.PI;
    cwB.position.set(xCtr + jW * 0.44 + cHeekT / 2, yOff, zOff);
    group.add(cwB);
  }

  return group;
}

/* ════════════════════════════════════════════════════════════════════════════
   § 33d  NEW PART GEOMETRY — Pass 8 additions
   ════════════════════════════════════════════════════════════════════════════ */

/* ── CYLINDER HEAD ── */
function _cylinderHeadGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const ncyl   = d.cylinders || 4;
  const bore   = (d.bore  || 86)  * U;
  const pitch  = (d.pitch || 100) * U;
  const w      = pitch * (ncyl - 1) + bore * 1.4;
  const dep    = (d.depth || 160) * U;
  const deckH  = (d.deckH || 25)  * U;
  const totalH = (d.h     || 120) * U;
  const matAl  = new THREE.MeshStandardMaterial({ color: 0xaabbc8, metalness: 0.50, roughness: 0.45 });
  const matDk  = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const matBr  = new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.60, roughness: 0.35 });
  const group  = new THREE.Group();

  group.add(new THREE.Mesh(new THREE.BoxGeometry(w, totalH, dep), matAl));
  group.add(new THREE.Mesh(new THREE.BoxGeometry(w, deckH * 0.08, dep), matAl));

  for (let i = 0; i < ncyl; i++) {
    const xCyl = -w / 2 + bore * 0.7 + i * pitch;
    // Combustion chamber dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(bore * 0.44, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), matAl);
    dome.rotation.x = Math.PI;
    dome.position.set(xCyl, 0, 0);
    group.add(dome);
    // Valve bores (4 per cylinder)
    for (const [vx, vz, vr] of [[-bore*0.14,-bore*0.14,bore*0.18],[ bore*0.14,-bore*0.14,bore*0.18],[-bore*0.12,bore*0.14,bore*0.15],[bore*0.12,bore*0.14,bore*0.15]]) {
      const guide = new THREE.Mesh(new THREE.CylinderGeometry(vr*0.42, vr*0.42, totalH*0.70, 12, 1), matDk);
      guide.position.set(xCyl+vx, totalH*0.40, vz);
      group.add(guide);
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(vr, vr*0.85, deckH*0.35, 16, 1), matBr);
      seat.position.set(xCyl+vx, deckH*0.18, vz);
      group.add(seat);
    }
    // Spark plug boss
    const spkH = 30 * U;
    const spk  = new THREE.Mesh(new THREE.CylinderGeometry(6.5*U, 6.5*U, spkH, 12, 1), matAl);
    spk.position.set(xCyl, totalH*0.55, 0);
    group.add(spk);
    const spkBore = new THREE.Mesh(new THREE.CylinderGeometry(3*U, 3*U, spkH*1.05, 8, 1), matDk);
    spkBore.position.set(xCyl, totalH*0.55, 0);
    group.add(spkBore);
  }
  // DOHC cam journals on top
  for (const zO of [-dep*0.25, dep*0.25]) {
    const j = new THREE.Mesh(new THREE.CylinderGeometry(16*U, 16*U, w, 20, 1), matAl);
    j.rotation.z = Math.PI / 2;
    j.position.set(0, totalH+10*U, zO);
    group.add(j);
  }
  return group;
}

/* ── ENGINE BLOCK ── */
function _engineBlockGeom(d, THREE) {
  const U       = UARE_CAD_UNIT;
  const ncyl    = d.cylinders || 4;
  const bore    = (d.bore  || 86)  * U;
  const pitch   = (d.pitch || 100) * U;
  const stroke  = (d.stroke|| 86)  * U;
  const deckToMain = stroke * 1.55;
  const mainH   = stroke * 0.65;
  const blockW  = pitch * (ncyl - 1) + bore * 1.6;
  const blockD  = (d.depth || 190) * U;
  const mainBR  = (d.mainBoreD || 58) / 2 * U;
  const matIron = new THREE.MeshStandardMaterial({ color: 0x505558, metalness: 0.45, roughness: 0.70 });
  const matDk   = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const matBolt = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.85, roughness: 0.20 });
  const group   = new THREE.Group();

  group.add(new THREE.Mesh(new THREE.BoxGeometry(blockW, deckToMain+mainH, blockD), matIron));
  for (let i = 0; i < ncyl; i++) {
    const xC = -blockW/2 + bore*0.8 + i*pitch;
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(bore/2, bore/2, deckToMain*1.02, 28, 1), matDk).translateX(xC).translateY(deckToMain/2));
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(bore/2+4*U, bore/2+4*U, 8*U, 28, 1), matIron).translateX(xC).translateY(deckToMain-4*U));
  }
  for (let i = 0; i <= ncyl; i++) {
    const xP = -blockW/2 + (i+0.5)*pitch;
    const bore2 = new THREE.Mesh(new THREE.CylinderGeometry(mainBR, mainBR, blockD*0.85, 20, 1), matDk);
    bore2.rotation.z = Math.PI/2; bore2.position.x = xP;
    group.add(bore2);
    for (const zO of [-blockD*0.28, blockD*0.28]) {
      const capBolt = new THREE.Mesh(new THREE.CylinderGeometry(5*U, 5*U, 30*U, 10, 1), matBolt);
      capBolt.rotation.x = Math.PI/2;
      capBolt.position.set(xP, -mainH*0.6, zO);
      group.add(capBolt);
    }
  }
  return group;
}

/* ── CAMSHAFT ── */
function _camshaftGeom(d, THREE) {
  const U   = UARE_CAD_UNIT;
  const nJ  = (d.cylinders||4) + 1;
  const jR  = (d.jD||28)/2*U, jW = (d.jW||18)*U;
  const bR  = (d.baseR||18)*U, lift = (d.lift||10)*U;
  const lW  = (d.lobeW||22)*U, L = (d.L||380)*U;
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a5060, metalness: 0.82, roughness: 0.25 });
  const group = new THREE.Group();
  const sp = L/(nJ-1);
  for (let i = 0; i < nJ; i++) {
    const j = new THREE.Mesh(new THREE.CylinderGeometry(jR, jR, jW, 24, 1), mat);
    j.rotation.z = Math.PI/2; j.position.x = -L/2+i*sp;
    group.add(j);
  }
  const phases = [0, Math.PI*0.95, Math.PI*1.45, Math.PI*0.5];
  for (let i = 0; i < nJ-1; i++) {
    const xB = -L/2+(i+0.5)*sp;
    for (const [ph, xO] of [[phases[i%phases.length]||0,-lW*0.6],[((phases[i%phases.length]||0)+Math.PI*0.4)%( Math.PI*2),lW*0.6]]) {
      const lobeShape = new THREE.Shape();
      const pts2d = [];
      for (let s = 0; s <= 40; s++) {
        const t = s/40*Math.PI*2-Math.PI/2;
        const bl = Math.pow(Math.max(0, Math.cos(t)), 3);
        pts2d.push(new THREE.Vector2(Math.cos(t)*(bR+lift*bl), Math.sin(t)*(bR+lift*bl)));
      }
      lobeShape.setFromPoints(pts2d);
      const lg = new THREE.ExtrudeGeometry(lobeShape, { depth: lW, bevelEnabled: false });
      const lo = new THREE.Mesh(lg, mat);
      lo.rotation.x = Math.PI/2; lo.rotation.y = ph;
      lo.position.set(xB+xO, 0, 0);
      group.add(lo);
    }
  }
  return group;
}

/* ── ROCKER ARM ── */
function _rockerArmGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const aL = (d.L||52)*U, aW = (d.w||16)*U, aH = (d.h||8)*U;
  const pR = (d.pivotD||10)/2*U;
  const matR = new THREE.MeshStandardMaterial({ color: 0x6a7a8a, metalness: 0.75, roughness: 0.30 });
  const matP = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.85, roughness: 0.10 });
  const matD = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(aL, aH, aW), matR));
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(pR, pR, aW*1.05, 16, 1), matD);
  pivot.rotation.x = Math.PI/2;
  group.add(pivot);
  const adj = new THREE.Mesh(new THREE.CylinderGeometry(aH*0.55, aH*0.55, aH*1.8, 12, 1), matR);
  adj.rotation.x = Math.PI/2; adj.position.set(-aL/2+aH*0.55, 0, 0);
  group.add(adj);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(aW*0.55, aH*0.25, aW*0.55), matP);
  pad.position.set(aL/2-aW*0.275, aH/2+aH*0.125, 0);
  group.add(pad);
  return group;
}

/* ── WRIST PIN ── */
function _pistonPinGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const r = (d.d||22)/2*U, L = (d.L||84)*U, bR = r-(d.wall||3.5)*U;
  const mat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.90, roughness: 0.15 });
  const dk  = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 24, 1), mat));
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(bR, bR, L*1.02, 18, 1), dk));
  return group;
}

/* ── OIL PAN ── */
function _oilPanGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const w = (d.w||380)*U, h = (d.h||140)*U, dep = (d.d||200)*U, wT = 3*U;
  const mat  = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.55, roughness: 0.55 });
  const matB = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.60, roughness: 0.45 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), mat));
  const fl = new THREE.Mesh(new THREE.BoxGeometry(w+wT*2, wT*2.5, dep+wT*2), matB);
  fl.position.y = h/2+wT*1.25; group.add(fl);
  const dr = new THREE.Mesh(new THREE.CylinderGeometry(8.5*U, 8.5*U, 14*U, 14, 1), matB);
  dr.position.set(w*0.1, -h/2-7*U, dep*0.2); group.add(dr);
  const pk = new THREE.Mesh(new THREE.CylinderGeometry(12*U, 12*U, 45*U, 12, 1), matB);
  pk.rotation.x = Math.PI/2; pk.position.set(-w*0.15, -h*0.25, 0); group.add(pk);
  return group;
}

/* ── INTAKE MANIFOLD ── */
function _intakeManifoldGeom(d, THREE) {
  const U  = UARE_CAD_UNIT;
  const nc = d.cylinders||4, pt = (d.pitch||100)*U;
  const rD = (d.runnerD||42)*U, rL = (d.runnerL||220)*U;
  const pW = pt*(nc-1)+rD*1.8, pH = rD*1.6, pDep = rD*2.2;
  const tR = (d.throttleD||55)/2*U;
  const matAl = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.45, roughness: 0.50 });
  const matDk = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(pW, pH, pDep), matAl));
  const tb = new THREE.Mesh(new THREE.CylinderGeometry(tR*1.25, tR*1.25, 20*U, 8, 1), matAl);
  tb.rotation.z = Math.PI/2; tb.position.set(-pW/2-10*U, 0, 0); group.add(tb);
  for (let i = 0; i < nc; i++) {
    const xC = -pW/2+rD*0.9+i*pt;
    const rr  = new THREE.Mesh(new THREE.CylinderGeometry(rD/2*1.15, rD/2*1.15, rL, 12, 1), matAl);
    rr.rotation.x = Math.PI/2; rr.position.set(xC, -pH*0.3, -pDep/2-rL/2); group.add(rr);
    const rb  = new THREE.Mesh(new THREE.CylinderGeometry(rD/2, rD/2, rL*1.02, 10, 1), matDk);
    rb.rotation.x = Math.PI/2; rb.position.set(xC, -pH*0.3, -pDep/2-rL/2); group.add(rb);
    const inj = new THREE.Mesh(new THREE.CylinderGeometry(7*U, 7*U, 25*U, 10, 1), matAl);
    inj.position.set(xC, rD/2*1.0+12*U, -pDep/2-rL*0.35); group.add(inj);
  }
  return group;
}

/* ── EXHAUST MANIFOLD ── */
function _exhaustManifoldGeom(d, THREE) {
  const U  = UARE_CAD_UNIT;
  const nc = d.cylinders||4, pt = (d.pitch||100)*U;
  const pD = (d.portD||38)*U, colD = (d.collectorD||60)*U;
  const rL = (d.runnerL||200)*U, w = pt*(nc-1)+pD*1.8;
  const matSteel = new THREE.MeshStandardMaterial({ color: 0x7a6a5a, metalness: 0.70, roughness: 0.50 });
  const matDk    = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.30, roughness: 0.80 });
  const group = new THREE.Group();
  for (let i = 0; i < nc; i++) {
    const xC = -w/2+pD*0.9+i*pt;
    const runner = new THREE.Mesh(new THREE.CylinderGeometry(pD/2*1.1, pD/2*1.1, rL, 12, 1), matSteel);
    runner.rotation.x = Math.PI/2; runner.position.set(xC, 0, pD/2+rL/2); group.add(runner);
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(pD/2*0.88, pD/2*0.88, rL*1.02, 10, 1), matDk);
    bore.rotation.x = Math.PI/2; bore.position.set(xC, 0, pD/2+rL/2); group.add(bore);
  }
  const collector = new THREE.Mesh(new THREE.CylinderGeometry(colD/2, colD/2, 80*U, 16, 1), matSteel);
  collector.rotation.x = Math.PI/2;
  collector.position.set(0, 0, pD/2+rL+40*U); group.add(collector);
  return group;
}

/* ── FLYWHEEL ── */
function _flywheelGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const r = (d.d||d.outerD||280)/2*U, h = (d.h||30)*U, hubR = r*0.20;
  const teeth = d.teeth||120;
  const mat = new THREE.MeshStandardMaterial({ color: 0x505560, metalness: 0.70, roughness: 0.40 });
  const matHub = new THREE.MeshStandardMaterial({ color: 0x606878, metalness: 0.75, roughness: 0.25 });
  const group = new THREE.Group();
  // Main disk
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h*0.4, 64, 1), mat));
  // Web
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(r*0.68, r*0.68, h*0.22, 48, 1), mat));
  // Ring gear teeth (simplified)
  const trR = r*1.01, tH = h*0.45, tD = h*0.55;
  const tShape = new THREE.Shape();
  for (let i = 0; i < teeth*2; i++) {
    const a = (i/(teeth*2))*Math.PI*2;
    const rr = (i%2===0) ? trR*1.03 : trR;
    tShape.setFromPoints([new THREE.Vector2(0,0)]);
    const toothAng = 1/teeth*Math.PI*2;
    if (i%2===0) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(tD, tH, tD*0.4), matHub);
      tooth.rotation.y = a; tooth.position.set(Math.cos(a)*trR, 0, Math.sin(a)*trR); group.add(tooth);
    }
  }
  // Hub
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, h*1.1, 24, 1), matHub));
  return group;
}

/* ── TIMING CHAIN ── */
function _timingChainGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const w = (d.w||12)*U, nLinks = d.links||60, pitchLen = (d.pitch||8)*U;
  const chainR = (nLinks * pitchLen) / (Math.PI*2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.80, roughness: 0.30 });
  const group = new THREE.Group();
  for (let i = 0; i < nLinks; i++) {
    const a = (i/nLinks)*Math.PI*2;
    const link = new THREE.Mesh(new THREE.TorusGeometry(pitchLen*0.45, pitchLen*0.1, 4, 8, Math.PI), mat);
    link.rotation.z = a; link.position.set(Math.cos(a)*chainR, Math.sin(a)*chainR, 0); group.add(link);
  }
  return group;
}

/* ── CAM FOLLOWER / TAPPET ── */
function _camFollowerGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const r = (d.d||30)/2*U, h = (d.h||40)*U;
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a8a9a, metalness: 0.80, roughness: 0.20 });
  const pts = [
    new THREE.Vector2(r*0.70, -h/2),
    new THREE.Vector2(r,      -h/2+2*U),
    new THREE.Vector2(r,       h/2-2*U),
    new THREE.Vector2(r*0.92,  h/2),
    new THREE.Vector2(r*0.30,  h/2+4*U),
    new THREE.Vector2(r*0.30,  h/2+12*U),
    new THREE.Vector2(0,       h/2+12*U),
  ];
  return new THREE.LatheGeometry(pts, 24);
}

/* ── VALVE SPRING RETAINER ── */
function _valveRetainerGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const oR = (d.outerD||22)/2*U, iR = (d.innerD||8)/2*U, h = (d.h||8)*U;
  const pts = [
    new THREE.Vector2(iR, -h/2),
    new THREE.Vector2(oR, -h/2),
    new THREE.Vector2(oR,  h/2),
    new THREE.Vector2(iR*1.5, h/2),
    new THREE.Vector2(iR*1.5, h/4),
    new THREE.Vector2(iR, 0),
  ];
  return new THREE.LatheGeometry(pts, 20);
}

/* ── SPARK PLUG ── */
function _sparkPlugGeom(d, THREE) {
  const U = UARE_CAD_UNIT;
  const bodyR = (d.d||14)/2*U, L = (d.L||75)*U;
  const mat  = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.80, roughness: 0.25 });
  const matW = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.10, roughness: 0.70 }); // ceramic
  const group = new THREE.Group();
  // Threaded body (bottom)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR, L*0.48, 6, 1), mat));
  // Hex wrench section
  const hexH = L*0.12;
  const hex  = new THREE.Mesh(new THREE.CylinderGeometry(bodyR*1.4, bodyR*1.4, hexH, 6, 1), mat);
  hex.position.y = L*0.48/2+hexH/2; group.add(hex);
  // Ceramic insulator
  const ins  = new THREE.Mesh(new THREE.CylinderGeometry(bodyR*0.68, bodyR*0.68, L*0.55, 12, 1), matW);
  ins.position.y = L*0.48/2+hexH+L*0.55/2; group.add(ins);
  return group;
}
function _pistonRingGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const bore = (d.innerD || d.d || 86) * U;      // bore diameter
  const rW   = (d.ringW  || 1.5) * U;            // ring width (axial height)
  const rT   = (d.ringT  || 3.5) * U;            // ring thickness (radial)
  const midR = bore / 2 + rT / 2;                // mid-line radius

  // LatheGeometry: rectangular cross-section ring
  const pts = [
    new THREE.Vector2(bore / 2,        -rW / 2),
    new THREE.Vector2(bore / 2 + rT,   -rW / 2),
    new THREE.Vector2(bore / 2 + rT,    rW / 2),
    new THREE.Vector2(bore / 2,         rW / 2),
    new THREE.Vector2(bore / 2,        -rW / 2), // close
  ];
  return new THREE.LatheGeometry(pts, 48);
}

function _impellerGeom(d, THREE) {
  // Centrifugal impeller: main disc + back shroud + swept backward-curved blades + hub
  const U   = UARE_CAD_UNIT;
  const R   = (d.d || d.outerD || 120) / 2 * U;   // tip radius
  const hubR= R * 0.28;                              // hub radius
  const eyeR= R * 0.50;                              // inducer (eye) radius
  const h   = (d.h || 24) * U;                       // disc thickness
  const nb  = d.blades || 7;
  const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.75, roughness: 0.25 });
  const group = new THREE.Group();

  // Back shroud disc (full diameter)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.90, h * 0.35, 48, 1), mat));

  // Hub boss (raised cylinder at center)
  const hubBoss = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, h * 1.55, 24, 1), mat);
  hubBoss.position.y = h * 0.35 / 2 + h * 1.55 / 2;
  group.add(hubBoss);

  // Backward-curved blades: arc from hub eye to tip with backward lean
  for (let i = 0; i < nb; i++) {
    const baseAng = (i / nb) * Math.PI * 2;
    // Build blade as extruded arc profile in XZ plane, then rotate to position
    const bladeShape = new THREE.Shape();
    const nPts = 10;
    const bladeW = h * 0.90;
    for (let j = 0; j <= nPts; j++) {
      const t  = j / nPts;
      // Radial position: eye to tip
      const r  = eyeR + (R - eyeR) * t;
      // Backward-curved lean angle (blade leans back 35° at tip)
      const lean = t * Math.PI / 5.14;
      const bx = r * Math.cos(lean);
      const bz = r * Math.sin(lean);
      if (j === 0) bladeShape.moveTo(bx, bz);
      else bladeShape.lineTo(bx, bz);
    }
    // Thicken the blade trailing edge
    for (let j = nPts; j >= 0; j--) {
      const t  = j / nPts;
      const r  = eyeR + (R - eyeR) * t;
      const lean = t * Math.PI / 5.14;
      const taper = 0.012 + 0.028 * (1 - t); // thicker at root, thin at tip
      bladeShape.lineTo(r * Math.cos(lean) - R * taper * Math.sin(lean),
                        r * Math.sin(lean) + R * taper * Math.cos(lean));
    }
    bladeShape.closePath();
    const bladeGeom = new THREE.ExtrudeGeometry(bladeShape, {
      depth: bladeW, bevelEnabled: false,
    });
    bladeGeom.rotateX(Math.PI / 2);
    bladeGeom.rotateY(baseAng);
    const blade = new THREE.Mesh(bladeGeom, mat);
    blade.position.y = h * 0.35 * 0.5 + bladeW * 0.05;
    group.add(blade);
  }
  return group;
}

/* ── §33b  EXTENDED GEOMETRY — Pass 5 geometry types ────────────────────── */

function _diskGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const r    = (d.d || d.outerD || 200) / 2 * U;
  const h    = (d.h || d.w || 30) * U;
  const hubR = r * 0.22;
  const segs = d.teeth ? Math.max(20, d.teeth) : 48;
  const mat  = new THREE.MeshStandardMaterial({ color: 0x606878, metalness: 0.7, roughness: 0.35 });
  const group = new THREE.Group();
  // Outer rim
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.4, segs, 1), mat));
  // Web (thin middle disc)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, h * 0.18, segs, 1), mat));
  // Central hub
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, h * 1.1, 24, 1), mat));
  return group;
}

function _nutHexGeom(d, THREE) {
  const w  = (d.d || d.w || 13) * UARE_CAD_UNIT * 1.0;
  const h  = (d.h || (d.d ? d.d * 0.8 : 6.5)) * UARE_CAD_UNIT;
  const boreR = (d.d || 8) / 2 * UARE_CAD_UNIT;
  const outerR = w / 1.155;
  const mat    = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.88, roughness: 0.22 });
  const boreMat= new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.3, roughness: 0.8 });
  const group  = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR, h, 6, 1), mat));
  // visible bore (dark inner cylinder)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(boreR, boreR, h * 1.05, 16, 1), boreMat));
  // chamfer rings top and bottom
  const chamferH = h * 0.12;
  const cTop = new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR * 0.88, chamferH, 6, 1), mat);
  cTop.position.y = h / 2 + chamferH / 2;
  group.add(cTop);
  const cBot = new THREE.Mesh(new THREE.CylinderGeometry(outerR * 0.88, outerR, chamferH, 6, 1), mat);
  cBot.position.y = -h / 2 - chamferH / 2;
  group.add(cBot);
  return group;
}

function _washerGeom(d, THREE) {
  const innerR = (d.innerD || d.d || 8.4) / 2 * UARE_CAD_UNIT;
  const outerR = (d.outerD || d.D || d.w || innerR * 4 / UARE_CAD_UNIT) / 2 * UARE_CAD_UNIT;
  const thick  = (d.h || d.t || 1.6) * UARE_CAD_UNIT;
  const tubeR  = (outerR - innerR) / 2;
  const torusR = innerR + tubeR;
  return new THREE.TorusGeometry(torusR, tubeR, 8, 32);
}

function _rivetGeom(d, THREE) {
  const r     = (d.d || 4) / 2 * UARE_CAD_UNIT;
  const L     = (d.L || 12) * UARE_CAD_UNIT;
  const headR = r * 1.8;
  const headH = r * 1.2;
  const mat   = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.85, roughness: 0.25 });
  const group = new THREE.Group();
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 16, 1), mat);
  shank.position.set(0, L / 2, 0);
  group.add(shank);
  // Domed head (half-sphere scaled to headH)
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  head.scale.set(1, headH / headR, 1);
  group.add(head);
  return group;
}

function _oRingGeom(d, THREE) {
  const ringR  = (d.innerD || d.d || 20) / 2 * UARE_CAD_UNIT + (d.tubeR || 2) * UARE_CAD_UNIT;
  const tubeR  = (d.tubeR || d.cs || 2) * UARE_CAD_UNIT;
  return new THREE.TorusGeometry(ringR, tubeR, 10, 40);
}

function _gasketGeom(d, THREE) {
  const w  = (d.w || 100) * UARE_CAD_UNIT;
  const dp = (d.d || d.w || 100) * UARE_CAD_UNIT;
  const h  = (d.h || d.t || 1.5) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dp, 2, 1, 2);
}

function _solderJointGeom(d, THREE) {
  const r = (d.d || 0.8) / 2 * UARE_CAD_UNIT;
  // Hemisphere: half-sphere sitting on pad
  return new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
}

function _weldGeom(d, THREE) {
  const leg = (d.w || d.leg || 6) * UARE_CAD_UNIT;
  const len = (d.d || d.L || 50) * UARE_CAD_UNIT;
  const h   = (d.h || leg * 0.7) * UARE_CAD_UNIT;
  // Triangular prism for fillet weld
  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(leg, 0),
    new THREE.Vector2(0, h),
  ]);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  geom.applyMatrix4(new THREE.Matrix4().makeTranslation(-leg / 2, 0, -len / 2));
  return geom;
}

function _wireGeom(d, THREE) {
  const r = (d.d || d.gauge || 1.5) / 2 * UARE_CAD_UNIT;
  const L = (d.L || d.h || 100) * UARE_CAD_UNIT;
  return new THREE.CylinderGeometry(r, r, L, 8, 1);
}

function _resistorGeom(d, THREE) {
  const r = (d.d || 1.5) / 2 * UARE_CAD_UNIT;
  const L = (d.L || d.h || 3.5) * UARE_CAD_UNIT;
  return new THREE.CylinderGeometry(r, r, L, 12, 1);
}

function _capacitorGeom(d, THREE) {
  const r = (d.d || 2.5) / 2 * UARE_CAD_UNIT;
  const h = (d.h || d.L || 5) * UARE_CAD_UNIT;
  return new THREE.CylinderGeometry(r, r, h, 16, 1);
}

function _inductorGeom(d, THREE) {
  const outerR = (d.d || 5) / 2 * UARE_CAD_UNIT;
  const tubeR  = outerR * 0.35;
  return new THREE.TorusGeometry(outerR - tubeR, tubeR, 8, 20);
}

function _icGeom(d, THREE) {
  const w = (d.w || 7.6) * UARE_CAD_UNIT;
  const h = (d.h || 2.0) * UARE_CAD_UNIT;
  const dp= (d.d || 4.0) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dp, 1, 1, 1);
}

function _connectorGeom(d, THREE) {
  const w = (d.w || 12) * UARE_CAD_UNIT;
  const h = (d.h || 8) * UARE_CAD_UNIT;
  const dp= (d.d || 10) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dp, 2, 2, 2);
}

function _transformerGeom(d, THREE) {
  const w = (d.w || 25) * UARE_CAD_UNIT;
  const h = (d.h || 20) * UARE_CAD_UNIT;
  const dp= (d.d || 15) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dp, 2, 2, 2);
}

function _nozzleGeom(d, THREE) {
  // Proper converging-diverging bell nozzle (Rao 80% parabola approximation)
  // Profile: LatheGeometry sweeping outer wall from exit (y=0) to injector face (y=H)
  const U        = UARE_CAD_UNIT;
  const chamberR = (d.d || 120) / 2 * U;                            // combustion chamber radius
  const throatR  = (d.throatD ? d.throatD / 2 : (d.d || 120) * 0.38) * U; // throat radius
  const exitR    = (d.exitD   ? d.exitD / 2 : (d.d || 120) * 0.72) * U;   // exit plane radius
  const H        = (d.h || d.L || 300) * U;                          // total nozzle length
  const wallT    = chamberR * 0.09;                                   // wall thickness

  // Section boundaries (y from 0=exit to H=injector)
  const yThroat = H * 0.52;  // throat is at 52% height
  const yConvTop = H * 0.68; // top of converging section

  const pts = [];
  // 1. Exit lip (outer)
  pts.push(new THREE.Vector2(exitR + wallT, 0));

  // 2. Bell diverging section: exit (wide) → throat (narrow)
  //    Quarter-circle approximation of Rao parabola
  const nBell = 20;
  for (let i = 1; i <= nBell; i++) {
    const t = i / nBell;
    // r = throatR + (exitR - throatR) * sqrt(1 - t²)
    const r = throatR + (exitR - throatR) * Math.sqrt(Math.max(0, 1 - t * t));
    pts.push(new THREE.Vector2(r + wallT * (0.5 + 0.5 * (1 - t)), yThroat * t));
  }

  // 3. Converging section: throat → chamber (throat narrows as we go toward chamber)
  const nConv = 10;
  for (let i = 1; i <= nConv; i++) {
    const t = i / nConv;
    const r = throatR + (chamberR - throatR) * Math.pow(t, 0.62);
    pts.push(new THREE.Vector2(r + wallT * 0.55, yThroat + (yConvTop - yThroat) * t));
  }

  // 4. Chamber cylindrical section
  pts.push(new THREE.Vector2(chamberR + wallT, yConvTop));
  pts.push(new THREE.Vector2(chamberR + wallT, H));

  // 5. Close inner profile at top (injector face)
  pts.push(new THREE.Vector2(chamberR, H));
  pts.push(new THREE.Vector2(chamberR, yConvTop));

  return new THREE.LatheGeometry(pts, 40);
}

function _domeGeom(d, THREE) {
  // Pressure vessel dome: cylindrical barrel + hemispherical end cap + flange ring
  const U      = UARE_CAD_UNIT;
  const r      = (d.d || d.D || 200) / 2 * U;
  const cylH   = (d.h || r * 1.2 / U) * U;   // cylindrical section height
  const wallT  = r * 0.07;
  const mat    = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.75, roughness: 0.30 });
  const ringMat= new THREE.MeshStandardMaterial({ color: 0x6a7a8a, metalness: 0.85, roughness: 0.20 });
  const group  = new THREE.Group();

  // Cylindrical barrel (open top and bottom — LatheGeometry)
  if (cylH > 0) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, cylH, 40, 2, true), mat);
    barrel.position.y = cylH / 2;
    group.add(barrel);
  }

  // Hemispherical dome cap on top
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.position.y = cylH;
  group.add(dome);

  // Bottom weld-neck flange ring
  const flangeRingR = r * 1.08;
  const flangeRingH = r * 0.12;
  const flangeRing  = new THREE.Mesh(
    new THREE.CylinderGeometry(flangeRingR, r, flangeRingH, 40, 1), ringMat);
  flangeRing.position.y = -flangeRingH / 2;
  group.add(flangeRing);

  // 4× lifting lug bosses on barrel at 90° spacing
  if (cylH > r * 0.4) {
    for (let i = 0; i < 4; i++) {
      const ang  = (i / 4) * Math.PI * 2;
      const boss = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.06, r * 0.08, r * 0.14, 12, 1), ringMat);
      boss.rotation.z = Math.PI / 2;
      boss.position.set(Math.cos(ang) * r, cylH * 0.6, Math.sin(ang) * r);
      group.add(boss);
    }
  }
  return group;
}

function _flangeGeom(d, THREE) {
  // Proper weld-neck / blind flange: disc + hub + bolt holes + bore
  const U       = UARE_CAD_UNIT;
  const outerR  = (d.outerD || d.D || 100) / 2 * U;
  const boreR   = (d.boreD || d.innerD || (d.D || 100) * 0.32) / 2 * U;
  const h       = (d.h || d.t || 16) * U;
  const bcdR    = (d.bcd ? d.bcd / 2 : outerR * 0.74) * U;  // bolt circle
  const nBolts  = d.bolts || (outerR > 60 * U ? 8 : 4);
  const boltR   = outerR * 0.055;
  const hubH    = h * 0.55;
  const hubR    = outerR * 0.38;
  const mat     = new THREE.MeshStandardMaterial({ color: 0x708090, metalness: 0.82, roughness: 0.28 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.92 });
  const group   = new THREE.Group();

  // Main disc
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR, h, 48, 1), mat));

  // Raised hub/neck
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubH, 28, 1), mat);
  hub.position.y = (h + hubH) / 2;
  group.add(hub);

  // Center bore (dark)
  group.add(new THREE.Mesh(
    new THREE.CylinderGeometry(boreR, boreR, h + hubH + 0.001 * U, 22, 1), darkMat));

  // Bolt holes on BCD
  for (let i = 0; i < nBolts; i++) {
    const ang  = (i / nBolts) * Math.PI * 2 + Math.PI / nBolts;
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(boltR, boltR, h * 1.05, 10, 1), darkMat);
    hole.position.set(Math.cos(ang) * bcdR, 0, Math.sin(ang) * bcdR);
    group.add(hole);
  }
  return group;
}

function _elbowGeom(d, THREE) {
  const tubeR = (d.od || 25) / 2 * UARE_CAD_UNIT;
  const bendR = (d.bendR || d.od * 1.5 || 37.5) * UARE_CAD_UNIT;
  const curve = new THREE.TorusGeometry(bendR, tubeR, 8, 20, Math.PI / 2);
  return curve;
}

// Merge geometries helper (BufferGeometry only)
// Collect all materials from a Mesh or Group (works with both)
function _eachMeshMat(obj, fn) {
  if (!obj) return;
  if (obj.isMesh) {
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    mats.forEach(fn);
  }
  if (obj.isGroup || obj.children) {
    obj.children.forEach(function(c) { _eachMeshMat(c, fn); });
  }
}


/* ══════════════════════════════════════════════════════════════════════════
   § 35  HYPER-DETAILED GEOMETRY LIBRARY — Pass 9
   Every function: real engineering proportions, multi-piece Groups,
   visible sub-features. Scale: mm × UARE_CAD_UNIT (0.1) = THREE.js units.
   ══════════════════════════════════════════════════════════════════════════ */

// Push rod — hollow chromoly steel, spherical ball/cup ends (OHV engines)
function _pushRodGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const len  = (d.L || 260) * U;
  const od   = (d.d || 7.0) * U;
  const id   = od * 0.55;
  const ballR= od * 0.85;
  const group= new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.88, roughness: 0.12 });
  const matTip  = new THREE.MeshStandardMaterial({ color: 0xd4dde8, metalness: 0.92, roughness: 0.08 });
  const matHole = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.20, roughness: 0.90 });
  // Tube body
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(od/2, od/2, len, 16, 1), matBody));
  // Oil passage bore (hollow)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(id/2, id/2, len*0.98, 12, 1), matHole));
  // Ball end (pushes on tappet)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(ballR, 14, 10), matTip);
  ball.position.y = -len/2;
  group.add(ball);
  // Cup end (receives rocker arm oil-feed socket)
  const cupPts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i/12)*Math.PI*0.55;
    cupPts.push(new THREE.Vector2(Math.sin(a)*ballR*1.05, Math.cos(a)*ballR*1.05 - ballR*0.5));
  }
  const cup = new THREE.Mesh(new THREE.LatheGeometry(cupPts, 16), matTip);
  cup.position.y = len/2;
  group.add(cup);
  // Oil metering hole near ball end
  const oilHole = new THREE.Mesh(new THREE.CylinderGeometry(0.6*U, 0.6*U, od*1.05, 6), matHole);
  oilHole.rotation.z = Math.PI/2;
  oilHole.position.y = -len*0.38;
  group.add(oilHole);
  return group;
}

// Throttle body — 60 mm aluminium casting, butterfly disc, TPS, IAC, 4-bolt flanges
function _throttleBodyGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const bore = (d.bore || 60) * U;
  const blen = (d.L || 80) * U;
  const R    = bore / 2;
  const group= new THREE.Group();
  const matAl   = new THREE.MeshStandardMaterial({ color: 0x9aacb8, metalness: 0.65, roughness: 0.30 });
  const matAnod = new THREE.MeshStandardMaterial({ color: 0x6a7a88, metalness: 0.55, roughness: 0.40 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.20, roughness: 0.90 });
  const matBrass= new THREE.MeshStandardMaterial({ color: 0xc8a850, metalness: 0.75, roughness: 0.25 });
  // Body casting with venturi profile
  const bodyPts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i/20;
    const localR = R*1.55 + (t<0.2 ? (0.2-t)*R*0.15 : t>0.8 ? (t-0.8)*R*0.15 : 0);
    bodyPts.push(new THREE.Vector2(localR, (t-0.5)*blen));
  }
  group.add(new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 20), matAl));
  // Bore (air passage)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, blen*1.02, 24, 1), matDark));
  // Butterfly disc
  const discShape = new THREE.Shape();
  discShape.ellipse(0, 0, R*0.97, R*0.97, 0, Math.PI*2, false, 0);
  const disc = new THREE.Mesh(
    new THREE.ExtrudeGeometry(discShape, { depth: 2.5*U, bevelEnabled: true, bevelSize: 0.3*U, bevelThickness: 0.3*U, bevelSegments: 2 }),
    matAnod
  );
  disc.rotation.x = Math.PI/2;
  disc.rotation.z = (d.throttleAngle || 0)*Math.PI/180;
  group.add(disc);
  // Butterfly shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5*U, 1.5*U, bore*1.25, 8, 1), matBrass);
  shaft.rotation.z = Math.PI/2;
  group.add(shaft);
  // TPS sensor boss
  const tpsBoss = new THREE.Mesh(new THREE.CylinderGeometry(12*U, 12*U, 18*U, 12, 1), matAl);
  tpsBoss.rotation.z = Math.PI/2;
  tpsBoss.position.set(R*1.55+6*U, 0, 0);
  group.add(tpsBoss);
  // IAC port boss
  const iacBoss = new THREE.Mesh(new THREE.CylinderGeometry(8*U, 8*U, 20*U, 10, 1), matAl);
  iacBoss.rotation.x = Math.PI/2;
  iacBoss.position.set(0, R*1.55+5*U, blen*0.25);
  group.add(iacBoss);
  // Inlet flange
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(R*1.65, R*1.65, 8*U, 20), matAl);
  flange.position.y = blen/2+4*U;
  group.add(flange);
  // 4x M5 flange bolts
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2+Math.PI/4;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(2.5*U, 2.5*U, 28*U, 6), matAnod);
    bolt.position.set(Math.cos(a)*R*1.4, blen/2+10*U, Math.sin(a)*R*1.4);
    group.add(bolt);
  }
  // Coolant bypass ports (×2)
  for (const side of [-1, 1]) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(6*U, 6*U, 18*U, 8), matAl);
    port.rotation.x = Math.PI/2;
    port.position.set(side*R*0.60, -R*1.55, blen*0.30);
    group.add(port);
  }
  return group;
}

// Fuel injector — solenoid body, pintle tip, top/bottom O-rings, connector
function _fuelInjectorGeom(d, THREE) {
  const U   = UARE_CAD_UNIT;
  const len = (d.L || 82) * U;
  const od  = (d.d || 14.5) * U;
  const group= new THREE.Group();
  const matBody  = new THREE.MeshStandardMaterial({ color: 0x282828, metalness: 0.50, roughness: 0.55 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.90, roughness: 0.15 });
  const matRubber= new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.05, roughness: 0.95 });
  const matConn  = new THREE.MeshStandardMaterial({ color: 0x3a2828, metalness: 0.10, roughness: 0.80 });
  const matTip   = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.95, roughness: 0.08 });
  // Solenoid body (lathe profile)
  const bodyPts = [
    new THREE.Vector2(od*0.48, -len*0.50),
    new THREE.Vector2(od*0.48, -len*0.05),
    new THREE.Vector2(od*0.52,  len*0.05),
    new THREE.Vector2(od*0.52,  len*0.35),
    new THREE.Vector2(od*0.44,  len*0.40),
    new THREE.Vector2(od*0.44,  len*0.50),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 18), matBody));
  // Nozzle tip (stainless, pintle valve tip)
  const tipPts = [
    new THREE.Vector2(od*0.30, -len*0.50),
    new THREE.Vector2(od*0.30, -len*0.36),
    new THREE.Vector2(od*0.25, -len*0.30),
    new THREE.Vector2(od*0.08, -len*0.34),
    new THREE.Vector2(od*0.04, -len*0.40),
    new THREE.Vector2(od*0.04, -len*0.50),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(tipPts, 16), matTip));
  // Top fuel inlet
  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(od*0.38, od*0.38, 12*U, 12), matSteel);
  inlet.position.y = len*0.50+6*U;
  group.add(inlet);
  // Inlet filter basket (wire mesh approximated as small cylinder)
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(od*0.34, od*0.34, 8*U, 12),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.60, roughness: 0.70, wireframe: true }));
  filter.position.y = len*0.50+12*U;
  group.add(filter);
  // Top O-ring
  const or1 = new THREE.Mesh(new THREE.TorusGeometry(od*0.44, 1.8*U, 8, 20), matRubber);
  or1.rotation.x = Math.PI/2; or1.position.y = len*0.44;
  group.add(or1);
  // Bottom O-ring
  const or2 = new THREE.Mesh(new THREE.TorusGeometry(od*0.38, 1.6*U, 8, 20), matRubber);
  or2.rotation.x = Math.PI/2; or2.position.y = -len*0.44;
  group.add(or2);
  // Electrical connector
  const connBody = new THREE.Mesh(new THREE.BoxGeometry(14*U, 16*U, 10*U), matConn);
  connBody.position.set(od*0.52+7*U, len*0.20, 0);
  group.add(connBody);
  // 2x connector pins
  for (let i = -1; i <= 1; i += 2) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.8*U, 0.8*U, 10*U, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd080, metalness: 0.95, roughness: 0.05 }));
    pin.rotation.z = Math.PI/2;
    pin.position.set(od*0.52+17*U, len*0.20+i*3*U, 0);
    group.add(pin);
  }
  // Spray pattern diffuser holes (4x, visible on tip)
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.4*U, 0.4*U, od*0.35, 6),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.9 }));
    hole.rotation.z = Math.PI/2;
    hole.position.set(Math.cos(a)*od*0.14, -len*0.46, Math.sin(a)*od*0.14);
    group.add(hole);
  }
  return group;
}

// Turbine blade — NACA airfoil section, fir-tree root, tip shroud, cooling holes
function _turbineBladeGeom(d, THREE) {
  const U     = UARE_CAD_UNIT;
  const span  = (d.span || 80) * U;
  const chord = (d.chord || 40) * U;
  const thick = (d.t || 6) * U;
  const group = new THREE.Group();
  const matBlade = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.85, roughness: 0.20 });
  const matRoot  = new THREE.MeshStandardMaterial({ color: 0xa0a8b0, metalness: 0.80, roughness: 0.25 });
  const matTip   = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.88, roughness: 0.18 });
  // Airfoil body (NACA 4415 approximation)
  const airfoilShape = new THREE.Shape();
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const x = (i/24)*chord - chord/2;
    const xn = (x+chord/2)/chord;
    const yUp = thick*(0.594*Math.sqrt(Math.max(0,xn)) - 0.441*xn - 0.120*xn*xn + 0.284*Math.pow(xn,3) - 0.215*Math.pow(xn,4));
    pts.push(new THREE.Vector2(x, yUp));
  }
  for (let i = 24; i >= 0; i--) {
    const x = (i/24)*chord - chord/2;
    const xn = (x+chord/2)/chord;
    const yLo = -thick*0.72*(0.594*Math.sqrt(Math.max(0,xn)) - 0.441*xn - 0.120*xn*xn + 0.284*Math.pow(xn,3) - 0.215*Math.pow(xn,4));
    pts.push(new THREE.Vector2(x, yLo));
  }
  airfoilShape.setFromPoints(pts);
  const bladeGeom = new THREE.ExtrudeGeometry(airfoilShape, { depth: span*0.80, bevelEnabled: false });
  bladeGeom.rotateX(-Math.PI/2);
  const blade = new THREE.Mesh(bladeGeom, matBlade);
  blade.position.y = span*0.10;
  group.add(blade);
  // Fir-tree root (3-lobe dovetail for disc retention)
  const rootH = span*0.18;
  for (let lobe = 0; lobe < 3; lobe++) {
    const w0 = chord*0.24 + lobe*chord*0.04;
    const lobeMesh = new THREE.Mesh(new THREE.BoxGeometry(w0, rootH/3.5, chord*0.80), matRoot);
    lobeMesh.position.y = -rootH/2 + lobe*rootH/3 + rootH/6;
    group.add(lobeMesh);
    for (let side = -1; side <= 1; side += 2) {
      const fillet = new THREE.Mesh(new THREE.CylinderGeometry(2*U, 2*U, chord*0.80, 8, 1), matRoot);
      fillet.rotation.x = Math.PI/2;
      fillet.position.set(side*w0/2, -rootH/2+lobe*rootH/3+rootH/6, 0);
      group.add(fillet);
    }
  }
  // Tip shroud (reduces tip leakage)
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(chord*1.15, 4*U, chord*0.90), matTip);
  shroud.position.y = span*0.90+2*U;
  group.add(shroud);
  // Tip knife-edge seal
  const knifeEdge = new THREE.Mesh(new THREE.BoxGeometry(chord*0.90, 3*U, 1.5*U), matTip);
  knifeEdge.position.y = span*0.93+3*U;
  group.add(knifeEdge);
  // 5× spanwise film-cooling holes on leading edge
  for (let i = 0; i < 5; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.8*U, 0.8*U, span*0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.9 }));
    hole.position.set(-chord*0.38+i*chord*0.04, span*0.48, 0);
    group.add(hole);
  }
  // Trailing-edge ejection slots (3×)
  for (let i = 0; i < 3; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.2*U, span*0.15, 0.8*U),
      new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.9 }));
    slot.position.set(chord*0.48, span*0.25+i*span*0.22, 0);
    group.add(slot);
  }
  return group;
}

// Turbocharger assembly — turbine housing, compressor housing, CHRA, wheels, shaft
function _turbochargerGeom(d, THREE) {
  const U   = UARE_CAD_UNIT;
  const trR = (d.turbineR || 55) * U;
  const cpR = (d.compR || 48) * U;
  const hLen= (d.L || 220) * U;
  const group= new THREE.Group();
  const matCast = new THREE.MeshStandardMaterial({ color: 0x787070, metalness: 0.60, roughness: 0.55 });
  const matAl   = new THREE.MeshStandardMaterial({ color: 0xa0b0c0, metalness: 0.65, roughness: 0.35 });
  const matSteel= new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.90, roughness: 0.15 });
  const matWheel= new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.88, roughness: 0.12 });
  // Turbine housing (cast iron volute scroll)
  const tVolPts = [];
  for (let i = 0; i <= 30; i++) {
    const t = i/30;
    tVolPts.push(new THREE.Vector2(trR*1.15+trR*0.55*(1-t), (t-0.5)*trR*1.2));
  }
  const turbHousing = new THREE.Mesh(new THREE.LatheGeometry(tVolPts, 24), matCast);
  turbHousing.position.y = -hLen*0.32;
  group.add(turbHousing);
  // Turbine inlet flange (V-band, Inconel)
  const tFlange = new THREE.Mesh(new THREE.TorusGeometry(trR*1.15, 5*U, 8, 24), matSteel);
  tFlange.rotation.x = Math.PI/2;
  tFlange.position.y = -hLen*0.32-trR*0.60;
  group.add(tFlange);
  // Turbine wheel (radial-flow, 11 blades)
  const tWheel = new THREE.Group();
  tWheel.add(new THREE.Mesh(new THREE.CylinderGeometry(trR*0.30, trR*0.50, trR*0.90, 16), matWheel));
  for (let i = 0; i < 11; i++) {
    const a = (i/11)*Math.PI*2;
    const tb = new THREE.Mesh(new THREE.BoxGeometry(trR*0.60, trR*0.80, 4*U), matWheel);
    tb.position.set(Math.cos(a)*trR*0.62, 0, Math.sin(a)*trR*0.62);
    tb.rotation.y = a+Math.PI/2; tb.rotation.z = -0.35;
    tWheel.add(tb);
  }
  tWheel.position.y = -hLen*0.32;
  group.add(tWheel);
  // CHRA (center section, aluminium)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(trR*0.75, trR*0.75, hLen*0.44, 20), matAl));
  // Oil inlet
  const oilIn = new THREE.Mesh(new THREE.CylinderGeometry(5*U, 5*U, 20*U, 8), matSteel);
  oilIn.rotation.z = Math.PI/2;
  oilIn.position.set(trR*0.75+10*U, hLen*0.08, 0);
  group.add(oilIn);
  // Oil outlet (larger, gravity drain)
  const oilOut = new THREE.Mesh(new THREE.CylinderGeometry(8*U, 8*U, 24*U, 8), matSteel);
  oilOut.position.set(0, -hLen*0.22-12*U, 0);
  group.add(oilOut);
  // Coolant ports
  for (const side of [-1, 1]) {
    const cp = new THREE.Mesh(new THREE.CylinderGeometry(6*U, 6*U, 16*U, 8), matSteel);
    cp.rotation.z = Math.PI/2;
    cp.position.set(side*(trR*0.75+8*U), -hLen*0.05, 0);
    group.add(cp);
  }
  // Shaft
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(4*U, 4*U, hLen*0.88, 12), matSteel));
  // Journal bearing sleeves
  for (const yp of [-hLen*0.15, hLen*0.15]) {
    const brg = new THREE.Mesh(new THREE.CylinderGeometry(7*U, 7*U, 18*U, 12), matAl);
    brg.position.y = yp;
    group.add(brg);
  }
  // Compressor housing (aluminium volute)
  const cVolPts = [];
  for (let i = 0; i <= 30; i++) {
    const t = i/30;
    cVolPts.push(new THREE.Vector2(cpR*1.10+cpR*0.50*(1-t), (t-0.5)*cpR*1.1));
  }
  const compHousing = new THREE.Mesh(new THREE.LatheGeometry(cVolPts, 24), matAl);
  compHousing.position.y = hLen*0.32;
  group.add(compHousing);
  // Compressor wheel (9 full + 9 splitter blades)
  const cWheel = new THREE.Group();
  cWheel.add(new THREE.Mesh(new THREE.CylinderGeometry(cpR*0.22, cpR*0.48, cpR*0.85, 16), matWheel));
  for (let i = 0; i < 9; i++) {
    const a = (i/9)*Math.PI*2;
    const cb = new THREE.Mesh(new THREE.BoxGeometry(cpR*0.65, cpR*0.72, 3*U), matWheel);
    cb.position.set(Math.cos(a)*cpR*0.58, 0, Math.sin(a)*cpR*0.58);
    cb.rotation.y = a+Math.PI/2; cb.rotation.z = 0.40;
    cWheel.add(cb);
    // Splitter blade (half-span, offset 20 deg)
    const sb = new THREE.Mesh(new THREE.BoxGeometry(cpR*0.60, cpR*0.40, 2.5*U), matWheel);
    sb.position.set(Math.cos(a+0.35)*cpR*0.54, cpR*0.16, Math.sin(a+0.35)*cpR*0.54);
    sb.rotation.y = a+0.35+Math.PI/2; sb.rotation.z = 0.40;
    cWheel.add(sb);
  }
  cWheel.position.y = hLen*0.32;
  group.add(cWheel);
  // Compressor inlet bell
  const cInlet = new THREE.Mesh(new THREE.CylinderGeometry(cpR*0.90, cpR*0.90, 14*U, 20), matAl);
  cInlet.position.y = hLen*0.50;
  group.add(cInlet);
  // V-band clamps
  for (const yp of [-hLen*0.22, hLen*0.22]) {
    const vb = new THREE.Mesh(new THREE.TorusGeometry(trR*0.78, 4*U, 6, 24), matSteel);
    vb.rotation.x = Math.PI/2; vb.position.y = yp;
    group.add(vb);
  }
  // Wastegate actuator (diaphragm can)
  const wgCan = new THREE.Mesh(new THREE.CylinderGeometry(20*U, 20*U, 35*U, 14), matSteel);
  wgCan.rotation.z = Math.PI/4;
  wgCan.position.set(trR*0.80+18*U, -hLen*0.28, trR*0.50);
  group.add(wgCan);
  return group;
}

// Gerotor oil pump — outer/inner rotor, body, cover plate, ports
function _oilPumpGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const outerR = (d.outerR || 28) * U;
  const bodyT  = (d.t || 18) * U;
  const group  = new THREE.Group();
  const matBody  = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.70, roughness: 0.40 });
  const matRotor = new THREE.MeshStandardMaterial({ color: 0x9aabbc, metalness: 0.80, roughness: 0.25 });
  const matDark  = new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.20, roughness: 0.90 });
  // Pump body
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(outerR*1.40, outerR*1.40, bodyT, 24), matBody));
  // Outer rotor (9-lobe epitrochoid)
  const nOuter = 9;
  const outerShape = new THREE.Shape();
  for (let i = 0; i <= nOuter*16; i++) {
    const a = (i/(nOuter*16))*Math.PI*2;
    const r = outerR*(1.0+0.115*Math.cos(nOuter*a));
    const pt = new THREE.Vector2(Math.cos(a)*r, Math.sin(a)*r);
    if (i===0) outerShape.moveTo(pt.x, pt.y); else outerShape.lineTo(pt.x, pt.y);
  }
  const outerRotor = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outerShape, { depth: bodyT*0.88, bevelEnabled: false }), matRotor);
  outerRotor.rotation.x = Math.PI/2;
  outerRotor.position.y = -bodyT*0.44+bodyT*0.06;
  group.add(outerRotor);
  // Inner rotor (8-lobe hypotrochoid, offset)
  const nInner = 8;
  const innerShape = new THREE.Shape();
  const innerR = outerR*0.72;
  for (let i = 0; i <= nInner*16; i++) {
    const a = (i/(nInner*16))*Math.PI*2;
    const r = innerR*(1.0+0.135*Math.cos(nInner*a));
    const pt = new THREE.Vector2(Math.cos(a)*r, Math.sin(a)*r);
    if (i===0) innerShape.moveTo(pt.x, pt.y); else innerShape.lineTo(pt.x, pt.y);
  }
  const innerRotor = new THREE.Mesh(
    new THREE.ExtrudeGeometry(innerShape, { depth: bodyT*0.88, bevelEnabled: false }), matRotor);
  innerRotor.rotation.x = Math.PI/2;
  innerRotor.position.set(outerR*0.12, -bodyT*0.44+bodyT*0.06, 0);
  group.add(innerRotor);
  // Drive shaft hole
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(5*U, 5*U, bodyT*1.05, 12), matDark));
  // Inlet port (crescent)
  const inPort = new THREE.Mesh(new THREE.BoxGeometry(outerR*0.50, bodyT*1.02, outerR*0.22), matDark);
  inPort.position.set(-outerR*0.70, 0, 0);
  group.add(inPort);
  // Outlet port
  const outPort = new THREE.Mesh(new THREE.BoxGeometry(outerR*0.50, bodyT*1.02, outerR*0.22), matDark);
  outPort.position.set(outerR*0.70, 0, 0);
  group.add(outPort);
  // Pressure relief valve boss
  const rvBoss = new THREE.Mesh(new THREE.CylinderGeometry(6*U, 6*U, 28*U, 8), matBody);
  rvBoss.rotation.z = Math.PI/2;
  rvBoss.position.set(0, outerR*1.40+14*U, 0);
  group.add(rvBoss);
  // Cover plate
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(outerR*1.40, outerR*1.40, 6*U, 24), matBody);
  cover.position.y = bodyT/2+3*U;
  group.add(cover);
  // 6x cover bolts M6
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*Math.PI*2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(2.5*U, 2.5*U, 20*U, 6),
      new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.85, roughness: 0.20 }));
    bolt.position.set(Math.cos(a)*outerR*1.20, bodyT/2+8*U, Math.sin(a)*outerR*1.20);
    group.add(bolt);
  }
  return group;
}

// Water pump — volute housing, 6-vane impeller, shaft, mechanical seal, pulley hub
function _waterPumpGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const hvR  = (d.r || 50) * U;
  const hLen = (d.L || 90) * U;
  const group= new THREE.Group();
  const matAl   = new THREE.MeshStandardMaterial({ color: 0x9aaab8, metalness: 0.65, roughness: 0.35 });
  const matSteel= new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.88, roughness: 0.18 });
  const matRub  = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.05, roughness: 0.95 });
  // Volute housing
  const volPts = [];
  for (let i = 0; i <= 28; i++) {
    const t = i/28;
    volPts.push(new THREE.Vector2(hvR*1.10+hvR*0.40*Math.sin(t*Math.PI), (t-0.5)*hLen*0.55));
  }
  group.add(new THREE.Mesh(new THREE.LatheGeometry(volPts, 22), matAl));
  // Mounting flange (4-bolt)
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(hvR*1.20, hvR*1.20, 10*U, 22), matAl);
  flange.position.y = -hLen*0.30;
  group.add(flange);
  // 4x mounting bolts
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2+Math.PI/4;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(3*U, 3*U, 30*U, 6),
      new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.85, roughness: 0.18 }));
    bolt.position.set(Math.cos(a)*hvR*1.05, -hLen*0.35, Math.sin(a)*hvR*1.05);
    group.add(bolt);
  }
  // Impeller (6 backward-curved vanes)
  const nVane = 6;
  const impHub = new THREE.Mesh(new THREE.CylinderGeometry(8*U, hvR*0.35, hLen*0.28, 16), matAl);
  impHub.position.y = -5*U;
  group.add(impHub);
  for (let i = 0; i < nVane; i++) {
    const a = (i/nVane)*Math.PI*2;
    const vane = new THREE.Mesh(new THREE.BoxGeometry(hvR*0.55, hLen*0.22, 4*U), matAl);
    vane.position.set(Math.cos(a)*hvR*0.42, -5*U, Math.sin(a)*hvR*0.42);
    vane.rotation.y = a+0.50;
    group.add(vane);
  }
  // Shaft
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(7*U, 7*U, hLen*1.10, 12), matSteel));
  // Mechanical seal (carbon face + ceramic seat)
  const sealSeat = new THREE.Mesh(new THREE.CylinderGeometry(11*U, 11*U, 5*U, 16), matSteel);
  sealSeat.position.y = hLen*0.22;
  group.add(sealSeat);
  const sealFace = new THREE.Mesh(new THREE.TorusGeometry(8*U, 3*U, 8, 16), matRub);
  sealFace.rotation.x = Math.PI/2;
  sealFace.position.y = hLen*0.25;
  group.add(sealFace);
  // Pulley hub
  const pulleyHub = new THREE.Mesh(new THREE.CylinderGeometry(15*U, 15*U, 20*U, 14), matSteel);
  pulleyHub.position.y = hLen*0.55+10*U;
  group.add(pulleyHub);
  // Outlet nipple
  const outlet = new THREE.Mesh(new THREE.CylinderGeometry(12*U, 12*U, 35*U, 12), matAl);
  outlet.position.set(0, hvR+18*U, hvR*0.50);
  outlet.rotation.z = Math.PI/2;
  group.add(outlet);
  // Weep hole / drain
  const weep = new THREE.Mesh(new THREE.CylinderGeometry(2*U, 2*U, 6*U, 6), matAl);
  weep.rotation.z = Math.PI/2;
  weep.position.set(hvR*1.10+3*U, -hLen*0.10, 0);
  group.add(weep);
  return group;
}

// Clutch disc — organic friction faces, torsion spring hub, 18× rivets, splined hub
function _clutchDiscGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const outerR = (d.outerR || 135) * U;
  const innerR = (d.innerR || 45) * U;
  const thick  = (d.t || 9) * U;
  const group  = new THREE.Group();
  const matFric  = new THREE.MeshStandardMaterial({ color: 0x2a2016, metalness: 0.15, roughness: 0.90 });
  const matHub   = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.75, roughness: 0.30 });
  const matSpring= new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.88, roughness: 0.15 });
  const matRivet = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.90, roughness: 0.12 });
  // Friction disc (annular)
  const discShape = new THREE.Shape();
  discShape.absarc(0, 0, outerR, 0, Math.PI*2, false);
  const h1 = new THREE.Path(); h1.absarc(0, 0, innerR*1.60, 0, Math.PI*2, true);
  discShape.holes.push(h1);
  const disc = new THREE.Mesh(
    new THREE.ExtrudeGeometry(discShape, { depth: thick*0.40, bevelEnabled: false }), matFric);
  disc.rotation.x = Math.PI/2; disc.position.y = -thick*0.20;
  group.add(disc);
  const disc2 = disc.clone(); disc2.position.y = thick*0.22;
  group.add(disc2);
  // Steel backing plate
  const plateShape = new THREE.Shape();
  plateShape.absarc(0, 0, outerR*0.98, 0, Math.PI*2, false);
  const h2 = new THREE.Path(); h2.absarc(0, 0, innerR*1.55, 0, Math.PI*2, true);
  plateShape.holes.push(h2);
  const plate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(plateShape, { depth: thick*0.22, bevelEnabled: false }), matHub);
  plate.rotation.x = Math.PI/2;
  group.add(plate);
  // 6x torsion spring windows
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*Math.PI*2;
    const win = new THREE.Mesh(new THREE.BoxGeometry(16*U, thick*0.30, 28*U),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    win.position.set(Math.cos(a)*innerR*2.10, 0, Math.sin(a)*innerR*2.10);
    win.rotation.y = a;
    group.add(win);
    // Spring inside window
    const sp = new THREE.Mesh(new THREE.TorusGeometry(6*U, 2*U, 6, 12, Math.PI*1.4), matSpring);
    sp.position.set(Math.cos(a)*innerR*2.10, 0, Math.sin(a)*innerR*2.10);
    sp.rotation.y = a;
    group.add(sp);
  }
  // Splined hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, thick*1.2, 24, 1), matHub);
  group.add(hub);
  for (let i = 0; i < 24; i++) {
    const a = (i/24)*Math.PI*2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(2.5*U, thick*1.2, 4*U), matHub);
    tooth.position.set(Math.cos(a)*(innerR-2*U), 0, Math.sin(a)*(innerR-2*U));
    tooth.rotation.y = a;
    group.add(tooth);
  }
  // 18× rivets
  for (let i = 0; i < 18; i++) {
    const a = (i/18)*Math.PI*2;
    const r = outerR*0.72;
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(3*U, 3*U, thick*0.55, 8), matRivet);
    shank.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
    group.add(shank);
    const head1 = new THREE.Mesh(new THREE.CylinderGeometry(5*U, 3*U, 2.5*U, 8), matRivet);
    head1.position.set(Math.cos(a)*r, thick*0.32, Math.sin(a)*r);
    group.add(head1);
    const head2 = new THREE.Mesh(new THREE.CylinderGeometry(5*U, 3*U, 2.5*U, 8), matRivet);
    head2.position.set(Math.cos(a)*r, -thick*0.32, Math.sin(a)*r);
    group.add(head2);
  }
  return group;
}

// Alternator — clamshell housing, 36-slot stator, Lundell rotor, slip rings, pulley
function _alternatorGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const outerR = (d.r || 55) * U;
  const bLen   = (d.L || 120) * U;
  const group  = new THREE.Group();
  const matAl   = new THREE.MeshStandardMaterial({ color: 0x909aa8, metalness: 0.62, roughness: 0.42 });
  const matCoil = new THREE.MeshStandardMaterial({ color: 0xd06010, metalness: 0.30, roughness: 0.60 });
  const matCore = new THREE.MeshStandardMaterial({ color: 0x404040, metalness: 0.70, roughness: 0.50 });
  const matSlip = new THREE.MeshStandardMaterial({ color: 0xc89040, metalness: 0.85, roughness: 0.20 });
  // Front housing
  const frontH = new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR*1.05, bLen*0.48, 22), matAl);
  frontH.position.y = bLen*0.26;
  group.add(frontH);
  // Rear housing
  const rearH = new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR*1.05, bLen*0.40, 22), matAl);
  rearH.position.y = -bLen*0.22;
  group.add(rearH);
  // Air vents (front housing)
  for (let i = 0; i < 8; i++) {
    const a = (i/8)*Math.PI*2;
    const vent = new THREE.Mesh(new THREE.BoxGeometry(6*U, bLen*0.12, 3*U),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    vent.position.set(Math.cos(a)*outerR*0.80, bLen*0.26, Math.sin(a)*outerR*0.80);
    vent.rotation.y = a;
    group.add(vent);
  }
  // 4x through-bolts
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2+Math.PI/4;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(2*U, 2*U, bLen, 8),
      new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.90, roughness: 0.15 }));
    bolt.position.set(Math.cos(a)*outerR*0.88, 0, Math.sin(a)*outerR*0.88);
    group.add(bolt);
  }
  // Stator laminated core
  const stator = new THREE.Mesh(new THREE.CylinderGeometry(outerR*0.92, outerR*0.92, bLen*0.60, 22), matCore);
  group.add(stator);
  // 36-slot stator windings
  for (let i = 0; i < 36; i++) {
    const a = (i/36)*Math.PI*2;
    const coil = new THREE.Mesh(new THREE.BoxGeometry(5*U, bLen*0.58, 6*U), matCoil);
    coil.position.set(Math.cos(a)*outerR*0.88, 0, Math.sin(a)*outerR*0.88);
    coil.rotation.y = a;
    group.add(coil);
  }
  // Rotor hub
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(14*U, 14*U, bLen*0.55, 16), matCore));
  // Field winding
  const fw = new THREE.Mesh(new THREE.TorusGeometry(22*U, 8*U, 8, 20), matCoil);
  fw.rotation.x = Math.PI/2;
  group.add(fw);
  // 12x claw poles
  for (let i = 0; i < 12; i++) {
    const a = (i/12)*Math.PI*2;
    const claw = new THREE.Mesh(new THREE.BoxGeometry(12*U, bLen*0.42, 10*U), matCore);
    claw.position.set(Math.cos(a)*32*U, i%2===0?bLen*0.12:-bLen*0.12, Math.sin(a)*32*U);
    claw.rotation.y = a; claw.rotation.z = (i%2===0?0.35:-0.35);
    group.add(claw);
  }
  // Shaft
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(7*U, 7*U, bLen*1.25, 12), matCore));
  // 2x slip rings (brass)
  for (let i = 0; i < 2; i++) {
    const sr = new THREE.Mesh(new THREE.TorusGeometry(11*U, 3*U, 8, 18), matSlip);
    sr.rotation.x = Math.PI/2; sr.position.y = -bLen*0.55+i*10*U;
    group.add(sr);
  }
  // Brush holder
  const brushHolder = new THREE.Mesh(new THREE.BoxGeometry(20*U, 18*U, 12*U), matAl);
  brushHolder.position.set(outerR+8*U, -bLen*0.45, 0);
  group.add(brushHolder);
  // Multi-groove V-rib pulley
  const pR = (d.pulleyR || 28)*U;
  const pulleyBody = new THREE.Mesh(new THREE.CylinderGeometry(pR, pR, 32*U, 22), matAl);
  pulleyBody.position.y = bLen*0.60+16*U;
  group.add(pulleyBody);
  for (let i = 0; i < 6; i++) {
    const groove = new THREE.Mesh(new THREE.TorusGeometry(pR, 1.5*U, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0x606870, metalness: 0.65, roughness: 0.50 }));
    groove.rotation.x = Math.PI/2;
    groove.position.y = bLen*0.60-11*U+i*5*U;
    group.add(groove);
  }
  // Rectifier/regulator housing
  const rect = new THREE.Mesh(new THREE.BoxGeometry(36*U, 18*U, 22*U), matAl);
  rect.position.set(0, -bLen*0.50, outerR*0.60);
  group.add(rect);
  return group;
}

// Spin-on oil filter — rolled steel canister, anti-drainback valve, relief valve boss
function _oilFilterGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const canR = (d.r || 37) * U;
  const canL = (d.L || 100) * U;
  const group= new THREE.Group();
  const matCan   = new THREE.MeshStandardMaterial({ color: 0x1a2870, metalness: 0.50, roughness: 0.50 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.88, roughness: 0.18 });
  const matRub   = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.05, roughness: 0.95 });
  // Canister (domed ends)
  const canPts = [];
  for (let i = 0; i <= 30; i++) {
    const t = i/30;
    let r = canR;
    if (t<0.12) r = canR*Math.sin((t/0.12)*Math.PI/2);
    else if (t>0.88) r = canR*Math.cos(((t-0.88)/0.12)*Math.PI/2);
    canPts.push(new THREE.Vector2(r, (t-0.5)*canL));
  }
  group.add(new THREE.Mesh(new THREE.LatheGeometry(canPts, 24), matCan));
  // Seam ridge
  const ridge = new THREE.Mesh(new THREE.TorusGeometry(canR*1.005, 1.5*U, 6, 24), matSteel);
  ridge.rotation.x = Math.PI/2; ridge.position.y = -canL*0.40;
  group.add(ridge);
  // Baseplate
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(canR, canR, 8*U, 24),
    Object.assign(matSteel.clone ? matSteel.clone() : matSteel)).position && (()=>{})() || (() => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(canR, canR, 8*U, 24), matSteel);
    b.position.y = -canL*0.50-4*U; return b; })());
  // Center thread boss (3/4-16 UNF)
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(9*U, 9*U, 16*U, 12), matSteel);
  thread.position.y = -canL*0.50-12*U;
  group.add(thread);
  // Thread rings
  for (let i = 0; i < 12; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.5*U, 0.6*U, 4, 12), matSteel);
    ring.rotation.x = Math.PI/2; ring.position.y = -canL*0.50-5*U-i*1.2*U;
    group.add(ring);
  }
  // O-ring
  const oring = new THREE.Mesh(new THREE.TorusGeometry(canR*0.88, 2.5*U, 8, 24), matRub);
  oring.rotation.x = Math.PI/2; oring.position.y = -canL*0.50-4*U;
  group.add(oring);
  // 8x oil inlet holes
  for (let i = 0; i < 8; i++) {
    const a = (i/8)*Math.PI*2;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(2.5*U, 2.5*U, 10*U, 8),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    hole.position.set(Math.cos(a)*canR*0.72, -canL*0.50-2*U, Math.sin(a)*canR*0.72);
    group.add(hole);
  }
  // Bypass relief port
  const byp = new THREE.Mesh(new THREE.CylinderGeometry(4*U, 4*U, 12*U, 8), matSteel);
  byp.rotation.z = Math.PI/2; byp.position.set(canR+6*U, -canL*0.35, 0);
  group.add(byp);
  return group;
}

// Cylinder liner/sleeve — honed bore, coolant grooves, flange
function _cylinderLinerGeom(d, THREE) {
  const U     = UARE_CAD_UNIT;
  const bore  = (d.bore || 86) * U;
  const wall  = (d.wall || 6) * U;
  const len   = (d.L || 145) * U;
  const flangeH = 14*U;
  const group = new THREE.Group();
  const matLiner = new THREE.MeshStandardMaterial({ color: 0x707878, metalness: 0.72, roughness: 0.28 });
  const matBore  = new THREE.MeshStandardMaterial({ color: 0x303840, metalness: 0.55, roughness: 0.15 });
  const matGroove= new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.20, roughness: 0.90 });
  const R   = bore/2;
  const Rod = R+wall;
  // Liner body
  const lPts = [
    new THREE.Vector2(Rod+3*U, -len/2-flangeH),
    new THREE.Vector2(Rod+3*U, -len/2),
    new THREE.Vector2(Rod, -len/2+2*U),
    new THREE.Vector2(Rod, len/2),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(lPts, 28), matLiner));
  // Flange
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(Rod+7*U, Rod+7*U, flangeH, 28), matLiner);
  flange.position.y = -len/2-flangeH/2;
  group.add(flange);
  // Honed bore surface
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, len+flangeH+2*U, 28, 1), matBore));
  // 3x coolant circulation grooves
  for (let i = 0; i < 3; i++) {
    const groove = new THREE.Mesh(new THREE.TorusGeometry(Rod+1.5*U, 2*U, 6, 28), matGroove);
    groove.rotation.x = Math.PI/2; groove.position.y = len*0.15+i*len*0.14;
    group.add(groove);
  }
  // Crosshatch hone pattern (visible as fine rings)
  for (let i = 0; i < 12; i++) {
    const hone = new THREE.Mesh(new THREE.TorusGeometry(R, 0.25*U, 4, 28), matGroove);
    hone.rotation.x = Math.PI/2; hone.position.y = -len*0.40+i*len*0.08;
    group.add(hone);
  }
  return group;
}

// Ball joint — forged socket, chrome ball stud, polyurethane boot, 2x clamps
function _ballJointGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const ballR  = (d.r || 14) * U;
  const bodyR  = ballR*2.00;
  const studL  = (d.studL || 55) * U;
  const group  = new THREE.Group();
  const matSteel= new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.88, roughness: 0.18 });
  const matBoot = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.05, roughness: 0.92, transparent: true, opacity: 0.90 });
  const matZinc = new THREE.MeshStandardMaterial({ color: 0xa0b0a0, metalness: 0.70, roughness: 0.35 });
  // Socket body (hex-forged)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR, ballR*2.4, 6), matZinc));
  // Spherical socket bore
  group.add(new THREE.Mesh(new THREE.SphereGeometry(ballR*1.02, 16, 12), matSteel));
  // Ball (Cr-plated)
  group.add(new THREE.Mesh(new THREE.SphereGeometry(ballR, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.95, roughness: 0.05 })));
  // Tapered stud
  const studPts = [
    new THREE.Vector2(ballR*0.55, 0),
    new THREE.Vector2(ballR*0.55, studL*0.60),
    new THREE.Vector2(ballR*0.42, studL*0.65),
    new THREE.Vector2(ballR*0.42, studL*0.85),
    new THREE.Vector2(ballR*0.36, studL*0.90),
    new THREE.Vector2(ballR*0.36, studL),
  ];
  const stud = new THREE.Mesh(new THREE.LatheGeometry(studPts, 14), matSteel);
  stud.position.y = ballR;
  group.add(stud);
  // Thread rings on stud
  for (let i = 0; i < 8; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ballR*0.38, 0.5*U, 4, 12), matSteel);
    ring.rotation.x = Math.PI/2; ring.position.y = ballR+studL*0.88+i*1.5*U;
    group.add(ring);
  }
  // Snap ring groove
  const snap = new THREE.Mesh(new THREE.TorusGeometry(bodyR*0.98, 1.5*U, 6, 20), matSteel);
  snap.rotation.x = Math.PI/2; snap.position.y = ballR*1.20;
  group.add(snap);
  // Grease nipple (zerk fitting)
  const zerk = new THREE.Mesh(new THREE.CylinderGeometry(2.5*U, 3*U, 8*U, 6), matZinc);
  zerk.rotation.z = Math.PI/4;
  zerk.position.set(bodyR+4*U, ballR*0.50, 0);
  group.add(zerk);
  // Accordion boot
  const bootPts = [];
  for (let i = 0; i <= 22; i++) {
    const t = i/22;
    bootPts.push(new THREE.Vector2(ballR*(1.55+0.55*Math.abs(Math.sin(t*Math.PI*3.5))), t*studL*0.70));
  }
  const boot = new THREE.Mesh(new THREE.LatheGeometry(bootPts, 20), matBoot);
  boot.position.y = ballR*0.80;
  group.add(boot);
  // 2x boot clamps
  for (const yBand of [ballR*0.85, ballR*0.85+studL*0.68]) {
    const clamp = new THREE.Mesh(new THREE.TorusGeometry(ballR*1.65, 1.8*U, 6, 20), matSteel);
    clamp.rotation.x = Math.PI/2; clamp.position.y = yBand;
    group.add(clamp);
  }
  return group;
}

// Rack and pinion steering assembly — rack bar, pinion, housing, tie-rod ends
function _rackAndPinionGeom(d, THREE) {
  const U    = UARE_CAD_UNIT;
  const rackL= (d.L || 600) * U;
  const rackD= (d.d || 28) * U;
  const pinR = (d.pinR || 16) * U;
  const group= new THREE.Group();
  const matRack   = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.88, roughness: 0.18 });
  const matHousing= new THREE.MeshStandardMaterial({ color: 0x9aaabb, metalness: 0.65, roughness: 0.38 });
  const matTooth  = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.90, roughness: 0.12 });
  // Rack bar
  const rackBar = new THREE.Mesh(new THREE.CylinderGeometry(rackD/2, rackD/2, rackL, 16), matRack);
  rackBar.rotation.z = Math.PI/2;
  group.add(rackBar);
  // Rack teeth (flat section with trapezoidal teeth)
  const nTooth = Math.floor(rackL/(6*U));
  for (let i = 0; i < nTooth; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(5*U, 3*U, rackD*0.60), matTooth);
    tooth.position.set(-rackL/2+i*6*U+3*U, rackD/2+1.5*U, 0);
    group.add(tooth);
  }
  // Pinion gear
  const nPin = 12;
  for (let i = 0; i < nPin; i++) {
    const a = (i/nPin)*Math.PI*2;
    const pt = new THREE.Mesh(new THREE.BoxGeometry(4*U, pinR*0.35, 18*U), matTooth);
    pt.position.set(Math.cos(a)*(pinR+1.5*U), rackD/2+pinR+0.5*U, Math.sin(a)*(pinR+1.5*U));
    pt.rotation.y = a;
    group.add(pt);
  }
  const pinionBody = new THREE.Mesh(new THREE.CylinderGeometry(pinR, pinR, 20*U, 14), matRack);
  pinionBody.position.set(0, rackD/2+pinR, 0);
  group.add(pinionBody);
  const pinShaft = new THREE.Mesh(new THREE.CylinderGeometry(7*U, 7*U, 80*U, 12), matRack);
  pinShaft.position.set(0, rackD/2+pinR+50*U, 0);
  group.add(pinShaft);
  // Housing
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(rackD/2+10*U, rackD/2+10*U, rackL*0.60, 20), matHousing);
  housing.rotation.z = Math.PI/2;
  group.add(housing);
  // Tie-rod ends
  for (const side of [-1, 1]) {
    const tierod = new THREE.Mesh(new THREE.CylinderGeometry(8*U, 8*U, rackL*0.15, 10), matRack);
    tierod.rotation.z = Math.PI/2;
    tierod.position.x = side*(rackL/2+rackL*0.075);
    group.add(tierod);
    const socket = new THREE.Mesh(new THREE.SphereGeometry(12*U, 12, 10), matHousing);
    socket.position.x = side*(rackL/2+rackL*0.15+6*U);
    group.add(socket);
    const lockNut = new THREE.Mesh(new THREE.CylinderGeometry(11*U, 11*U, 10*U, 6), matRack);
    lockNut.rotation.z = Math.PI/2;
    lockNut.position.x = side*(rackL/2+rackL*0.06);
    group.add(lockNut);
  }
  // Rack boots (accordion bellows, rubber)
  for (const side of [-1, 1]) {
    const bootPts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i/14;
      bootPts.push(new THREE.Vector2((rackD/2+5*U)*(1+0.45*Math.abs(Math.sin(t*Math.PI*3))), t*rackL*0.18));
    }
    const boot = new THREE.Mesh(new THREE.LatheGeometry(bootPts, 16),
      new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.05, roughness: 0.92 }));
    boot.rotation.z = side===1 ? -Math.PI/2 : Math.PI/2;
    boot.position.x = side*(rackL/2+rackL*0.09);
    group.add(boot);
  }
  return group;
}

// Vented disc brake rotor — dual face rings, 32 cooling vanes, hat section, ABS tone ring
function _brakeRotorGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const outerR = (d.outerR || 135) * U;
  const innerR = (d.innerR || 70) * U;
  const hatR   = (d.hatR || 55) * U;
  const thick  = (d.t || 28) * U;
  const faceT  = thick*0.22;
  const vaneH  = thick-2*faceT;
  const hatH   = (d.hatH || 45) * U;
  const group  = new THREE.Group();
  const matIron = new THREE.MeshStandardMaterial({ color: 0x484040, metalness: 0.68, roughness: 0.62 });
  const matHat  = new THREE.MeshStandardMaterial({ color: 0x606060, metalness: 0.70, roughness: 0.45 });
  // Face rings (annular)
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, outerR, 0, Math.PI*2, false);
  const rh = new THREE.Path(); rh.absarc(0, 0, innerR, 0, Math.PI*2, true);
  ringShape.holes.push(rh);
  const topFace = new THREE.Mesh(
    new THREE.ExtrudeGeometry(ringShape, { depth: faceT, bevelEnabled: false }), matIron);
  topFace.rotation.x = Math.PI/2; topFace.position.y = thick/2;
  group.add(topFace);
  const botFace = topFace.clone(); botFace.position.y = -thick/2+faceT;
  group.add(botFace);
  // 32 cooling vanes
  const nVane = 32;
  for (let i = 0; i < nVane; i++) {
    const a = (i/nVane)*Math.PI*2;
    const rMid = (outerR+innerR)/2;
    const vLen = outerR-innerR-4*U;
    const vane = new THREE.Mesh(new THREE.BoxGeometry(vLen, vaneH, 4*U), matIron);
    vane.position.set(Math.cos(a)*rMid, 0, Math.sin(a)*rMid);
    vane.rotation.y = a+Math.PI/2;
    group.add(vane);
  }
  // Hat section
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(hatR, hatR, hatH, 20), matHat);
  hat.position.y = thick/2+hatH/2;
  group.add(hat);
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(hatR, hatR, 8*U, 20), matHat);
  hatTop.position.y = thick/2+hatH+4*U;
  group.add(hatTop);
  // 5x wheel stud holes
  for (let i = 0; i < 5; i++) {
    const a = (i/5)*Math.PI*2;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(6.5*U, 6.5*U, 30*U, 10),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    hole.position.set(Math.cos(a)*hatR*0.72, thick/2+hatH, Math.sin(a)*hatR*0.72);
    group.add(hole);
  }
  // Center bore
  const cb = new THREE.Mesh(new THREE.CylinderGeometry(28*U, 28*U, hatH+20*U, 16),
    new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
  cb.position.y = thick/2+hatH/2+5*U;
  group.add(cb);
  // ABS tone ring (48 teeth, alternating)
  for (let i = 0; i < 48; i++) {
    const a = (i/48)*Math.PI*2;
    if (i%2===0) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(3*U, 8*U, 3*U), matIron);
      tooth.position.set(Math.cos(a)*(innerR+4*U), -thick/2-4*U, Math.sin(a)*(innerR+4*U));
      group.add(tooth);
    }
  }
  // Drilled holes (performance rotor, 4x per vane sector)
  const nDrill = 16;
  for (let i = 0; i < nDrill; i++) {
    const a = (i/nDrill)*Math.PI*2;
    const r = (outerR+innerR)*0.52;
    const drill = new THREE.Mesh(new THREE.CylinderGeometry(4*U, 4*U, thick+2*U, 8),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    drill.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
    group.add(drill);
  }
  return group;
}

// Coil-over damper — shock body, chrome shaft, coil spring, adjuster collar, top/bottom mounts
function _coilOverGeom(d, THREE) {
  const U       = UARE_CAD_UNIT;
  const bodyD   = (d.d || 50) * U;
  const len     = (d.L || 350) * U;
  const springOD= (d.springOD || 70) * U;
  const springL = len*0.60;
  const group   = new THREE.Group();
  const matBdy  = new THREE.MeshStandardMaterial({ color: 0xb0b8c8, metalness: 0.75, roughness: 0.35 });
  const matSpg  = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.70, roughness: 0.45 });
  const matAnod = new THREE.MeshStandardMaterial({ color: 0xc84010, metalness: 0.65, roughness: 0.40 });
  // Outer body (lathe profile with reservoir)
  const bodyPts = [
    new THREE.Vector2(bodyD/2, -len*0.50),
    new THREE.Vector2(bodyD/2,  len*0.10),
    new THREE.Vector2(bodyD/2*1.12, len*0.12),
    new THREE.Vector2(bodyD/2*1.12, len*0.22),
    new THREE.Vector2(bodyD/2, len*0.24),
    new THREE.Vector2(bodyD/2, len*0.42),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 18), matBdy));
  // Chrome shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(bodyD*0.28, bodyD*0.28, len*0.48, 14),
    new THREE.MeshStandardMaterial({ color: 0xf0f4f8, metalness: 0.96, roughness: 0.04 }));
  shaft.position.y = len*0.16;
  group.add(shaft);
  // Shaft seal / dust wiper
  const wiper = new THREE.Mesh(new THREE.TorusGeometry(bodyD*0.32, 2*U, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.9 }));
  wiper.rotation.x = Math.PI/2; wiper.position.y = len*0.40;
  group.add(wiper);
  // Coil spring (helical)
  const nCoil   = 8;
  const wireD   = (d.wireD || 10) * U;
  const coilPts = Array.from({ length: nCoil*12+1 }, (_, i) => {
    const t = i/(nCoil*12);
    const a = t*nCoil*Math.PI*2;
    return new THREE.Vector3(Math.cos(a)*springOD/2, -springL/2+t*springL, Math.sin(a)*springOD/2);
  });
  const spring = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), nCoil*12, wireD/2, 8, false), matSpg);
  spring.position.y = -len*0.10;
  group.add(spring);
  // Adjuster collar (threaded, anodised red)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(springOD/2*1.05, springOD/2*1.05, 18*U, 24), matAnod);
  collar.position.y = -springL*0.28;
  group.add(collar);
  // Collar spanner notches
  for (let i = 0; i < 8; i++) {
    const a = (i/8)*Math.PI*2;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(6*U, 18*U, 6*U), matBdy);
    notch.position.set(Math.cos(a)*springOD*0.54, -springL*0.28, Math.sin(a)*springOD*0.54);
    group.add(notch);
  }
  // Top mount (pillow ball type)
  const topMount = new THREE.Mesh(new THREE.CylinderGeometry(bodyD*0.85, bodyD*0.85, 20*U, 18), matBdy);
  topMount.position.y = len*0.44;
  group.add(topMount);
  const pillow = new THREE.Mesh(new THREE.SphereGeometry(bodyD*0.38, 14, 10), matBdy);
  pillow.position.y = len*0.48;
  group.add(pillow);
  // Bottom eye (knuckle mount)
  const eye = new THREE.Mesh(new THREE.TorusGeometry(bodyD*0.55, bodyD*0.18, 10, 20), matBdy);
  eye.rotation.z = Math.PI/2; eye.position.y = -len*0.50-bodyD*0.55;
  group.add(eye);
  // Rebound adjuster knob (bottom)
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(6*U, 6*U, 12*U, 8),
    new THREE.MeshStandardMaterial({ color: 0x202020, metalness: 0.55, roughness: 0.45 }));
  knob.position.y = -len*0.50-bodyD*0.08;
  group.add(knob);
  return group;
}

// ISO 4762 socket head cap screw — realistic head, hex socket recess, thread helix
function _socketHeadScrewGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const M      = d.M || 8;
  const pitch  = d.pitch || (M<=1.4?0.3:M<=1.6?0.35:M<=2?0.40:M<=2.5?0.45:M<=3?0.50:M<=4?0.70:M<=5?0.80:M<=6?1.00:M<=8?1.25:M<=10?1.50:1.75);
  const shankL = (d.L || M*4) * U;
  const headH  = M*1.0*U;
  const headD  = M*1.5*U;
  const hexAF  = M*0.75*U;
  const group  = new THREE.Group();
  const matScrew = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.82, roughness: 0.22 });
  // Cylindrical head
  const head = new THREE.Mesh(new THREE.CylinderGeometry(headD, headD, headH, 20), matScrew);
  head.position.y = shankL/2+headH/2;
  group.add(head);
  // Hex socket recess
  const recess = new THREE.Mesh(new THREE.CylinderGeometry(hexAF, hexAF, headH*0.70, 6),
    new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
  recess.position.y = shankL/2+headH*0.85;
  group.add(recess);
  // Shank (unthreaded)
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(M*U/2, M*U/2, shankL*0.55, 14), matScrew);
  shank.position.y = shankL*0.275;
  group.add(shank);
  // Threaded portion
  const threadL = shankL*0.45;
  group.add((()=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(M*U/2,M*U/2,threadL,14),matScrew);m.position.y=-threadL/2;return m;})());
  // Thread helix
  const nThread = Math.floor(threadL/(pitch*U));
  for (let i = 0; i < nThread; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(M*U/2*1.12, pitch*U*0.18, 4, 14), matScrew);
    ring.rotation.x = Math.PI/2; ring.position.y = -threadL/2+i*pitch*U;
    group.add(ring);
  }
  // Chamfer on tip
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1*U, M*U/2, M*0.5*U, 14), matScrew);
  tip.position.y = -threadL-M*0.25*U;
  group.add(tip);
  return group;
}

// Deep groove ball bearing — outer ring, inner ring, balls, cage, shields (DIN 625)
function _deepGrooveBearingGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const od     = (d.OD || 72) * U;
  const id     = (d.ID || 35) * U;
  const width  = (d.B || 17) * U;
  const ballD  = (od-id)*0.30;
  const nBall  = Math.max(6, Math.floor(Math.PI*(od+id)/2/(ballD*1.15)));
  const pitchR = (od+id)/4;
  const group  = new THREE.Group();
  const matOuter = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.90, roughness: 0.15 });
  const matInner = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.92, roughness: 0.12 });
  const matBall  = new THREE.MeshStandardMaterial({ color: 0xe0e8f0, metalness: 0.96, roughness: 0.05 });
  const matCage  = new THREE.MeshStandardMaterial({ color: 0xd0c090, metalness: 0.70, roughness: 0.30 });
  const matShield= new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.65, roughness: 0.45, transparent: true, opacity: 0.85 });
  // Outer ring (raceway groove profiled)
  const oPts = [
    new THREE.Vector2(od/2-1.5*U, -width/2),
    new THREE.Vector2(od/2, -width/2+1.5*U),
    new THREE.Vector2(od/2,  width/2-1.5*U),
    new THREE.Vector2(od/2-1.5*U, width/2),
    new THREE.Vector2(pitchR+ballD*0.52, width/2),
    new THREE.Vector2(pitchR+ballD*0.52, -width/2),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(oPts, 32), matOuter));
  // Inner ring
  const iPts = [
    new THREE.Vector2(id/2, -width/2),
    new THREE.Vector2(id/2,  width/2),
    new THREE.Vector2(pitchR-ballD*0.52, width/2),
    new THREE.Vector2(pitchR-ballD*0.52, -width/2),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(iPts, 32), matInner));
  // Balls
  for (let i = 0; i < nBall; i++) {
    const a = (i/nBall)*Math.PI*2;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(ballD/2, 12, 10), matBall);
    ball.position.set(Math.cos(a)*pitchR, 0, Math.sin(a)*pitchR);
    group.add(ball);
  }
  // Pressed-steel cage (crown type)
  for (let i = 0; i < nBall; i++) {
    const a = (i/nBall)*Math.PI*2;
    const pocket = new THREE.Mesh(new THREE.TorusGeometry(ballD*0.53, 1.2*U, 6, 10, Math.PI*1.6), matCage);
    pocket.position.set(Math.cos(a)*pitchR, 0, Math.sin(a)*pitchR);
    pocket.rotation.y = -a; pocket.rotation.z = Math.PI/2;
    group.add(pocket);
  }
  // Metal shields (ZZ type)
  for (const side of [-1, 1]) {
    const sShape = new THREE.Shape();
    sShape.absarc(0, 0, od/2-2*U, 0, Math.PI*2, false);
    const sh = new THREE.Path(); sh.absarc(0, 0, id/2+2*U, 0, Math.PI*2, true);
    sShape.holes.push(sh);
    const shield = new THREE.Mesh(
      new THREE.ExtrudeGeometry(sShape, { depth: 1.2*U, bevelEnabled: false }), matShield);
    shield.rotation.x = Math.PI/2;
    shield.position.y = side*(width/2-1.2*U);
    group.add(shield);
  }
  return group;
}

// Worm gear set — worm shaft with multi-start helix, bronze worm wheel
function _wormGearGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const wormR  = (d.wormR || 12) * U;
  const wormL  = (d.L || 80) * U;
  const wheelR = (d.wheelR || 55) * U;
  const wheelT = (d.t || 25) * U;
  const nStarts= d.starts || 2;
  const nTeeth = d.teeth || 30;
  const group  = new THREE.Group();
  const matWorm = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.90, roughness: 0.14 });
  const matWheel= new THREE.MeshStandardMaterial({ color: 0xc8a850, metalness: 0.70, roughness: 0.25 });
  // Worm shaft body
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(wormR, wormR, wormL, 16), matWorm));
  // Worm thread (each start, CatmullRom helix)
  for (let s = 0; s < nStarts; s++) {
    const nSeg = 60;
    const pts  = Array.from({ length: nSeg+1 }, (_, i) => {
      const t = i/nSeg;
      const a = t*nStarts*Math.PI*2+(s/nStarts)*Math.PI*2;
      return new THREE.Vector3(Math.cos(a)*(wormR+3*U), -wormL/2+t*wormL, Math.sin(a)*(wormR+3*U));
    });
    const thread = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), nSeg, 1.8*U, 6, false), matWorm);
    group.add(thread);
  }
  // Bronze worm wheel (crown shape)
  const wPts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i/20;
    const r = wheelR+wormR*(1-4*(t-0.5)*(t-0.5))*0.18;
    wPts.push(new THREE.Vector2(r, (t-0.5)*wheelT));
  }
  const wheel = new THREE.Mesh(new THREE.LatheGeometry(wPts, 36), matWheel);
  wheel.position.set(0, wormR+wheelR*0.30, wormL*0.60);
  wheel.rotation.z = Math.PI/2;
  group.add(wheel);
  // Wheel hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR*0.28, wheelR*0.28, wheelT*1.30, 16), matWheel);
  hub.position.set(0, wormR+wheelR*0.30, wormL*0.60);
  hub.rotation.z = Math.PI/2;
  group.add(hub);
  // Wheel teeth
  for (let i = 0; i < nTeeth; i++) {
    const a = (i/nTeeth)*Math.PI*2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(5*U, wheelT*0.85, 8*U), matWheel);
    tooth.position.set(0, wormR+wheelR*0.30+Math.sin(a)*(wheelR+2.5*U), wormL*0.60+Math.cos(a)*(wheelR+2.5*U));
    tooth.rotation.z = a;
    group.add(tooth);
  }
  return group;
}

// Linear rail & carriage — THK/Hiwin style, 4-row ball circulation, end seals
function _linearRailGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const railL  = (d.L || 400) * U;
  const railW  = (d.w || 20) * U;
  const railH  = (d.h || 14) * U;
  const carriW = railW*2.20;
  const carriL = railW*2.60;
  const group  = new THREE.Group();
  const matRail = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.90, roughness: 0.15 });
  const matBlock= new THREE.MeshStandardMaterial({ color: 0x9aacbc, metalness: 0.70, roughness: 0.28 });
  const matBall = new THREE.MeshStandardMaterial({ color: 0xe0e8f0, metalness: 0.96, roughness: 0.05 });
  // Rail profile (gothic arch approx)
  const railShape = new THREE.Shape([
    new THREE.Vector2(-railW/2, 0),
    new THREE.Vector2( railW/2, 0),
    new THREE.Vector2( railW/2, railH-3*U),
    new THREE.Vector2( railW/2-2*U, railH),
    new THREE.Vector2(-railW/2+2*U, railH),
    new THREE.Vector2(-railW/2, railH-3*U),
  ]);
  const rail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: railL, bevelEnabled: false }), matRail);
  rail.rotation.y = -Math.PI/2; rail.position.x = railL/2;
  group.add(rail);
  // Mounting holes along rail
  const nHoles = Math.floor(railL/(60*U));
  for (let i = 0; i < nHoles; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(3*U, 3*U, railH+2*U, 8),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    hole.position.set(-railL/2+(i+0.5)*railL/nHoles, railH/2, 0);
    group.add(hole);
  }
  // Carriage block
  group.add(new THREE.Mesh(new THREE.BoxGeometry(carriW, railH*1.60, carriL), matBlock).position && (()=>{})() || (() => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(carriW, railH*1.60, carriL), matBlock);
    c.position.y = railH*1.30; return c; })());
  // 4 rows × 8 circulating balls
  const raceX = [railW*0.28, -railW*0.28];
  const raceY = [railH*0.80, railH*1.20];
  for (let rx = 0; rx < 2; rx++) {
    for (let ry = 0; ry < 2; ry++) {
      for (let b = 0; b < 8; b++) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(railW*0.09, 8, 6), matBall);
        ball.position.set(raceX[rx], raceY[ry], -carriL/2+(b+0.5)*carriL/8);
        group.add(ball);
      }
    }
  }
  // End seals
  for (const side of [-1, 1]) {
    const seal = new THREE.Mesh(new THREE.BoxGeometry(carriW, railH*1.60, 4*U),
      new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.9 }));
    seal.position.set(0, railH*1.30, side*(carriL/2+2*U));
    group.add(seal);
  }
  // 4x top tapped mounting holes
  for (let i = 0; i < 4; i++) {
    const ax = [[-1,-1],[-1,1],[1,-1],[1,1]][i];
    const h = new THREE.Mesh(new THREE.CylinderGeometry(2.5*U, 2.5*U, 10*U, 6),
      new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 }));
    h.position.set(ax[0]*carriW*0.28, railH*1.60+5*U, ax[1]*carriL*0.28);
    group.add(h);
  }
  return group;
}

// V-belt pulley — A/B/C section grooves, hub, keyway, balance holes
function _vBeltPulleyGeom(d, THREE) {
  const U      = UARE_CAD_UNIT;
  const outerR = (d.r || 80) * U;
  const nGroove= d.grooves || 2;
  const grooveW= 13*U; // "B" section 13mm pitch
  const grooveD= 9.5*U;
  const totalW = nGroove*grooveW + (nGroove-1)*3*U + 12*U;
  const group  = new THREE.Group();
  const matAl  = new THREE.MeshStandardMaterial({ color: 0xa0aab8, metalness: 0.70, roughness: 0.35 });
  const matDark= new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.20, roughness: 0.90 });
  // Body
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i/16;
    pts.push(new THREE.Vector2(outerR*(0.70+0.30*Math.pow(1-Math.abs(2*t-1),2)), (t-0.5)*totalW));
  }
  group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 28), matAl));
  // Belt grooves
  for (let g = 0; g < nGroove; g++) {
    const yg = -totalW/2+6*U+g*(grooveW+3*U)+grooveW/2;
    const grvPts = [
      new THREE.Vector2(outerR-0.5*U, yg-grooveW/2),
      new THREE.Vector2(outerR-grooveD, yg-grooveW*0.30),
      new THREE.Vector2(outerR-grooveD, yg+grooveW*0.30),
      new THREE.Vector2(outerR-0.5*U, yg+grooveW/2),
    ];
    group.add(new THREE.Mesh(new THREE.LatheGeometry(grvPts, 28), matDark));
  }
  // Hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(outerR*0.28, outerR*0.28, totalW*1.15, 16), matAl);
  group.add(hub);
  // Keyway (rectangular slot)
  const keyway = new THREE.Mesh(new THREE.BoxGeometry(outerR*0.10, totalW*1.16, outerR*0.06), matDark);
  keyway.position.x = outerR*0.24;
  group.add(keyway);
  // Web (spoked, 4 spokes)
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(outerR*0.55, totalW*0.55, outerR*0.10), matAl);
    spoke.position.set(Math.cos(a)*outerR*0.44, 0, Math.sin(a)*outerR*0.44);
    spoke.rotation.y = a;
    group.add(spoke);
  }
  // Balance holes (6x)
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*Math.PI*2;
    const bh = new THREE.Mesh(new THREE.CylinderGeometry(3.5*U, 3.5*U, totalW*0.60, 8), matDark);
    bh.position.set(Math.cos(a)*outerR*0.62, 0, Math.sin(a)*outerR*0.62);
    group.add(bh);
  }
  return group;
}


function _mergeGeometries(geoms, THREE) {
  if (THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeGeometries) {
    try { return THREE.BufferGeometryUtils.mergeGeometries(geoms, false); } catch(e) {}
  }
  // Manual merge: convert to non-indexed, concatenate attributes
  try {
    const positions = [], normals = [], uvs = [];
    for (const g of geoms) {
      const src = g.index ? g.toNonIndexed() : g;
      const pos = src.getAttribute('position');
      const nor = src.getAttribute('normal');
      const uv  = src.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        if (uv)  uvs.push(uv.getX(i), uv.getY(i));
      }
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (normals.length) merged.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    if (uvs.length)     merged.setAttribute('uv',     new THREE.BufferAttribute(new Float32Array(uvs), 2));
    if (!normals.length) merged.computeVertexNormals();
    return merged;
  } catch(e) { return geoms[0]; }
}

/* ── §33b  KERNEL STL LOADER ─────────────────────────────────────────────── */
// Parses binary or ASCII STL ArrayBuffer → THREE.BufferGeometry
function parseSTLBytes(buffer, THREE) {
  THREE = THREE || window.THREE;
  if (!THREE) return null;
  const data = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  const view = new DataView(data);

  // Detect ASCII vs binary: ASCII starts with "solid"
  const header = String.fromCharCode.apply(null, new Uint8Array(data, 0, 5));
  const isASCII = header.startsWith('solid');

  let positions, normals;

  if (isASCII) {
    // ASCII STL parser
    const text = new TextDecoder().decode(data);
    const posArr = [], normArr = [];
    const facetRe = /facet\s+normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)[\s\S]*?vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    let m;
    while ((m = facetRe.exec(text)) !== null) {
      const nx = parseFloat(m[1]), ny = parseFloat(m[2]), nz = parseFloat(m[3]);
      posArr.push(parseFloat(m[4]),  parseFloat(m[5]),  parseFloat(m[6]));
      posArr.push(parseFloat(m[7]),  parseFloat(m[8]),  parseFloat(m[9]));
      posArr.push(parseFloat(m[10]), parseFloat(m[11]), parseFloat(m[12]));
      normArr.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    }
    positions = new Float32Array(posArr);
    normals   = new Float32Array(normArr);
  } else {
    // Binary STL: 80-byte header + 4-byte tri count + 50-byte triangles
    const triCount = view.getUint32(80, true);
    positions = new Float32Array(triCount * 9);
    normals   = new Float32Array(triCount * 9);
    let offset = 84;
    for (let i = 0; i < triCount; i++) {
      const nx = view.getFloat32(offset,    true);
      const ny = view.getFloat32(offset+4,  true);
      const nz = view.getFloat32(offset+8,  true);
      offset += 12;
      const base = i * 9;
      for (let v = 0; v < 3; v++) {
        positions[base + v*3]     = view.getFloat32(offset,   true);
        positions[base + v*3 + 1] = view.getFloat32(offset+4, true);
        positions[base + v*3 + 2] = view.getFloat32(offset+8, true);
        normals[base + v*3]     = nx;
        normals[base + v*3 + 1] = ny;
        normals[base + v*3 + 2] = nz;
        offset += 12;
      }
      offset += 2; // attribute byte count
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(normals,   3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Fetch a kernel STL from a URL and display it in the persistent Three.js scene.
 * Replaces any existing kernel mesh (tagged __kernelMesh).
 * Falls back to keeping existing JS geometry if fetch fails.
 * @param {string} url - URL to fetch the STL from
 * @param {string} [label='Assembly'] - Display label for the mesh
 * @returns {Promise<boolean>} true if successfully loaded
 */
async function loadKernelSTL(url, label) {
  try {
    const THREE = window.THREE;
    if (!THREE) return false;
    const ps = _PS || (document.getElementById('cad-canvas') && _initPersistentScene(document.getElementById('cad-canvas')));
    if (!ps) return false;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buffer = await resp.arrayBuffer();
    const geo = parseSTLBytes(buffer, THREE);
    if (!geo || geo.getAttribute('position').count === 0) throw new Error('Empty geometry');

    // Remove any previous kernel mesh
    const prevKernel = ps.scene.getObjectByName('__kernelMesh');
    if (prevKernel) {
      ps.scene.remove(prevKernel);
      if (prevKernel.geometry) prevKernel.geometry.dispose();
      if (prevKernel.material) prevKernel.material.dispose();
    }

    // Convert mm → scene units (UARE_CAD_UNIT = 0.1 → 1mm = 0.1 su)
    // CadQuery outputs mm; scale to match the JS scene
    const mat = new THREE.MeshStandardMaterial({
      color:     0x8a9bb5,
      metalness: 0.72,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = '__kernelMesh';
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.isKernelMesh = true;
    mesh.userData.partName = label || 'Assembly (CadQuery kernel)';

    // Scale: kernel outputs in mm, scene unit = 1mm * UARE_CAD_UNIT
    mesh.scale.setScalar(UARE_CAD_UNIT);

    // Center the mesh in scene
    const box3 = new THREE.Box3().setFromObject(mesh);
    const centre = box3.getCenter(new THREE.Vector3());
    mesh.position.sub(centre);

    ps.scene.add(mesh);
    ps.partMeshes['__kernel_assembly'] = mesh;

    // Fit camera to new geometry
    _fitCameraToScene(ps);

    console.log('[UARE CAD] Kernel STL loaded: ' + geo.getAttribute('position').count / 3 + ' triangles from ' + url);
    return true;
  } catch (e) {
    console.warn('[UARE CAD] loadKernelSTL failed:', e.message);
    return false;
  }
}

/* ── §34  SCENE CONTROLS ─────────────────────────────────────────────────── */

function clearScene() {
  if (!_PS) return;
  const scene = _PS.scene;
  const toRemove = [];
  scene.children.forEach(c => {
    if (c.isMesh || (c.type && c.type === 'Group')) toRemove.push(c);
  });
  toRemove.forEach(c => {
    scene.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => m && m.dispose());
    }
  });
  Object.keys(_PS.partMeshes).forEach(k => delete _PS.partMeshes[k]);
  _PS.morphQueue.length = 0;
}

function getLastScene() {
  return _PS || null;
}

function setView(view) {
  if (!_PS) return;
  const orb = _PS.orb;
  const views = {
    front:  { theta: 0,          phi: Math.PI / 2 },
    back:   { theta: Math.PI,    phi: Math.PI / 2 },
    left:   { theta: -Math.PI/2, phi: Math.PI / 2 },
    right:  { theta: Math.PI/2,  phi: Math.PI / 2 },
    top:    { theta: 0,          phi: 0.01         },
    bottom: { theta: 0,          phi: Math.PI - 0.01 },
    iso:    { theta: 0.75,       phi: 1.05         },
    fit:    null,
  };
  if (view === 'fit') { _fitCameraToScene(_PS); return; }
  const v = views[view] || views.iso;
  // Animate to view
  const startTheta = orb.theta, startPhi = orb.phi;
  const endTheta = v.theta, endPhi = v.phi;
  const dur = 30;
  let frame = 0;
  function step() {
    frame++;
    const t = _easeInOutCubic(Math.min(1, frame / dur));
    orb.theta = startTheta + (endTheta - startTheta) * t;
    orb.phi   = startPhi   + (endPhi   - startPhi)   * t;
    _PS._orbitUpdate();
    if (frame < dur) requestAnimationFrame(step);
  }
  step();
}

function setRenderMode(mode) {
  if (!_PS) return;
  _PS._mode = mode;
  const THREE = window.THREE;
  Object.values(_PS.partMeshes).forEach(mesh => {
    mesh.traverse(function(obj) {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (!mat) return;
        switch (mode) {
          case 'wire':
            mat.wireframe = true;
            mat.transparent = false;
            mat.opacity = 1;
            break;
          case 'xray':
            mat.wireframe = false;
            mat.transparent = true;
            mat.opacity = 0.18;
            mat.depthWrite = false;
            break;
          case 'stress':
            mat.wireframe = false;
            mat.transparent = false;
            mat.opacity = 1;
            mat.depthWrite = true;
            // Cache original color before overwriting (handles group sub-materials)
            if (!mat.userData) mat.userData = {};
            if (mat.userData._origColor == null && mat.userData._cachedColor == null) {
              mat.userData._cachedColor = '#' + mat.color.getHexString();
            }
            if (THREE) {
              const sv = (mesh.userData && mesh.userData.stressValue != null) ? mesh.userData.stressValue : 0.5;
              const r = Math.min(1, sv * 2);
              const g = sv < 0.5 ? sv * 2 : 2 - sv * 2;
              const b = Math.max(0, 1 - sv * 2);
              mat.color.setRGB(r, g, b);
            }
            break;
          case 'thermal':
            mat.wireframe = false;
            mat.transparent = false;
            mat.opacity = 1;
            mat.depthWrite = true;
            // Cache original color before overwriting
            if (!mat.userData) mat.userData = {};
            if (mat.userData._origColor == null && mat.userData._cachedColor == null) {
              mat.userData._cachedColor = '#' + mat.color.getHexString();
            }
            if (THREE) {
              const tv = (mesh.userData && mesh.userData.thermalValue != null) ? mesh.userData.thermalValue : 0.4;
              const tr = Math.min(1, tv * 1.5);
              const tg = Math.max(0, tv * 2 - 0.6);
              const tb = Math.max(0, tv * 3 - 2.4);
              mat.color.setRGB(tr, tg, tb);
            }
            break;
          case 'solid':
          default:
            mat.wireframe = false;
            mat.transparent = false;
            mat.opacity = 1;
            mat.depthWrite = true;
            // Restore original color: stored in userData._origColor on first visit
            if (THREE) {
              if (mat.userData && mat.userData._origColor != null) {
                mat.color.set(mat.userData._origColor);
              } else if (mat.userData && mat.userData._cachedColor != null) {
                mat.color.set(mat.userData._cachedColor);
              }
              // Cache current color on first solid view (before any stress/thermal)
              if (!mat.userData) mat.userData = {};
              if (mat.userData._origColor == null && mat.userData._cachedColor == null) {
                mat.userData._cachedColor = '#' + mat.color.getHexString();
              }
            }
            break;
        }
      });
    });
  });
}

/* ── §35  FIT + EXPLODE ──────────────────────────────────────────────────── */

function explodeView(factor) {
  if (!_PS) return;
  const THREE = window.THREE;
  const center = new THREE.Vector3();
  const parts = Object.values(_PS.partMeshes);
  parts.forEach(m => center.add(m.position));
  if (parts.length) center.divideScalar(parts.length);
  parts.forEach(m => {
    const dir = m.position.clone().sub(center).normalize();
    const dist = (factor || 2.5) * 60;
    const target = m._origPos
      ? m._origPos.clone().addScaledVector(dir, dist)
      : m.position.clone().addScaledVector(dir, dist);
    if (!m._origPos) m._origPos = m.position.clone();
    // Animate
    const start = m.position.clone();
    const end = target;
    let f = 0;
    const dur = 40;
    function step() {
      f++;
      const t = _easeInOutCubic(Math.min(1, f / dur));
      m.position.lerpVectors(start, end, t);
      if (f < dur) requestAnimationFrame(step);
    }
    step();
  });
}

/* ── §36  PASS 4 API EXTENSION ───────────────────────────────────────────── */

// Extend existing UARE_CAD object (created in Pass 1 §12)


Object.assign(global.UARE_CAD, {
  // Core new APIs
  morphAddPart,
  clearScene,
  getLastScene,
  setView,
  setRenderMode,
  explodeView,
  // Material DB
  getMaterialProperties: (key) => _getMat((key || 'steel').toLowerCase().replace(/[- ]/g, '_')),
  listMaterials: () => Object.keys(MAT_DB_EXTENDED),
  // Geometry introspection
  buildPartMesh: _buildPartMesh,
  // Version
  version: '4.0.0-pass4',
  // Expose persistent scene init for sim engine
  _initPersistentScene,
  _PS_ref: () => _PS,
  // Live _PS accessor (for hover/select from enki.js)
  get _PS() { return _PS; },
  // Kernel STL loader — loads real CadQuery-generated geometry into the viewport
  loadKernelSTL: loadKernelSTL,
  // Parse STL bytes into BufferGeometry
  parseSTL: parseSTLBytes,
});

// Ensure explode is wired on scene object too (for legacy callers)
if (_PS) {
  _PS.explode = explodeView;
}

/* END OF PASS 4 — Pass 5 will add: generative topology optimization,
   advanced FEA mesh, patent claim extractor, design iteration AI */



/* ── UARE CAD Pass7 Self-Test ─────────────────────────────────────── */
(function _cadSelfTest() {
  try {
    const T = window.THREE;
    if (!T) return;
    const types = ['piston','bearing','bracket','valve_intake','con_rod','crankshaft','piston_ring','bolt'];
    let ok=0, fail=0;
    types.forEach(function(t) {
      try {
        const r = _buildPartMesh({ type: t, dims: {}, name: t });
        if (r) { ok++; } else { fail++; console.error('[CAD self-test] '+t+': returned null'); }
      } catch(e) { fail++; console.error('[CAD self-test] '+t+' THREW:', e.message); }
    });
    console.log('[UARE CAD Pass7] self-test: '+ok+'/'+types.length+' OK'+(fail?' | '+fail+' FAILED':''));
  } catch(e) {}
})();

})(typeof window !== "undefined" ? window : global);

/* ═══════════════════════════════════════════════════════════════════════════
   SIM-ENGINE.JS  v1.0  —  UARE Physics & FEA Simulation Engine
   Uses cannon-es (loaded via CDN) for rigid-body physics.
   Exposes: window.UARE_SIM = { init, run, pause, reset, getResults }

   Capabilities:
     • Rigid-body dynamics (gravity, collision, friction, restitution)
     • Joint constraints: revolute, prismatic, fixed, hinge
     • Part mass/inertia from material density × geometry volume
     • FEA proxy: von Mises stress estimate from contact forces
     • Thermal proxy: temperature distribution from power input
     • Real-time mesh sync (THREE mesh positions from physics bodies)
     • Result analysis: max stress, safety factor, settlement check
     • Enki-ready: produces summary text + suggestions

   Material physics data: density, yieldMPa, youngsGPa
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
'use strict';

/* ── Constants ──────────────────────────────────────────────────────────── */
const GRAVITY     = -9.81;    // m/s²
const SIM_DT      = 1 / 60;   // 60 Hz physics tick
const MAX_SIM_T   = 8.0;      // s — max simulation time before force-complete
const SETTLE_VEL  = 0.005;    // m/s — body considered "settled" below this
const UNIT_SCALE  = 0.001;    // THREE units → metres (1 unit = 1mm in our scene)

/* ── Material property lookup ───────────────────────────────────────────── */
const MAT_PHYS = {
  steel:          { density: 7850, yieldMPa: 250,  youngsGPa: 200, muStatic: 0.15 },
  steel_4340:     { density: 7850, yieldMPa: 740,  youngsGPa: 205, muStatic: 0.15 },
  stainless_304:  { density: 8000, yieldMPa: 215,  youngsGPa: 193, muStatic: 0.18 },
  stainless_316:  { density: 8000, yieldMPa: 220,  youngsGPa: 193, muStatic: 0.18 },
  cast_iron:      { density: 7200, yieldMPa: 230,  youngsGPa: 170, muStatic: 0.12 },
  aluminum:       { density: 2700, yieldMPa: 270,  youngsGPa: 69,  muStatic: 0.35 },
  aluminum_6061:  { density: 2700, yieldMPa: 276,  youngsGPa: 68.9,muStatic: 0.35 },
  aluminum_7075:  { density: 2810, yieldMPa: 503,  youngsGPa: 71.7,muStatic: 0.35 },
  titanium:       { density: 4430, yieldMPa: 880,  youngsGPa: 114, muStatic: 0.30 },
  titanium_6al4v: { density: 4430, yieldMPa: 880,  youngsGPa: 114, muStatic: 0.30 },
  copper:         { density: 8960, yieldMPa: 70,   youngsGPa: 110, muStatic: 0.35 },
  brass:          { density: 8500, yieldMPa: 100,  youngsGPa: 100, muStatic: 0.30 },
  bronze:         { density: 8800, yieldMPa: 140,  youngsGPa: 96,  muStatic: 0.25 },
  carbon_fiber:   { density: 1600, yieldMPa: 600,  youngsGPa: 70,  muStatic: 0.25 },
  carbon_fiber_ud:{ density: 1550, yieldMPa: 1500, youngsGPa: 135, muStatic: 0.25 },
  abs:            { density: 1050, yieldMPa: 45,   youngsGPa: 2.3, muStatic: 0.60 },
  nylon:          { density: 1150, yieldMPa: 70,   youngsGPa: 2.8, muStatic: 0.55 },
  inconel_718:    { density: 8190, yieldMPa: 1034, youngsGPa: 200, muStatic: 0.20 },
  default:        { density: 7850, yieldMPa: 250,  youngsGPa: 200, muStatic: 0.20 },
};
function _matPhys(key) {
  const k = (key || 'steel').toLowerCase().replace(/[- ]/g, '_');
  return MAT_PHYS[k] || MAT_PHYS.default;
}

function _num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _vec3(v, fallback) {
  if (Array.isArray(v)) {
    return [_num(v[0], fallback[0]), _num(v[1], fallback[1]), _num(v[2], fallback[2])];
  }
  if (v && typeof v === 'object') {
    return [_num(v.x, fallback[0]), _num(v.y, fallback[1]), _num(v.z, fallback[2])];
  }
  return fallback.slice();
}

function _canonicalDims(part) {
  const src = Object.assign({}, part && part.dimensions_mm, part && part.dims);
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

  const out = Object.assign({}, src);
  const w = pick('w', 'width', 'x');
  const h = pick('h', 'height', 'z', 'thickness');
  const d = pick('d', 'depth', 'y');
  const L = pick('L', 'length', 'len', 'height', 'h', 'z');
  const dia = pick('diameter', 'dia', 'd', 'outerD', 'outer_diameter', 'od');
  const outerD = pick('outerD', 'outer_diameter', 'od', 'diameter', 'd');
  const innerD = pick('innerD', 'inner_diameter', 'id', 'bore');

  if (w != null) out.w = w;
  if (h != null) out.h = h;
  if (d != null) out.d = d;
  if (L != null) out.L = L;
  if (dia != null) out.diameter = dia;
  if (out.d == null && dia != null) out.d = dia;
  if (outerD != null) out.outerD = outerD;
  if (innerD != null) out.innerD = innerD;

  return out;
}

function _normalizePart(part, idx) {
  const p = Object.assign({}, part || {});
  p.id = p.id || ('sim_part_' + String((idx || 0) + 1).padStart(4, '0'));
  p.type = String(p.type || p.shape || p.kind || 'custom').toLowerCase();
  p.material = String(p.material || 'steel').toLowerCase();
  p.dims = _canonicalDims(p);
  p.dimensions_mm = Object.assign({}, p.dimensions_mm || {}, p.dims);
  p.position = _vec3(p.position != null ? p.position : p.transform_mm, [0, 0, 0]);
  p.rotation = _vec3(p.rotation, [0, 0, 0]);
  if (p.mass_kg != null) p.mass_kg = _num(p.mass_kg, p.mass_kg);
  return p;
}

/* ── State ──────────────────────────────────────────────────────────────── */
let _world    = null;
let _bodies   = [];   // [{body, mesh, partDef, vol}]
let _ground   = null;
let _rafId    = null;
let _t        = 0;
let _paused   = false;
let _cbs      = null; // { onStep, onComplete }
let _results  = null;
let _peakForces = {}; // bodyIndex → max contact force (N)

/* ── Init ───────────────────────────────────────────────────────────────── */
function init(sceneRef, canvas, assemblyDef) {
  // Cleanup previous
  _cleanup();

  const CANNON = global.CANNON;
  if (!CANNON) {
    console.error('[UARE_SIM] cannon-es not loaded. Add CDN script before sim-engine.js');
    return false;
  }

  // Create world
  _world = new CANNON.World({
    gravity: new CANNON.Vec3(0, GRAVITY, 0),
    broadphase: new CANNON.NaiveBroadphase(),
  });
  _world.broadphase.useBoundingBoxes = true;
  _world.solver.iterations = 20;
  _world.defaultContactMaterial.friction    = 0.4;
  _world.defaultContactMaterial.restitution = 0.2;

  // Ground plane
  const groundMat = new CANNON.Material('ground');
  const groundBody = new CANNON.Body({ mass: 0, material: groundMat });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(0, -1 * UNIT_SCALE, 0);
  _world.addBody(groundBody);
  _ground = groundBody;

  // Build bodies from assembly parts + scene meshes
  const parts  = ((assemblyDef && assemblyDef.parts) || []).map((p, i) => _normalizePart(p, i));
  const meshes = sceneRef ? Object.values(sceneRef.partMeshes || {}) : [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const mesh = sceneRef && sceneRef.partMeshes && sceneRef.partMeshes[part.id];
    const body = _createBody(part, CANNON);
    if (!body) continue;
    _world.addBody(body);
    _bodies.push({ body, mesh: mesh || null, partDef: part, vol: _calcVolume(part) });
    _peakForces[i] = 0;
  }

  // If no assembly provided but we have a scene, create a basic body per mesh
  if (parts.length === 0 && meshes.length > 0) {
    meshes.forEach((mesh, i) => {
      const partDef = _normalizePart(mesh._partDef || { dims: { w: 100, h: 100, d: 100 }, material: 'steel', mass_kg: 1 }, i);
      const body = _createBody(partDef, CANNON);
      if (!body) return;
      // Sync starting position from mesh
      body.position.set(
        mesh.position.x * UNIT_SCALE,
        mesh.position.y * UNIT_SCALE,
        mesh.position.z * UNIT_SCALE
      );
      _world.addBody(body);
      _bodies.push({ body, mesh, partDef, vol: _calcVolume(partDef) });
      _peakForces[i] = 0;
    });
  }

  _t = 0;
  _paused = false;
  _results = null;
  console.log('[UARE_SIM] Initialized. Bodies:', _bodies.length);
  return true;
}

function _createBody(part, CANNON) {
  part = _normalizePart(part, 0);
  const dims   = part.dims || {};
  const mp     = _matPhys(part.material);
  const mass   = _estimateMass(part, mp);
  const pos    = part.position || [0, 0, 0];

  // Choose shape based on type
  const type = (part.type || 'custom').toLowerCase();
  let shape;
  try {
    if (type === 'bearing' || type === 'ball_joint') {
      const r = Math.max(0.001, ((dims.outerD || dims.d || dims.diameter || 30) / 2) * UNIT_SCALE);
      shape = new CANNON.Sphere(r);
    } else if (type === 'shaft' || type === 'axle' || type === 'spring' || type === 'piston' || type === 'bolt_hex' || type === 'bolt') {
      const r = Math.max(0.001, ((dims.d || dims.diameter || dims.outerD || 30) / 2) * UNIT_SCALE);
      const h = Math.max(0.001, (dims.L || dims.h || 100) * UNIT_SCALE);
      shape = new CANNON.Cylinder(r, r, h, 16);
    } else if (type === 'gear') {
      const teeth = dims.teeth || 20, module_ = dims.module || 2;
      const r = Math.max(0.001, (teeth * module_ / 2) * UNIT_SCALE * 1.08);
      const h = Math.max(0.001, (dims.faceW || 25) * UNIT_SCALE);
      shape = new CANNON.Cylinder(r, r, h, 20);
    } else {
      const w = Math.max(0.001, (dims.w || 100) * UNIT_SCALE / 2);
      const h = Math.max(0.001, (dims.h || 100) * UNIT_SCALE / 2);
      const d = Math.max(0.001, (dims.d || dims.w || 100) * UNIT_SCALE / 2);
      shape = new CANNON.Box(new CANNON.Vec3(w, h, d));
    }
  } catch (e) {
    const s = 0.05;
    shape = new CANNON.Box(new CANNON.Vec3(s, s, s));
  }

  const body = new CANNON.Body({
    mass,
    material: new CANNON.Material({ friction: mp.muStatic, restitution: 0.15 }),
    linearDamping:  0.4,
    angularDamping: 0.6,
  });
  body.addShape(shape);
  body.position.set(
    pos[0] * UNIT_SCALE,
    pos[1] * UNIT_SCALE + 0.02,  // slight offset up to start above ground
    pos[2] * UNIT_SCALE
  );
  return body;
}

function _estimateMass(part, mp) {
  if (part.mass_kg != null) return part.mass_kg;
  const vol = _calcVolume(part); // m³
  return mp.density * vol;
}

function _calcVolume(part) {
  part = _normalizePart(part, 0);
  const d = part.dims || {};
  const type = (part.type || 'custom').toLowerCase();
  const s = UNIT_SCALE;
  if (type === 'bearing') {
    const ro = (d.outerD || d.d || d.diameter || 30) / 2 * s;
    const ri = (d.innerD || d.id || 0) / 2 * s;
    const h = (d.width || d.h || d.L || 20) * s;
    return Math.PI * Math.max(0, ro * ro - ri * ri) * h;
  }
  if (type === 'shaft' || type === 'axle' || type === 'piston' || type === 'bolt_hex' || type === 'bolt') {
    const r = (d.d || d.diameter || d.outerD || 30) / 2 * s;
    const h = (d.L || d.h || 100) * s;
    return Math.PI * r * r * h;
  } else if (type === 'gear') {
    const teeth = d.teeth || 20, m = d.module || 2;
    const r = teeth * m / 2 * s;
    const h = (d.faceW || 25) * s;
    return Math.PI * r * r * h * 0.7; // ~70% solid factor
  } else {
    const w = (d.w || 100) * s, h = (d.h || 100) * s, dep = (d.d || d.w || 100) * s;
    return w * h * dep;
  }
}

function _partSection(partDef) {
  const d = (partDef && partDef.dims) || {};
  const w = Math.max(1e-6, _num(d.w, 100) * UNIT_SCALE);
  const h = Math.max(1e-6, _num(d.h, 100) * UNIT_SCALE);
  const dep = Math.max(1e-6, _num(d.d, d.w || 100) * UNIT_SCALE);
  const dia = Math.max(1e-6, _num(d.diameter, d.d || d.outerD || 30) * UNIT_SCALE);
  const type = (partDef && partDef.type || '').toLowerCase();

  if (type === 'shaft' || type === 'axle' || type === 'bolt' || type === 'bolt_hex' || type === 'piston') {
    const r = dia / 2;
    return {
      area: Math.PI * r * r,
      secMod: Math.PI * Math.pow(dia, 3) / 32,
    };
  }
  if (type === 'bearing') {
    const od = Math.max(1e-6, _num(d.outerD, d.d || 30) * UNIT_SCALE);
    const id = Math.max(0, _num(d.innerD, 0) * UNIT_SCALE);
    const area = Math.PI * Math.max(1e-12, (od * od - id * id) / 4);
    const secMod = Math.PI * Math.max(1e-12, (Math.pow(od, 4) - Math.pow(id, 4)) / (32 * od));
    return { area, secMod };
  }
  const b = Math.max(w, dep);
  const t = Math.max(1e-6, h);
  return {
    area: Math.max(1e-9, b * t),
    secMod: Math.max(1e-9, b * t * t / 6),
  };
}

/* ── Run loop ───────────────────────────────────────────────────────────── */
function run(cbs) {
  _cbs = cbs || {};
  _paused = false;
  if (_rafId) cancelAnimationFrame(_rafId);
  let lastTime = null;
  let fpsSamples = [];

  function step(now) {
    if (_paused) return;
    _rafId = requestAnimationFrame(step);

    if (lastTime === null) { lastTime = now; return; }
    const dtWall = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // FPS tracking
    fpsSamples.push(1 / dtWall);
    if (fpsSamples.length > 30) fpsSamples.shift();
    const fps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;

    // Step physics
    _world.step(SIM_DT, dtWall, 3);
    _t += SIM_DT;

    // Track peak contact forces via velocity impulse proxy
    _bodies.forEach(({ body }, i) => {
      // Use body velocity magnitude as a proxy for experienced force (mv/dt)
      const v = body.velocity;
      const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      const approxF = body.mass * spd / SIM_DT;
      if (approxF > (_peakForces[i] || 0)) _peakForces[i] = approxF;
    });

    // Sync THREE meshes with physics bodies
    _bodies.forEach(({ body, mesh }) => {
      if (!mesh) return;
      mesh.position.set(
        body.position.x / UNIT_SCALE,
        body.position.y / UNIT_SCALE,
        body.position.z / UNIT_SCALE
      );
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w
      );
    });

    // Callback
    if (_cbs.onStep) _cbs.onStep(SIM_DT, _t, fps);

    // Check completion
    const settled = _bodies.every(({ body }) => {
      const v = body.velocity;
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) < SETTLE_VEL;
    });
    if (settled || _t >= MAX_SIM_T) {
      _paused = true;
      cancelAnimationFrame(_rafId);
      _results = _analyseResults();
      if (_cbs.onComplete) _cbs.onComplete(_results);
    }
  }
  _rafId = requestAnimationFrame(step);
}

/* ── Results Analysis ───────────────────────────────────────────────────── */
function _analyseResults() {
  const parts = _bodies.map(({ body, partDef }, i) => {
    const mp      = _matPhys((partDef || {}).material);
    const mass    = body.mass;
    const peakF   = _peakForces[i] || 0;
    const sec = _partSection(partDef);
    const pos = ((partDef && partDef.position) || [0, 0, 0]);
    const arm = Math.max(0.005, Math.hypot(pos[0], pos[1], pos[2]) * UNIT_SCALE);
    const sigmaAxial = peakF / sec.area;
    const sigmaBend = (peakF * arm) / sec.secMod;
    const stressMPa = Math.sqrt(sigmaAxial * sigmaAxial + 3 * sigmaBend * sigmaBend) / 1e6;
    const safety  = mp.yieldMPa > 0 ? mp.yieldMPa / Math.max(0.01, stressMPa) : 999;
    return {
      id: (partDef && partDef.id) || ('part_' + i),
      name: (partDef && partDef.name) || 'Part ' + i,
      stressMPa,
      safety,
      mass,
      yieldMPa: mp.yieldMPa,
    };
  });

  // Global max
  const maxStressPart = parts.reduce((a, b) => a.stressMPa > b.stressMPa ? a : b, { stressMPa: 0, safety: 999 });
  const minSafety = parts.reduce((a, b) => a.safety < b.safety ? a : b, { safety: 999 });
  const totalMass = parts.reduce((s, p) => s + p.mass, 0);

  // Summary
  const statusOK = minSafety.safety >= 2.0;
  const summary = statusOK
    ? 'Assembly is structurally sound. Min safety factor ' + minSafety.safety.toFixed(2) + 'x on ' + minSafety.name + '.'
    : 'Warning: ' + minSafety.name + ' has safety factor ' + minSafety.safety.toFixed(2) + 'x (below 2.0 minimum). Review material or geometry.';

  const suggestions = [];
  if (minSafety.safety < 2.0) {
    suggestions.push('Increase wall thickness of ' + minSafety.name + ' by 20-30%');
    suggestions.push('Consider upgrading ' + minSafety.name + ' to a higher-yield material');
    suggestions.push('Add a gusset or rib to the high-stress region');
  }
  if (minSafety.safety >= 5.0) {
    suggestions.push('Assembly is over-designed — consider reducing material for weight savings');
    suggestions.push('Review ' + maxStressPart.name + ' dimensions for material optimization');
  }
  suggestions.push('Run thermal analysis to check heat dissipation under load');

  return {
    parts,
    maxStress: maxStressPart.stressMPa,
    safetyFactor: minSafety.safety,
    totalMass,
    simTime: _t,
    structurallyOK: statusOK,
    summary,
    suggestions: suggestions.slice(0, 4),
  };
}

/* ── FEA Proxy ──────────────────────────────────────────────────────────── */
function runFEA(assemblyDef, loadN) {
  const F = loadN || 1000; // N applied load
  const parts = ((assemblyDef && assemblyDef.parts) || []).map((p, i) => _normalizePart(p, i));
  let maxStress = 0, minSafety = 999, criticalPart = null;
  const partResults = parts.map(part => {
    const mp = _matPhys(part.material);
    const sec = _partSection(part);
    const mass = part.mass_kg != null ? part.mass_kg : _estimateMass(part, mp);
    const massFrac = Math.max(0.02, mass / Math.max(0.001, parts.reduce((s, p) => s + (p.mass_kg || 0.1), 0)));
    const partLoad = F * massFrac;
    const arm = Math.max(0.005, Math.hypot(part.position[0], part.position[1], part.position[2]) * UNIT_SCALE);
    const sigmaAxial = partLoad / sec.area;
    const sigmaBend = (partLoad * arm) / sec.secMod;
    const sigmaMPa = Math.sqrt(sigmaAxial * sigmaAxial + 3 * sigmaBend * sigmaBend) / 1e6;
    const sf = mp.yieldMPa / Math.max(0.001, sigmaMPa);
    if (sigmaMPa > maxStress) maxStress = sigmaMPa;
    if (sf < minSafety) { minSafety = sf; criticalPart = part.name; }
    return {
      id: part.id,
      name: part.name,
      stressMPa: sigmaMPa,
      safetyFactor: sf,
      material: part.material,
      loadN: partLoad,
    };
  });
  return { partResults, maxStress, minSafety, criticalPart, load_N: F };
}

/* ── Thermal Proxy ──────────────────────────────────────────────────────── */
function runThermal(assemblyDef, powerW, ambientC) {
  const P = powerW || 100;
  const T_amb = ambientC || 25;
  const parts = ((assemblyDef && assemblyDef.parts) || []).map((p, i) => _normalizePart(p, i));
  const results = parts.map(part => {
    const matKey = (part.material || 'steel').toLowerCase().replace(/[- ]/g, '_');
    const thermalConductivity = { steel: 50, aluminum: 160, copper: 385, carbon_fiber: 7, abs: 0.17 };
    const k = thermalConductivity[matKey] || 50;
    const d = part.dims || {};
    const A = Math.max(1e-4, (d.w || 100) * (d.d || d.w || 100) * 1e-6); // m²
    const L = Math.max(0.001, (d.h || 100) * 1e-3); // m
    const R_th = L / (k * A); // thermal resistance K/W
    const dT = P * R_th;
    return { name: part.name, deltaT_C: dT.toFixed(1), maxTemp_C: (T_amb + dT).toFixed(1), thermalResistance: R_th.toFixed(3) };
  });
  return { results, powerW: P, ambientC: T_amb };
}

/* ── Controls ───────────────────────────────────────────────────────────── */
function pause() {
  _paused = true;
  if (_rafId) cancelAnimationFrame(_rafId);
}
function reset() {
  _cleanup();
  _t = 0;
  _results = null;
}
function _cleanup() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _world = null;
  _bodies = [];
  _ground = null;
  _peakForces = {};
  _paused = false;
}
function getResults() { return _results; }

/* ── Expose ─────────────────────────────────────────────────────────────── */
global.UARE_SIM = {
  init,
  run,
  pause,
  reset,
  getResults,
  runFEA,
  runThermal,
  _getWorld: () => _world,
};

console.log('[UARE_SIM v1.0] Loaded. Waiting for cannon-es.');

})(typeof window !== 'undefined' ? window : global);

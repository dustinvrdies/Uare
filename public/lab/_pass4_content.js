
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

  // Scene state
  const partMeshes = {}; // id → mesh
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
      const mats = Array.isArray(m.mesh.material) ? m.mesh.material : [m.mesh.material];
      mats.forEach(mat => { if (mat) { mat.opacity = ops; if (m.t >= 1) { mat.transparent = false; mat.depthWrite = true; } } });
      if (m.t >= 1) { morphQueue.splice(i, 1); m.resolve && m.resolve(); }
    }
    renderer.render(scene, camera);
  }
  _animate();

  _PS = { canvas, scene, camera, renderer, orb, partMeshes, morphQueue, _orbitUpdate, _mode, ro,
    get _rafId() { return _rafId; }, set _rafId(v) { _rafId = v; } };
  return _PS;
}

/* ── §31  MORPH-ADD-PART ─────────────────────────────────────────────────── */

function morphAddPart(canvas, partDef) {
  return new Promise((resolve) => {
    const THREE = window.THREE;
    if (!THREE) { resolve(); return; }
    const ps = _initPersistentScene(canvas);
    const mesh = _buildPartMesh(partDef);
    if (!mesh) { resolve(); return; }

    // Position
    const pos = partDef.position || [0, 0, 0];
    mesh.position.set(pos[0] * UARE_CAD_UNIT, pos[1] * UARE_CAD_UNIT, pos[2] * UARE_CAD_UNIT);
    const rot = partDef.rotation || [0, 0, 0];
    mesh.rotation.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180);

    // Start from scale 0, transparent
    mesh.scale.setScalar(0.001);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(mat => { if (mat) { mat.transparent = true; mat.opacity = 0; mat.depthWrite = false; } });

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ps.scene.add(mesh);
    if (partDef.id) ps.partMeshes[partDef.id] = mesh;

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
  return new THREE.MeshStandardMaterial({
    color,
    roughness: md.roughness,
    metalness: md.metalness,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
}

/* ── §33  ADVANCED GEOMETRY GENERATORS ──────────────────────────────────── */

function _buildPartMesh(partDef) {
  const THREE = window.THREE;
  const d = partDef.dims || {};
  const mat = _makeMaterial(partDef);
  const type = (partDef.type || 'custom').toLowerCase();
  let geom;

  try {
    switch (type) {
      case 'gear':       geom = _gearGeom(d, THREE);   break;
      case 'shaft':
      case 'axle':       geom = _shaftGeom(d, THREE);  break;
      case 'spring':     geom = _springGeom(d, THREE); break;
      case 'bearing':    geom = _bearingGeom(d, THREE);break;
      case 'bolt':
      case 'bolt_nut':   geom = _boltGeom(d, THREE);   break;
      case 'piston':     geom = _pistonGeom(d, THREE); break;
      case 'pcb':        geom = _pcbGeom(d, THREE, partDef.material); break;
      case 'plate':      geom = new THREE.BoxGeometry(
        (d.w || 100) * UARE_CAD_UNIT, (d.h || 8) * UARE_CAD_UNIT, (d.d || d.w || 100) * UARE_CAD_UNIT);
        break;
      case 'beam':       geom = new THREE.BoxGeometry(
        (d.w || 40) * UARE_CAD_UNIT, (d.h || 300) * UARE_CAD_UNIT, (d.d || 40) * UARE_CAD_UNIT);
        break;
      case 'bracket':    geom = _bracketGeom(d, THREE); break;
      case 'housing':
      case 'cylinder':   geom = _housingGeom(d, THREE); break;
      case 'ibeam':      geom = _ibeamGeom(d, THREE);  break;
      case 'heat_sink':  geom = _heatSinkGeom(d, THREE);break;
      default:           geom = _defaultGeom(d, THREE); break;
    }
  } catch (e) {
    console.warn('[CAD Pass4] geom error for type=' + type, e.message);
    geom = _defaultGeom(d, THREE);
  }

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = partDef.name || type;
  mesh._partDef = partDef;
  return mesh;
}

function _defaultGeom(d, THREE) {
  const w = (d.w || d.d || 100) * UARE_CAD_UNIT;
  const h = (d.h || d.w || 100) * UARE_CAD_UNIT;
  const dep= (d.d || d.w || 100) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dep, 2, 2, 2);
}
function _housingGeom(d, THREE) {
  const w = (d.w || 200) * UARE_CAD_UNIT;
  const h = (d.h || 150) * UARE_CAD_UNIT;
  const dep= (d.d || 120) * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dep, 3, 3, 3);
}
function _shaftGeom(d, THREE) {
  const r = (d.d || 30) / 2 * UARE_CAD_UNIT;
  const L = (d.L || 300) * UARE_CAD_UNIT;
  return new THREE.CylinderGeometry(r, r, L, 24, 4);
}
function _gearGeom(d, THREE) {
  // Gear: cylinder approximation with tooth profile using custom vertices
  const teeth = d.teeth || 20;
  const module_ = d.module || 2;
  const faceW = (d.faceW || 25) * UARE_CAD_UNIT;
  const pitchR = (teeth * module_ / 2) * UARE_CAD_UNIT;
  const outerR = pitchR * 1.08;
  const rootR  = pitchR * 0.88;
  const boreR  = pitchR * 0.35;
  // Build tooth profile via shape extrusion
  const shape = new THREE.Shape();
  const N = teeth;
  const pts = [];
  for (let i = 0; i < N * 4; i++) {
    const a = (i / (N * 4)) * Math.PI * 2;
    const onTooth = (i % 4 < 2);
    const r = onTooth ? outerR : rootR;
    pts.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
  }
  shape.setFromPoints(pts);
  const hole = new THREE.Path();
  hole.absarc(0, 0, boreR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: faceW, bevelEnabled: false });
  geom.rotateX(Math.PI / 2);
  return geom;
}
function _bearingGeom(d, THREE) {
  const iR = (d.innerD || 25) / 2 * UARE_CAD_UNIT;
  const oR = (d.outerD || 52) / 2 * UARE_CAD_UNIT;
  const w  = (d.width  || 15) * UARE_CAD_UNIT;
  // Outer ring
  const outer = new THREE.CylinderGeometry(oR, oR, w, 32, 1, true);
  return outer;
}
function _springGeom(d, THREE) {
  const coils = d.coils || 10;
  const wireR = (d.wireD || 3) / 2 * UARE_CAD_UNIT;
  const outerR = (d.outerD || 25) / 2 * UARE_CAD_UNIT;
  const freeL  = (d.freeLen || 80) * UARE_CAD_UNIT;
  const pts = [];
  const segs = coils * 24;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(outerR * Math.cos(angle), freeL * (t - 0.5), outerR * Math.sin(angle)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, segs, wireR, 8, false);
}
function _boltGeom(d, THREE) {
  const shankR = (d.d || 10) / 2 * UARE_CAD_UNIT;
  const L = (d.L || 50) * UARE_CAD_UNIT;
  const headH = shankR * 2;
  const headR = shankR * 1.8;
  // Shank
  const shank = new THREE.CylinderGeometry(shankR, shankR, L, 16, 1);
  shank.translate(0, L / 2, 0);
  // Hex head
  const head = new THREE.CylinderGeometry(headR, headR, headH, 6, 1);
  head.translate(0, -headH / 2, 0);
  const merged = _mergeGeometries([shank, head], THREE);
  return merged || new THREE.CylinderGeometry(shankR, shankR, L + headH, 16, 1);
}
function _pcbGeom(d, THREE, material) {
  const w = (d.w || 100) * UARE_CAD_UNIT;
  const dep = (d.d || d.w || 80) * UARE_CAD_UNIT;
  const h = 1.6 * UARE_CAD_UNIT;
  return new THREE.BoxGeometry(w, h, dep, 1, 1, 1);
}
function _bracketGeom(d, THREE) {
  const sz = (d.w || d.sz || 100) * UARE_CAD_UNIT;
  const thick = Math.max(4, sz * 0.08);
  const web = new THREE.BoxGeometry(sz, sz * 0.7, thick);
  return web;
}
function _pistonGeom(d, THREE) {
  const r = (d.d || 86) / 2 * UARE_CAD_UNIT;
  const h = (d.h || 72) * UARE_CAD_UNIT;
  // Main cylinder body
  return new THREE.CylinderGeometry(r, r * 0.97, h, 32, 4);
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
  geom.translate(0, 0, -L / 2);
  return geom;
}
function _heatSinkGeom(d, THREE) {
  const w   = (d.w || 80) * UARE_CAD_UNIT;
  const h   = (d.h || 40) * UARE_CAD_UNIT;
  const dep = (d.d || 60) * UARE_CAD_UNIT;
  const fins= d.fins || 10;
  // Base
  const geom = new THREE.BoxGeometry(w, h * 0.3, dep, 1, 1, 1);
  // Fins will be approximated by a taller box (simplified for performance)
  return new THREE.BoxGeometry(w, h, dep, fins, 1, 1);
}

// Merge geometries helper (BufferGeometry only)
function _mergeGeometries(geoms, THREE) {
  if (THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeGeometries) {
    return THREE.BufferGeometryUtils.mergeGeometries(geoms);
  }
  return geoms[0]; // fallback: first geom
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
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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
        case 'solid':
        default:
          mat.wireframe = false;
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
          break;
      }
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
if (typeof UARE_CAD === 'undefined') {
  // Should not happen if Passes 1-3 loaded, but just in case
  var UARE_CAD = {};
}

Object.assign(UARE_CAD, {
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
});

// Ensure explode is wired on scene object too (for legacy callers)
if (_PS) {
  _PS.explode = explodeView;
}

/* END OF PASS 4 — Pass 5 will add: generative topology optimization,
   advanced FEA mesh, patent claim extractor, design iteration AI */

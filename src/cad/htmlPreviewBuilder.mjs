export function buildHtmlPreview(manifest = {}) {
  const artifacts = manifest?.artifacts || [];
  const svg = artifacts.find((item) => item.type === 'svg_preview');
  const svgTop = artifacts.find((item) => item.type === 'svg_preview_top');
  const svgFront = artifacts.find((item) => item.type === 'svg_preview_front');
  const svgSide = artifacts.find((item) => item.type === 'svg_preview_side');
  const step = artifacts.find((item) => item.type === 'step') || artifacts.find((item) => item.type === 'step_exchange');
  const stl = artifacts.find((item) => item.type === 'stl_kernel') || artifacts.find((item) => item.type === 'stl_envelope') || artifacts.find((item) => item.type === 'stl');
  const viewerManifest = artifacts.find((item) => item.type === 'viewer_manifest');
  const stlUrl = stl ? stl.url : null;
  const viewerManifestUrl = viewerManifest ? viewerManifest.url : null;

  const partCount = Array.isArray(manifest?.parts) ? manifest.parts.length : (manifest?.part_count ?? '-');
  const totalMass = manifest?.total_mass_kg != null ? `${manifest.total_mass_kg} kg` : '-';

  const viewerSection = `
  <div class="card viewer-card">
    <h2 style="margin-top:0">3D Assembly Viewer</h2>
    <div class="controls">
      <label>Explode <input id="explode" type="range" min="0" max="120" step="1" value="0" /></label>
      <label>Section <input id="section" type="range" min="-120" max="120" step="1" value="120" /></label>
      <label><input id="wireframe" type="checkbox" /> Wireframe</label>
      <span id="tri-count"></span>
    </div>
    <div id="viewport" style="width:100%;height:560px;background:#0b0d12;border-radius:12px;overflow:hidden;position:relative">
      <div id="vp-status" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#8899cc;font-size:13px;font-family:monospace">Loading assembly...</div>
    </div>
    <div class="hint">Drag to orbit, scroll to zoom, right-drag to pan. Section clipping is in millimeters.</div>
  </div>
  <script type="module">
    import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
    import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/controls/OrbitControls.js';

    async function fetchJson(url) {
      if (!url) return null;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
      } catch {
        return null;
      }
    }

    async function fetchStl(url) {
      if (!url) return null;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      const view = new DataView(buf);
      const isAscii = new TextDecoder().decode(new Uint8Array(buf, 0, 5)).startsWith('solid');
      let positions;
      let normals;

      if (isAscii) {
        const text = new TextDecoder().decode(buf);
        const posArr = [];
        const normArr = [];
        const re = /facet\\s+normal\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)[\\s\\S]*?vertex\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)\\s+vertex\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)\\s+vertex\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)\\s+([\\d.eE+\\-]+)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const nx = +m[1];
          const ny = +m[2];
          const nz = +m[3];
          posArr.push(+m[4], +m[5], +m[6], +m[7], +m[8], +m[9], +m[10], +m[11], +m[12]);
          normArr.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        }
        positions = new Float32Array(posArr);
        normals = new Float32Array(normArr);
      } else {
        const triCount = view.getUint32(80, true);
        positions = new Float32Array(triCount * 9);
        normals = new Float32Array(triCount * 9);
        let off = 84;
        for (let i = 0; i < triCount; i += 1) {
          const nx = view.getFloat32(off, true);
          const ny = view.getFloat32(off + 4, true);
          const nz = view.getFloat32(off + 8, true);
          off += 12;
          const base = i * 9;
          for (let v = 0; v < 3; v += 1) {
            positions[base + v * 3] = view.getFloat32(off, true);
            positions[base + v * 3 + 1] = view.getFloat32(off + 4, true);
            positions[base + v * 3 + 2] = view.getFloat32(off + 8, true);
            normals[base + v * 3] = nx;
            normals[base + v * 3 + 1] = ny;
            normals[base + v * 3 + 2] = nz;
            off += 12;
          }
          off += 2;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      return geo;
    }

    function partToMesh(part, material) {
      const dims = part?.dimensions_mm || {};
      const x = Math.max(Number(dims.x || dims.length || 20), 1);
      const y = Math.max(Number(dims.y || dims.width || 20), 1);
      const z = Math.max(Number(dims.z || dims.height || 20), 1);
      const kind = String(part?.shape || part?.kind || '').toLowerCase();

      let geometry;
      if (kind.includes('cyl') || kind.includes('shaft') || kind.includes('bearing') || kind.includes('tube')) {
        geometry = new THREE.CylinderGeometry(Math.max(x, y) * 0.5 * 0.001, Math.max(x, y) * 0.5 * 0.001, z * 0.001, 32);
        geometry.rotateX(Math.PI / 2);
      } else {
        geometry = new THREE.BoxGeometry(x * 0.001, y * 0.001, z * 0.001);
      }

      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.userData = { part };
      return mesh;
    }

    (async function () {
      const container = document.getElementById('viewport');
      const status = document.getElementById('vp-status');
      const explodeInput = document.getElementById('explode');
      const sectionInput = document.getElementById('section');
      const wireframeInput = document.getElementById('wireframe');
      const triCount = document.getElementById('tri-count');

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.localClippingEnabled = true;
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0d12);
      scene.add(new THREE.AmbientLight(0x2a3245, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(2, 4, 3);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x5c7cff, 0.5);
      rim.position.set(-2, 2, -3);
      scene.add(rim);
      scene.add(new THREE.GridHelper(2.5, 25, 0x27314a, 0x1b2236));

      const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.001, 1000);
      camera.position.set(1.1, 0.8, 1.5);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;

      const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.12);
      renderer.clippingPlanes = [clipPlane];

      const assemblyGroup = new THREE.Group();
      scene.add(assemblyGroup);

      const manifest = await fetchJson(${JSON.stringify(viewerManifestUrl)});
      const parts = Array.isArray(manifest?.parts) ? manifest.parts : [];
      const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8aa2c2, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide });

      if (parts.length > 0) {
        const centroid = new THREE.Vector3();
        for (const part of parts) {
          const mesh = partToMesh(part, baseMaterial);
          const t = part?.transform_mm || {};
          mesh.position.set(Number(t.x || 0) * 0.001, Number(t.y || 0) * 0.001, Number(t.z || 0) * 0.001);
          assemblyGroup.add(mesh);
          centroid.add(mesh.position);
        }
        centroid.multiplyScalar(1 / Math.max(assemblyGroup.children.length, 1));

        for (const mesh of assemblyGroup.children) {
          mesh.userData.basePosition = mesh.position.clone().sub(centroid);
          mesh.position.copy(mesh.userData.basePosition);
        }

        const box = new THREE.Box3().setFromObject(assemblyGroup);
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z, 0.2);
        camera.position.set(radius * 1.7, radius * 1.2, radius * 2.0);
        camera.lookAt(0, 0, 0);
        controls.update();

        if (triCount) {
          let tris = 0;
          for (const mesh of assemblyGroup.children) {
            const pos = mesh.geometry?.attributes?.position;
            if (pos) tris += Math.floor(pos.count / 3);
          }
          triCount.textContent = tris.toLocaleString() + ' triangles (assembly primitives)';
        }
      } else if (${JSON.stringify(stlUrl)} ) {
        const stlGeometry = await fetchStl(${JSON.stringify(stlUrl)});
        const mesh = new THREE.Mesh(stlGeometry, baseMaterial);
        mesh.scale.setScalar(0.001);
        const box = new THREE.Box3().setFromObject(mesh);
        const ctr = box.getCenter(new THREE.Vector3());
        mesh.position.sub(ctr);
        assemblyGroup.add(mesh);
      }

      if (status) status.remove();

      function applyExplode(mm) {
        const factor = Number(mm || 0) * 0.0005;
        for (const mesh of assemblyGroup.children) {
          const base = mesh.userData.basePosition || mesh.position;
          const dir = base.clone();
          if (dir.lengthSq() < 1e-12) dir.set(0.001, 0.001, 0.001);
          dir.normalize();
          mesh.position.copy(base).addScaledVector(dir, factor);
        }
      }

      function applySection(mm) {
        clipPlane.constant = Number(mm || 0) * 0.001;
      }

      if (explodeInput) {
        explodeInput.addEventListener('input', () => applyExplode(explodeInput.value));
      }
      if (sectionInput) {
        sectionInput.addEventListener('input', () => applySection(sectionInput.value));
        applySection(sectionInput.value);
      }
      if (wireframeInput) {
        wireframeInput.addEventListener('change', () => {
          for (const mesh of assemblyGroup.children) {
            if (mesh.material) mesh.material.wireframe = wireframeInput.checked;
          }
        });
      }

      const ro = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      ro.observe(container);

      (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      })();
    })();
  </script>`;

  const svgGallery = [svg, svgTop, svgFront, svgSide].filter(Boolean).map((item) => {
    return `<a class="view-link" href="${item.url}" target="_blank">${item.type} (${item.filename})</a>`;
  }).join('');

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>UARE CAD Preview - ' + (manifest?.execution_id || 'unknown') + '</title>',
    '<style>',
    '*{box-sizing:border-box}',
    'body{font-family:Inter,Arial,sans-serif;background:#0f1117;color:#e2e8f0;margin:0;padding:24px}',
    'h1{margin:0 0 20px;font-size:20px;font-weight:700;color:#fff}',
    'h2{font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#8899cc;margin:0 0 12px}',
    '.card{background:#161b28;border:1px solid #1e293b;border-radius:14px;padding:18px;margin-bottom:16px}',
    '.viewer-card{padding:18px}',
    '.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:0}',
    '.meta-item{background:#1a2236;border-radius:8px;padding:10px 12px}',
    '.meta-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}',
    '.meta-val{font-size:15px;font-weight:600;color:#e2e8f0}',
    '.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:8px 0 10px;color:#cdd6f4;font-size:12px}',
    '.controls input[type="range"]{width:180px}',
    '.hint{margin-top:8px;font-size:12px;color:#7e8aa6}',
    '.view-links{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}',
    '.view-link{display:inline-block;padding:8px 10px;background:#1a2236;border:1px solid #23314e;border-radius:8px;font-size:12px}',
    'ul{margin:0;padding-left:20px}',
    'li{margin-bottom:6px;font-size:13px}',
    'a{color:#60a5fa;text-decoration:none}',
    'a:hover{text-decoration:underline}',
    'code{background:#1e293b;border-radius:4px;padding:1px 5px;font-size:12px;color:#93c5fd}',
    '</style>',
    '</head><body>',
    '<h1>UARE CAD Execution Preview</h1>',
    '<div class="card">',
    '  <div class="meta">',
    `    <div class="meta-item"><div class="meta-label">Execution ID</div><div class="meta-val"><code>${manifest?.execution_id || 'unknown'}</code></div></div>`,
    `    <div class="meta-item"><div class="meta-label">Status</div><div class="meta-val">${manifest?.status || 'unknown'}</div></div>`,
    `    <div class="meta-item"><div class="meta-label">Parts</div><div class="meta-val">${partCount}</div></div>`,
    `    <div class="meta-item"><div class="meta-label">Total Mass</div><div class="meta-val">${totalMass}</div></div>`,
    `    <div class="meta-item"><div class="meta-label">Deterministic</div><div class="meta-val">${String(Boolean(manifest?.deterministic))}</div></div>`,
    '  </div>',
    svgGallery ? `<div class="view-links">${svgGallery}</div>` : '',
    '</div>',
    viewerSection,
    '<div class="card"><h2>Artifacts</h2><ul>',
    ...artifacts.map((item) => `<li><a href="${item.url}" target="_blank">${item.type} - ${item.filename}</a></li>`),
    '</ul></div>',
    step ? `<div class="card"><h2>STEP Download</h2><a href="${step.url}" download="${step.filename}">${step.filename}</a> - full B-Rep solid for CAD import</div>` : '',
    '</body></html>',
  ].join('\n');
}

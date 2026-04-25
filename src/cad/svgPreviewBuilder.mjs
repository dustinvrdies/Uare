function line(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1e293b" stroke-width="1.5" />`;
}
function text(x, y, content, opts = {}) {
  const size = opts.size || 13;
  const fill = opts.fill || '#1e293b';
  const weight = opts.bold ? 'font-weight="600"' : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="Inter,Arial,sans-serif" fill="${fill}" ${weight}>${content}</text>`;
}
function rect(x, y, w, h, opts = {}) {
  const rx = opts.rx != null ? opts.rx : 4;
  const fill = opts.fill || '#f8fafc';
  const stroke = opts.stroke || '#1e293b';
  const sw = opts.sw || 1.5;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
}
function circle(cx, cy, r, opts = {}) {
  const fill = opts.fill || 'none';
  const stroke = opts.stroke || '#1e293b';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`;
}
function dim(x1, y1, x2, y2, label, offset = 12) {
  // Horizontal or vertical dimension line with arrows and label
  const horiz = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const lines = [];
  if (horiz) {
    const my = Math.max(y1, y2) + offset;
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x1}" y2="${my}" stroke="#4a9eff" stroke-width="1" stroke-dasharray="3,2" />`);
    lines.push(`<line x1="${x2}" y1="${y2}" x2="${x2}" y2="${my}" stroke="#4a9eff" stroke-width="1" stroke-dasharray="3,2" />`);
    lines.push(`<line x1="${x1}" y1="${my}" x2="${x2}" y2="${my}" stroke="#4a9eff" stroke-width="1.2" marker-end="url(#arr)" marker-start="url(#arr)" />`);
    lines.push(`<text x="${(x1+x2)/2}" y="${my+14}" text-anchor="middle" font-size="11" font-family="Inter,Arial,sans-serif" fill="#4a9eff">${label}</text>`);
  } else {
    const mx = Math.max(x1, x2) + offset;
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${mx}" y2="${y1}" stroke="#4a9eff" stroke-width="1" stroke-dasharray="3,2" />`);
    lines.push(`<line x1="${x2}" y1="${y2}" x2="${mx}" y2="${y2}" stroke="#4a9eff" stroke-width="1" stroke-dasharray="3,2" />`);
    lines.push(`<line x1="${mx}" y1="${y1}" x2="${mx}" y2="${y2}" stroke="#4a9eff" stroke-width="1.2" marker-end="url(#arr)" marker-start="url(#arr)" />`);
    lines.push(`<text x="${mx+14}" y="${(y1+y2)/2+4}" font-size="11" font-family="Inter,Arial,sans-serif" fill="#4a9eff">${label}</text>`);
  }
  return lines.join('\n');
}

const ARROW_MARKER = `<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#4a9eff" stroke-width="1"/></marker></defs>`;

/**
 * Build an SVG 3-view orthographic drawing accurately sized for the given dimensions.
 * Automatically adapts labels and shape profiles to part type.
 */
export function buildSvgPreview({ length = 120, width = 40, height = 30, hole = 8, executionId = 'exec', partType = '', partName = '', totalParts = 1, singleView = null } = {}) {
  // Scale so the longest dimension fits within ~320px
  const maxDim = Math.max(length, width, height, 1);
  const scale = Math.min(3.0, 280 / maxDim);
  const L = Math.max(20, Math.round(length * scale));
  const W = Math.max(12, Math.round(width  * scale));
  const H = Math.max(12, Math.round(height * scale));
  const holeR = Math.max(2, Math.round((hole / 2) * scale));

  // Detect whether this looks cylindrical/rotational (e.g. engine, shaft, piston)
  const isCylindrical = ['engine_block','piston','crankshaft','shaft','cylinder','impeller','bearing','flywheel','camshaft','turbocharger','spring','gear'].some(k => (partType||'').includes(k));
  const isSheet = ['gasket','washer','plate','pcb','shim'].some(k => (partType||'').includes(k));

  const mode = singleView ? String(singleView).toLowerCase() : null;
  const showTop = !mode || mode === 'top';
  const showFront = !mode || mode === 'front';
  const showSide = !mode || mode === 'side';

  // SVG canvas: 900 × 500 (compact for single views)
  const SVG_W = mode ? 560 : 900;
  const SVG_H = mode ? 360 : 500;
  const pad = 40;

  // ── View origins (top-left of each view rect) ────────────────────────────
  const topX = pad;
  const topY = pad + 30;
  const frontX = mode ? pad : pad;
  const frontY = mode ? pad + 30 : topY + W + 60;
  const sideX = mode ? pad : pad + L + 60;
  const sideY = mode ? pad + 30 : topY;

  // ── Top view ─────────────────────────────────────────────────────────────
  const topView = showTop ? [
    rect(topX, topY, L, W),
    isCylindrical ? circle(topX + L/2, topY + W/2, Math.min(L, W)/2, { fill:'#eef2ff', stroke:'#4a9eff' }) : '',
    isSheet ? '' : circle(topX + L/2, topY + W/2, holeR, { fill:'#e0e7ff' }),
    dim(topX, topY, topX + L, topY, `${length} mm`, -18),
    dim(topX, topY, topX, topY + W, `${width} mm`, -18),
    text(topX + L/2, topY + W/2 + 4, isCylindrical ? '⊙' : '', { size: 16, fill:'#4a9eff' }),
    text(topX + L/2, topY - 6, 'TOP', { size: 10, fill:'#6b7280', bold: true }),
  ].filter(Boolean).join('\n') : '';

  // ── Front view ───────────────────────────────────────────────────────────
  const frontView = showFront ? [
    rect(frontX, frontY, L, H),
    isCylindrical ? '' : line(frontX + L*0.2, frontY, frontX + L*0.2, frontY + H),
    isCylindrical ? '' : line(frontX + L*0.8, frontY, frontX + L*0.8, frontY + H),
    dim(frontX, frontY, frontX + L, frontY, `${length} mm`, -18),
    dim(frontX, frontY + H, frontX, frontY, `${height} mm`, -18),
    text(frontX + L/2, frontY - 6, 'FRONT', { size: 10, fill:'#6b7280', bold: true }),
  ].filter(Boolean).join('\n') : '';

  // ── Side view ─────────────────────────────────────────────────────────────
  const sideView = showSide ? [
    isCylindrical ? circle(sideX + W/2, sideY + H/2, Math.min(W, H)/2, { fill:'#eef2ff', stroke:'#4a9eff' }) : rect(sideX, sideY, W, H),
    dim(sideX, sideY, sideX + W, sideY, `${width} mm`, -18),
    dim(sideX + W, sideY, sideX + W, sideY + H, `${height} mm`, 14),
    text(sideX + W/2, sideY - 6, 'SIDE', { size: 10, fill:'#6b7280', bold: true }),
  ].filter(Boolean).join('\n') : '';

  // ── Info panel ────────────────────────────────────────────────────────────
  const infoX = mode ? pad : Math.max(sideX + W + 40, pad + L + 100);
  const infoPanel = [
    text(infoX, pad + 30, 'UARE CAD — Execution Preview', { size: 14, bold: true, fill:'#0f172a' }),
    text(infoX, pad + 52, `ID: ${executionId}`, { size: 11, fill:'#6b7280' }),
    text(infoX, pad + 80, partName ? partName.slice(0, 42) : (partType || 'Assembly'), { size: 12, bold: true, fill:'#1e293b' }),
    text(infoX, pad + 100, `Parts: ${totalParts}`, { size: 11, fill:'#374151' }),
    text(infoX, pad + 118, `L × W × H  (mm)`, { size: 11, fill:'#6b7280' }),
    text(infoX, pad + 134, `${length} × ${width} × ${height}`, { size: 13, bold: true, fill:'#1e40af' }),
    hole > 0 && !isSheet ? text(infoX, pad + 154, `Bore/Hole: Ø${hole} mm`, { size: 11, fill:'#374151' }) : '',
    text(infoX, SVG_H - 50, mode ? `View mode: ${mode}` : 'Envelope preview; kernel geometry in assembly_kernel.stl / assembly.step', { size: 10, fill:'#9ca3af' }),
  ].filter(Boolean).join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">`,
    `<rect width="${SVG_W}" height="${SVG_H}" fill="#f0f4f8" />`,
    `<rect x="1" y="1" width="${SVG_W-2}" height="${SVG_H-2}" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1" />`,
    ARROW_MARKER,
    topView,
    frontView,
    sideView,
    infoPanel,
    `</svg>`,
  ].join('\n');
}

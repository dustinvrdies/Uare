/**
 * UARE Complete UI Rewrite Builder
 * Run: node _rewrite.mjs
 * Writes: index.html, styles.css, enki.js
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const D = dirname(fileURLToPath(import.meta.url));
const w = (f, c) => { writeFileSync(join(D, f), c, 'utf8'); console.log('✓ wrote', f, Math.round(c.length/1024)+'KB'); };

/* ═══════════════════════════════════════════════════════════════════════════
   INDEX.HTML
   ═══════════════════════════════════════════════════════════════════════════ */
w('index.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UARE — AI Engineering Workstation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/lab/styles.css" />
</head>
<body>
  <canvas id="ambient-bg" aria-hidden="true"></canvas>

  <div id="app-shell">

    <!-- ── Top Bar ── -->
    <header id="topbar">
      <div class="brand">
        <div class="brand-mark">U</div>
        <div>
          <span class="brand-name">UARE</span>
          <span class="brand-sub">AI Engineering Workstation</span>
        </div>
      </div>
      <div id="tb-center">
        <span id="assembly-name-display">No assembly loaded</span>
        <span id="assembly-part-count" class="chip hidden"></span>
        <div id="enki-live" class="live-indicator hidden">
          <span class="pulse-dot"></span>
          <span id="enki-live-msg">Working&hellip;</span>
        </div>
      </div>
      <div id="tb-actions">
        <button class="tb-btn" id="btn-tree" title="Toggle assembly tree">&#9776; Tree</button>
        <button class="tb-btn" id="btn-export-step" title="Export STEP file">&darr; STEP</button>
        <button class="tb-btn" id="btn-export-obj" title="Export OBJ file">&darr; OBJ</button>
        <button class="tb-btn" id="btn-export-stl" title="Export STL file">&darr; STL</button>
        <button class="tb-btn accent" id="btn-new">&#65291; New Design</button>
      </div>
    </header>

    <!-- ── Main Split ── -->
    <div id="split">

      <!-- LEFT: Enki Chat Panel -->
      <section id="chat-panel" aria-label="Enki AI Chat">
        <div id="chat-head">
          <div class="enki-av-wrap">
            <div class="enki-av">E</div>
            <span class="enki-dot"></span>
          </div>
          <div>
            <div class="enki-name-lbl">Enki</div>
            <div id="enki-status-lbl" class="enki-sub">Engineering AI &middot; Ready</div>
          </div>
          <button class="tb-btn ghost sm" id="btn-clear">Clear</button>
        </div>

        <div id="chat-msgs" role="log" aria-live="polite"></div>

        <div id="suggestions-row"></div>

        <div id="chat-input-area">
          <textarea id="chat-input" rows="3"
            placeholder="Describe your design&hellip; e.g. &quot;Design a turbocharged 4-cylinder engine with forged steel pistons, cast aluminum block, and dual overhead cams&quot;"
            aria-label="Message Enki"></textarea>
          <div id="chat-footer">
            <span class="hint-text"><kbd>Enter</kbd> send &nbsp;&middot;&nbsp; <kbd>Shift+Enter</kbd> newline</span>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="icon-btn" id="btn-voice" title="Voice input" aria-label="Voice input">&#127908;</button>
              <button id="send-btn" aria-label="Send message">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- RIGHT: 3D Viewport -->
      <section id="viewport-panel" aria-label="3D CAD Viewport">

        <!-- Assembly Tree slide-in -->
        <aside id="asm-tree" class="side-panel collapsed" aria-label="Assembly Tree">
          <div class="side-panel-head">
            <span>Assembly Tree</span>
            <button class="tb-btn ghost sm" id="btn-tree-close">&#10005;</button>
          </div>
          <div id="asm-tree-content"></div>
          <div id="asm-bom"></div>
        </aside>

        <!-- Part properties slide-in -->
        <aside id="part-props" class="side-panel right-panel collapsed" aria-label="Part Properties">
          <div class="side-panel-head">
            <span id="part-props-title">Part Properties</span>
            <button class="tb-btn ghost sm" id="btn-props-close">&#10005;</button>
          </div>
          <div id="part-props-content"></div>
        </aside>

        <!-- 3D Canvas -->
        <canvas id="cad-canvas"></canvas>

        <!-- Viewport overlay controls -->
        <div id="vp-controls" aria-label="Viewport controls">
          <div class="vp-btn-group">
            <button class="vp-btn" data-vp="fit" title="Fit to view">&#10148;</button>
            <button class="vp-btn" data-vp="front" title="Front view">F</button>
            <button class="vp-btn" data-vp="top" title="Top view">T</button>
            <button class="vp-btn" data-vp="iso" title="Isometric view">ISO</button>
          </div>
          <div class="vp-btn-group">
            <button class="vp-btn active" data-mode="solid">Solid</button>
            <button class="vp-btn" data-mode="wire">Wire</button>
            <button class="vp-btn" data-mode="xray">X-Ray</button>
          </div>
          <button class="vp-btn explode-btn" id="btn-explode">&#128165; Explode</button>
        </div>

        <!-- Enki action status overlay (shows during generation) -->
        <div id="action-overlay" class="hidden" aria-live="polite">
          <div class="action-ring"></div>
          <span id="action-text">Generating geometry&hellip;</span>
          <div id="action-progress-bar"><div id="action-progress-fill"></div></div>
        </div>

        <!-- Coordinate HUD -->
        <div id="coord-hud" aria-label="Coordinates">
          <span id="hud-x">X 0.00</span>
          <span id="hud-y">Y 0.00</span>
          <span id="hud-z">Z 0.00</span>
          <span id="hud-scale">1:1</span>
        </div>

        <!-- Empty state -->
        <div id="viewport-empty">
          <div class="empty-icon">&#9672;</div>
          <h3>Canvas is empty</h3>
          <p>Tell Enki what you want to design and a fully parametric 3D assembly will appear here.</p>
        </div>
      </section>

    </div><!-- /split -->

    <!-- ── Bottom Simulation Bar ── -->
    <footer id="sim-bar" aria-label="Simulation controls">
      <div id="sim-left">
        <span id="sim-status" class="sim-badge idle">&#9679; Idle</span>
        <button class="sim-btn primary" id="btn-sim-run" title="Run physics simulation">&#9654; Run Physics</button>
        <button class="sim-btn" id="btn-sim-pause" disabled title="Pause simulation">&#9646;&#9646; Pause</button>
        <button class="sim-btn" id="btn-sim-reset" disabled title="Reset simulation">&#8635; Reset</button>
        <div class="sim-sep"></div>
        <button class="sim-btn" id="btn-fea" title="Run Finite Element Analysis">&#9889; FEA</button>
        <button class="sim-btn" id="btn-stress" title="Stress heatmap">&#127777; Stress Map</button>
        <button class="sim-btn" id="btn-thermal" title="Thermal analysis">&#128293; Thermal</button>
      </div>
      <div id="sim-metrics">
        <div class="metric"><span class="m-label">Parts</span><span class="m-val" id="m-parts">0</span></div>
        <div class="metric"><span class="m-label">Mass</span><span class="m-val" id="m-mass">0 kg</span></div>
        <div class="metric"><span class="m-label">Sim Time</span><span class="m-val" id="m-simtime">0.0 s</span></div>
        <div class="metric"><span class="m-label">FPS</span><span class="m-val" id="m-fps">&ndash;</span></div>
        <div class="metric"><span class="m-label">&sigma; max</span><span class="m-val" id="m-stress">&ndash; MPa</span></div>
        <div class="metric"><span class="m-label">Safety</span><span class="m-val" id="m-safety">&ndash;</span></div>
      </div>
      <div id="sim-result-text"></div>
    </footer>

  </div><!-- /app-shell -->

  <!-- Scripts: load order matters -->
  <script src="/lab/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js"></script>
  <script src="/lab/cad-engine.js"></script>
  <script src="/lab/sim-engine.js"></script>
  <script src="/lab/enki.js"></script>
  <script type="module" src="/lab/app.js"></script>
</body>
</html>`);

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES.CSS
   ═══════════════════════════════════════════════════════════════════════════ */
w('styles.css', `/* UARE AI Engineering Workstation — Professional Dark Theme */
:root {
  color-scheme: dark;
  --bg:       #080d1a;
  --bg2:      #0c1220;
  --panel:    rgba(11,16,30,0.97);
  --panel2:   rgba(14,20,36,0.99);
  --inset:    rgba(255,255,255,0.025);
  --border:   rgba(255,255,255,0.065);
  --border2:  rgba(255,255,255,0.13);
  --text:     #e6f0fc;
  --text2:    #8aa5c0;
  --text3:    #506070;
  --cyan:     #00d4ff;
  --cyan2:    #54d7ff;
  --violet:   #7c5cff;
  --green:    #00e87a;
  --amber:    #ffb840;
  --red:      #ff4d6a;
  --orange:   #ff7a30;
  --r:        14px;
  --r2:       10px;
  --shadow:   0 20px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04);
}

*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body {
  background:
    radial-gradient(ellipse 80% 50% at 20% 0%, rgba(0,212,255,.06), transparent),
    radial-gradient(ellipse 60% 40% at 80% 0%, rgba(124,92,255,.08), transparent),
    var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
button { border: none; cursor: pointer; font: inherit; }
textarea, input { font: inherit; }

/* ── Ambient Canvas ── */
#ambient-bg {
  position: fixed; inset: 0; width: 100%; height: 100%;
  pointer-events: none; z-index: 0; opacity: 0.28;
}

/* ── App Shell ── */
#app-shell {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  height: 100vh; width: 100vw;
  overflow: hidden;
}

/* ── Top Bar ── */
#topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 0 18px; height: 52px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0; z-index: 100;
}
.brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.brand-mark {
  width: 34px; height: 34px; border-radius: 10px;
  background: linear-gradient(135deg, var(--cyan) 0%, var(--violet) 100%);
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 16px; color: #fff;
  box-shadow: 0 0 16px rgba(0,212,255,.3);
}
.brand-name { font-weight: 800; font-size: 15px; letter-spacing: -0.4px; color: var(--text); }
.brand-sub   { font-size: 10px; color: var(--text3); display: block; margin-top: -1px; }
#tb-center { flex: 1; display: flex; align-items: center; gap: 12px; overflow: hidden; }
#assembly-name-display { font-size: 13px; font-weight: 500; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip {
  padding: 2px 9px; border-radius: 20px;
  background: rgba(0,212,255,.1); color: var(--cyan2);
  font-size: 11px; border: 1px solid rgba(0,212,255,.2);
  flex-shrink: 0;
}
.hidden { display: none !important; }
.live-indicator {
  display: flex; align-items: center; gap: 7px;
  padding: 3px 10px; border-radius: 20px;
  background: rgba(0,232,122,.08);
  border: 1px solid rgba(0,232,122,.2);
  font-size: 11px; color: var(--green); flex-shrink: 0;
}
.pulse-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--green);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.3)} }
#tb-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.tb-btn {
  padding: 5px 12px; border-radius: var(--r2);
  background: rgba(255,255,255,.05); border: 1px solid var(--border);
  color: var(--text2); font-size: 12px; font-weight: 500;
  transition: background .15s, color .15s, border-color .15s, transform .1s;
  white-space: nowrap;
}
.tb-btn:hover { background: rgba(255,255,255,.09); color: var(--text); border-color: var(--border2); transform: translateY(-1px); }
.tb-btn:active { transform: translateY(0); }
.tb-btn.accent {
  background: linear-gradient(135deg, rgba(0,212,255,.25), rgba(124,92,255,.25));
  color: var(--cyan2); border-color: rgba(0,212,255,.3); font-weight: 600;
}
.tb-btn.accent:hover { background: linear-gradient(135deg, rgba(0,212,255,.4), rgba(124,92,255,.4)); color: #fff; }
.tb-btn.ghost { background: transparent; border-color: transparent; color: var(--text3); }
.tb-btn.ghost:hover { background: rgba(255,255,255,.06); color: var(--text2); border-color: transparent; transform: none; }
.tb-btn.sm { padding: 3px 8px; font-size: 11px; }

/* ── Main Split ── */
#split {
  display: grid;
  grid-template-columns: 420px minmax(0, 1fr);
  flex: 1; overflow: hidden;
}

/* ── Chat Panel ── */
#chat-panel {
  display: flex; flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
}
#chat-head {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 16px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.enki-av-wrap { position: relative; flex-shrink: 0; }
.enki-av {
  width: 38px; height: 38px; border-radius: 50%;
  background: linear-gradient(135deg, var(--cyan) 0%, var(--violet) 100%);
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 17px; color: #fff;
  box-shadow: 0 0 20px rgba(0,212,255,.25);
}
.enki-dot {
  position: absolute; bottom: 1px; right: 1px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--green); border: 2px solid var(--panel);
}
.enki-name-lbl { font-weight: 700; font-size: 14px; color: var(--text); }
.enki-sub { font-size: 11px; color: var(--text3); margin-top: 1px; }
#chat-head > div:nth-child(2) { flex: 1; }

/* ── Messages ── */
#chat-msgs {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 14px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.07) transparent;
}
#chat-msgs::-webkit-scrollbar { width: 4px; }
#chat-msgs::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

.msg { display: flex; flex-direction: column; max-width: 90%; animation: msgIn .25s ease; }
@keyframes msgIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.msg-user { align-self: flex-end; }
.msg-assistant { align-self: flex-start; }
.msg-bubble {
  padding: 10px 14px; border-radius: 14px;
  font-size: 13px; line-height: 1.65; color: var(--text);
}
.msg-user .msg-bubble {
  background: linear-gradient(135deg, rgba(0,212,255,.15), rgba(124,92,255,.15));
  border: 1px solid rgba(0,212,255,.2);
  border-bottom-right-radius: 3px;
}
.msg-assistant .msg-bubble {
  background: rgba(255,255,255,.035);
  border: 1px solid var(--border);
  border-bottom-left-radius: 3px;
}
.msg-bubble strong { color: var(--cyan2); }
.msg-bubble em { color: var(--text2); font-style: italic; }
.msg-bubble code {
  background: rgba(0,212,255,.1); padding: 1px 5px; border-radius: 4px;
  font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--cyan2);
}
.msg-bubble pre {
  background: rgba(0,0,0,.35); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px; margin-top: 8px;
  overflow-x: auto; font-family: 'JetBrains Mono', monospace; font-size: 11px;
}
.msg-bubble ul { padding-left: 16px; margin-top: 6px; }
.msg-bubble li { margin-bottom: 3px; }
.msg-time { font-size: 10px; color: var(--text3); margin-top: 4px; padding: 0 2px; }
.msg-user .msg-time { text-align: right; }

/* Part-build badge list */
.part-badges { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.part-badge {
  font-size: 10.5px; padding: 2px 9px; border-radius: 20px;
  border: 1px solid var(--border); color: var(--text2);
  transition: all .2s;
}
.part-badge.pending { color: var(--amber); border-color: rgba(255,184,64,.25); background: rgba(255,184,64,.06); }
.part-badge.building { color: var(--cyan2); border-color: rgba(0,212,255,.3); background: rgba(0,212,255,.08); animation: badgePulse 1s ease-in-out infinite; }
.part-badge.done { color: var(--green); border-color: rgba(0,232,122,.25); background: rgba(0,232,122,.07); }
@keyframes badgePulse { 0%,100%{opacity:.7} 50%{opacity:1} }

/* Typing indicator */
.typing-dots { display: inline-flex; gap: 4px; align-items: center; padding: 3px 0; }
.typing-dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--cyan2); animation: tdot 1.1s infinite;
}
.typing-dots span:nth-child(2) { animation-delay:.18s; }
.typing-dots span:nth-child(3) { animation-delay:.36s; }
@keyframes tdot { 0%,80%,100%{opacity:.2;transform:scale(.75)} 40%{opacity:1;transform:scale(1)} }

/* ── Suggestions Row ── */
#suggestions-row {
  padding: 0 16px 10px;
  display: flex; gap: 7px; flex-wrap: wrap; flex-shrink: 0;
}
.sug-chip {
  padding: 5px 12px; border-radius: 20px;
  background: rgba(124,92,255,.09);
  border: 1px solid rgba(124,92,255,.2);
  color: #a090f8; font-size: 11.5px; cursor: pointer;
  transition: all .15s;
}
.sug-chip:hover { background: rgba(124,92,255,.2); color: #c5b8ff; transform: translateY(-1px); }

/* ── Chat Input ── */
#chat-input-area {
  border-top: 1px solid var(--border);
  padding: 12px 14px; flex-shrink: 0;
  background: rgba(0,0,0,.15);
}
#chat-input {
  width: 100%; resize: none;
  background: rgba(255,255,255,.04);
  border: 1px solid var(--border); border-radius: var(--r2);
  color: var(--text); padding: 10px 12px;
  font-size: 13px; line-height: 1.5; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
#chat-input:focus {
  border-color: rgba(0,212,255,.4);
  box-shadow: 0 0 0 3px rgba(0,212,255,.07);
}
#chat-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 9px;
}
.hint-text { font-size: 10.5px; color: var(--text3); }
.hint-text kbd {
  background: rgba(255,255,255,.08); border: 1px solid var(--border);
  border-radius: 4px; padding: 1px 5px; font-family: inherit; font-size: 10px;
}
.icon-btn {
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255,255,255,.05); border: 1px solid var(--border);
  color: var(--text3); display: flex; align-items: center; justify-content: center;
  font-size: 14px; transition: all .15s;
}
.icon-btn:hover { background: rgba(255,255,255,.09); color: var(--text2); }
#send-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, var(--cyan), var(--violet));
  color: #fff; display: flex; align-items: center; justify-content: center;
  transition: opacity .15s, transform .1s;
  box-shadow: 0 4px 16px rgba(0,212,255,.3);
}
#send-btn:hover { opacity: .9; transform: scale(1.05); }
#send-btn:active { transform: scale(.93); }
#send-btn:disabled { opacity: .3; cursor: not-allowed; transform: none; box-shadow: none; }

/* ── Viewport Panel ── */
#viewport-panel {
  position: relative; background: var(--bg2); overflow: hidden;
}
#cad-canvas {
  display: block; width: 100%; height: 100%; outline: none;
  cursor: grab;
}
#cad-canvas:active { cursor: grabbing; }

/* ── Side Panels ── */
.side-panel {
  position: absolute; top: 0; bottom: 0; width: 270px; z-index: 50;
  background: var(--panel2); border: 1px solid var(--border);
  display: flex; flex-direction: column;
  transition: transform .28s cubic-bezier(.4,0,.2,1);
  overflow: hidden;
}
.side-panel.collapsed { transform: translateX(-105%); pointer-events: none; }
#asm-tree { left: 0; border-radius: 0 var(--r) var(--r) 0; }
.right-panel { right: 0; left: auto; border-radius: var(--r) 0 0 var(--r); }
.right-panel.collapsed { transform: translateX(105%); }
.side-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; border-bottom: 1px solid var(--border);
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.6px; color: var(--text2); flex-shrink: 0;
}
#asm-tree-content { flex: 1; overflow-y: auto; padding: 8px; }
.tree-item {
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; gap: 9px;
  font-size: 12px; color: var(--text2); transition: background .1s;
  user-select: none;
}
.tree-item:hover { background: rgba(255,255,255,.05); color: var(--text); }
.tree-item.selected { background: rgba(0,212,255,.1); color: var(--cyan2); }
.tree-icon { font-size: 14px; flex-shrink: 0; }
.tree-label { flex: 1; }
.tree-sub { font-size: 10px; color: var(--text3); }
#asm-bom {
  padding: 10px; border-top: 1px solid var(--border);
  font-size: 11px; flex-shrink: 0;
}
.bom-header { font-weight: 700; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
.bom-row {
  display: flex; justify-content: space-between;
  padding: 3px 4px; border-radius: 4px; color: var(--text3);
}
.bom-row:hover { background: rgba(255,255,255,.04); color: var(--text2); }
.bom-row .qty { color: var(--cyan2); font-weight: 600; }
#part-props-content { flex: 1; overflow-y: auto; padding: 12px; }
.prop-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
.prop-row:last-child { border-bottom: none; }
.prop-label { font-size: 11px; color: var(--text3); }
.prop-val { font-size: 12px; color: var(--text); font-weight: 500; font-family: 'JetBrains Mono', monospace; }

/* ── Viewport Controls ── */
#vp-controls {
  position: absolute; top: 14px; right: 14px;
  display: flex; flex-direction: column; gap: 8px; z-index: 20;
}
.vp-btn-group { display: flex; gap: 3px; }
.vp-btn {
  padding: 5px 11px; border-radius: 8px;
  background: rgba(8,13,26,.82); border: 1px solid var(--border);
  color: var(--text2); font-size: 11px; font-weight: 500;
  backdrop-filter: blur(8px); transition: all .15s;
}
.vp-btn:hover { background: rgba(255,255,255,.1); color: var(--text); border-color: var(--border2); }
.vp-btn.active { background: rgba(0,212,255,.15); color: var(--cyan2); border-color: rgba(0,212,255,.3); }
.explode-btn { margin-top: 3px; }

/* ── Action Overlay ── */
#action-overlay {
  position: absolute; bottom: 54px; left: 14px;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-radius: 12px;
  background: rgba(8,13,26,.94); border: 1px solid rgba(0,212,255,.2);
  backdrop-filter: blur(14px); z-index: 20;
  min-width: 200px; flex-wrap: wrap;
}
.action-ring {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--cyan); border-right-color: var(--violet);
  animation: spin .7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
#action-text { font-size: 12px; color: var(--text); flex: 1; }
#action-progress-bar {
  width: 100%; height: 3px; border-radius: 2px;
  background: rgba(255,255,255,.08); margin-top: 2px;
  overflow: hidden;
}
#action-progress-fill {
  height: 100%; width: 0%; border-radius: 2px;
  background: linear-gradient(90deg, var(--cyan), var(--violet));
  transition: width .3s ease;
}

/* ── Coord HUD ── */
#coord-hud {
  position: absolute; bottom: 14px; right: 14px;
  display: flex; gap: 12px;
  background: rgba(8,13,26,.82); border: 1px solid var(--border);
  border-radius: 8px; padding: 5px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--text3);
  backdrop-filter: blur(8px); z-index: 20;
}

/* ── Viewport Empty State ── */
#viewport-empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; pointer-events: none; z-index: 10;
}
.empty-icon { font-size: 52px; opacity: .12; }
#viewport-empty h3 { font-size: 17px; font-weight: 600; color: var(--text2); opacity: .5; }
#viewport-empty p { font-size: 13px; color: var(--text3); text-align: center; max-width: 260px; opacity: .45; line-height: 1.6; }
#viewport-empty.hidden { display: none; }

/* ── Simulation Bar ── */
#sim-bar {
  display: flex; align-items: center; gap: 14px;
  padding: 0 18px; height: 46px;
  background: var(--panel); border-top: 1px solid var(--border);
  flex-shrink: 0; z-index: 100;
}
#sim-left { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.sim-badge {
  padding: 3px 9px; border-radius: 20px;
  font-size: 11px; font-weight: 600; border: 1px solid transparent;
}
.sim-badge.idle { color: var(--text3); border-color: var(--border); }
.sim-badge.running { color: var(--green); border-color: rgba(0,232,122,.3); background: rgba(0,232,122,.08); }
.sim-badge.complete { color: var(--cyan2); border-color: rgba(0,212,255,.3); background: rgba(0,212,255,.08); }
.sim-badge.fail { color: var(--red); border-color: rgba(255,77,106,.3); background: rgba(255,77,106,.08); }
.sim-btn {
  padding: 5px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 500;
  background: rgba(255,255,255,.05); border: 1px solid var(--border); color: var(--text2);
  transition: all .15s;
}
.sim-btn:hover:not(:disabled) { background: rgba(255,255,255,.09); color: var(--text); }
.sim-btn:disabled { opacity: .3; cursor: not-allowed; }
.sim-btn.primary {
  background: linear-gradient(135deg, rgba(0,212,255,.18), rgba(124,92,255,.18));
  color: var(--cyan2); border-color: rgba(0,212,255,.28);
}
.sim-btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(0,212,255,.3), rgba(124,92,255,.3));
}
.sim-sep { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; }
#sim-metrics {
  display: flex; gap: 18px; flex: 1; justify-content: center; align-items: center;
}
.metric { display: flex; flex-direction: column; align-items: center; min-width: 44px; }
.m-label { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: var(--text3); }
.m-val { font-size: 12px; font-weight: 600; color: var(--text); font-family: 'JetBrains Mono', monospace; }
#sim-result-text {
  font-size: 11.5px; color: var(--text2); flex-shrink: 0;
  max-width: 220px; text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Scrollbar Global ── */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.09); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.15); }

/* ── Utility ── */
.text-cyan   { color: var(--cyan2); }
.text-green  { color: var(--green); }
.text-amber  { color: var(--amber); }
.text-red    { color: var(--red); }
.text-muted  { color: var(--text3); }
.mono        { font-family: 'JetBrains Mono', monospace; }

/* ── Responsive: narrow screens ── */
@media (max-width: 900px) {
  #split { grid-template-columns: 1fr; }
  #viewport-panel { display: none; }
}`);

/* ═══════════════════════════════════════════════════════════════════════════
   ENKI.JS  — Complete AI Engineering Co-Designer
   ═══════════════════════════════════════════════════════════════════════════ */
w('enki.js', `/* ═══════════════════════════════════════════════════════════════════════════
   ENKI.JS  v4.0  —  UARE AI Engineering Workstation
   Full-panel engineering chatbot with:
     • Multi-part parametric assembly generation
     • Morphing CAD animation (calls UARE_CAD.morphAddPart)
     • Streaming LLM responses (char-by-char)
     • Physics simulation integration (UARE_SIM)
     • Smart iteration suggestions
     • Assembly tree / BOM
     • Ambient background canvas
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
'use strict';

/* ── Utilities ───────────────────────────────────────────────────────────── */
const rand  = (lo, hi) => lo + Math.random() * (hi - lo);
const randI = (lo, hi) => Math.floor(rand(lo, hi));
const esc   = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const now   = () => new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ── Enki System Prompt ──────────────────────────────────────────────────── */
const SYSTEM_PROMPT = \`You are Enki, a world-class engineering AI co-designer inside UARE — an AI Engineering Workstation. You help users design real mechanical and electronic assemblies with parametric 3D CAD.

CORE BEHAVIOR:
- When the user asks to design/build/create anything, respond with a JSON block that defines the full multi-part assembly.
- Always think like a senior mechanical engineer: consider tolerances, material selection, manufacturing feasibility.
- Use proper engineering units (mm, kg, MPa, N, RPM etc.)
- Suggest realistic improvements proactively.

RESPONSE FORMAT for design requests:
Provide a short explanation paragraph, then output EXACTLY ONE JSON block:

\\\`\\\`\\\`json
{
  "assembly": true,
  "name": "Assembly Name",
  "description": "What this assembly does",
  "parts": [
    {
      "id": "part_001",
      "name": "Part Name",
      "type": "bracket|gear|shaft|piston|cylinder|housing|plate|beam|spring|bearing|bolt|pcb|custom",
      "material": "steel|aluminum|titanium|abs|carbon_fiber|copper|brass|nylon",
      "dims": { "w": 100, "h": 50, "d": 30 },
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "color": "#888888",
      "mass_kg": 0.5,
      "cost_usd": 12.0,
      "notes": "Forged 4340 steel, heat treated to 40 HRC"
    }
  ],
  "total_mass_kg": 2.5,
  "bom_notes": "All fasteners excluded; requires CNC milling"
}
\\\`\\\`\\\`

After the JSON, provide 3 concise engineering suggestions for improvement or next steps.

For non-design questions, answer with engineering expertise. Keep responses clear and professional.\`;

/* ── Greeting Options ────────────────────────────────────────────────────── */
const GREETINGS = [
  "Hello! I'm Enki, your AI engineering co-designer. Describe any mechanical system, product, or assembly and I'll generate a full parametric 3D CAD model — complete with materials, dimensions, and a simulation-ready assembly. What are we building today?",
  "Ready to engineer something exceptional. I'm Enki — I can design complete multi-part assemblies with realistic materials and dimensions, then run physics simulations to validate performance. What's your concept?",
  "Engineering AI online. Tell me what you want to design — anything from a simple bracket to a complete engine or robotic system — and I'll build it part by part in the 3D viewport. Let's create.",
  "Welcome to UARE. I'm Enki, and I specialize in turning ideas into fully parametric engineering designs. Describe your project — including any requirements for materials, dimensions, or performance targets — and let's start building."
];

/* ── Quick Intent Patterns (offline, no LLM needed) ─────────────────────── */
const QUICK_PATTERNS = [
  { re: /\\b(4.?cyl|four.?cyl|inline.?4|i4).*engine|engine.*4.?cyl/i, fn: _buildEngine4Cyl },
  { re: /\\b(gear|gearbox|transmission)/i, fn: _buildGearAssembly },
  { re: /\\b(drone|quadcopter|uav)/i, fn: _buildDrone },
  { re: /\\b(robot|robotic).*(arm|manipulator)/i, fn: _buildRoboticArm },
  { re: /\\b(pump|centrifugal.pump|hydraulic.pump)/i, fn: _buildPump },
  { re: /\\b(bracket|mount|clamp)/i, fn: _buildBracket },
  { re: /\\b(spring|compression.spring|torsion.spring)/i, fn: (t) => ({ type: 'spring', dims: { coils: 10, wireD: 3, outerD: 25, freeLen: 80 }, material: 'steel' }) },
  { re: /\\b(bearing|ball.bearing|roller.bearing)/i, fn: (t) => ({ type: 'bearing', dims: { innerD: 25, outerD: 52, width: 15 }, material: 'steel' }) },
  { re: /\\b(shaft|axle|spindle)/i, fn: (t) => ({ type: 'shaft', dims: { d: 30, L: 300 }, material: 'steel' }) },
  { re: /\\b(heat.?sink|heatsink|thermal)/i, fn: (t) => ({ type: 'heat_sink', dims: { w: 80, h: 40, d: 60, fins: 12 }, material: 'aluminum' }) },
  { re: /\\b(pcb|circuit.board|electronics)/i, fn: (t) => ({ type: 'pcb', dims: { w: 100, h: 80 }, material: 'fr4' }) },
  { re: /\\b(i.?beam|h.?beam|structural.steel)/i, fn: (t) => ({ type: 'ibeam', dims: { H: 200, W: 100, tw: 7, tf: 11, L: 1000 }, material: 'steel' }) },
];

/* ── State ───────────────────────────────────────────────────────────────── */
let _opts = {};
let _history = []; // [{role:'user'|'assistant', content:str}]
let _assembly = null; // current assembly object
let _partBuildQueue = [];
let _isBusy = false;

/* ── DOM Refs ────────────────────────────────────────────────────────────── */
let $msgs, $sugg, $input, $sendBtn, $enkiSub, $actionOverlay, $actionText,
    $actionFill, $enkiLive, $enkiLiveMsg, $asmName, $partCount,
    $vpEmpty, $asmTreeContent, $asmBOM, $mParts, $mMass, $simResult;

/* ── Init ────────────────────────────────────────────────────────────────── */
function _init(opts) {
  _opts = Object.assign({ endpoint: '/copilot', headers: {} }, opts);
  $msgs         = document.getElementById('chat-msgs');
  $sugg         = document.getElementById('suggestions-row');
  $input        = document.getElementById('chat-input');
  $sendBtn      = document.getElementById('send-btn');
  $enkiSub      = document.getElementById('enki-status-lbl');
  $actionOverlay= document.getElementById('action-overlay');
  $actionText   = document.getElementById('action-text');
  $actionFill   = document.getElementById('action-progress-fill');
  $enkiLive     = document.getElementById('enki-live');
  $enkiLiveMsg  = document.getElementById('enki-live-msg');
  $asmName      = document.getElementById('assembly-name-display');
  $partCount    = document.getElementById('assembly-part-count');
  $vpEmpty      = document.getElementById('viewport-empty');
  $asmTreeContent = document.getElementById('asm-tree-content');
  $asmBOM       = document.getElementById('asm-bom');
  $mParts       = document.getElementById('m-parts');
  $mMass        = document.getElementById('m-mass');
  $simResult    = document.getElementById('sim-result-text');

  _bindEvents();
  _showGreeting();
  _initAmbientBg();
  _initViewportControls();
  _initSimControls();
  console.log('[Enki v4.0] Ready');
}

/* ── Event Binding ───────────────────────────────────────────────────────── */
function _bindEvents() {
  if ($sendBtn) $sendBtn.addEventListener('click', _onSend);
  if ($input) {
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _onSend(); }
    });
    $input.addEventListener('input', () => {
      if ($sendBtn) $sendBtn.disabled = !$input.value.trim();
    });
    if ($sendBtn) $sendBtn.disabled = true;
  }
  const $clearBtn = document.getElementById('btn-clear');
  if ($clearBtn) $clearBtn.addEventListener('click', () => {
    if ($msgs) $msgs.innerHTML = '';
    _history = [];
    _clearSuggestions();
    _showGreeting();
  });
  const $newBtn = document.getElementById('btn-new');
  if ($newBtn) $newBtn.addEventListener('click', () => {
    _assembly = null;
    if ($msgs) $msgs.innerHTML = '';
    _history = [];
    _clearSuggestions();
    _resetAssemblyUI();
    if (global.UARE_CAD && global.UARE_CAD.clearScene) global.UARE_CAD.clearScene();
    if ($vpEmpty) $vpEmpty.classList.remove('hidden');
    _showGreeting();
  });
  // Export buttons
  _bindExportBtn('btn-export-step', 'step');
  _bindExportBtn('btn-export-obj', 'obj');
  _bindExportBtn('btn-export-stl', 'stl');
  // Tree toggle
  const $treeBtn = document.getElementById('btn-tree');
  const $treePanel = document.getElementById('asm-tree');
  const $treeClose = document.getElementById('btn-tree-close');
  if ($treeBtn && $treePanel) {
    $treeBtn.addEventListener('click', () => $treePanel.classList.toggle('collapsed'));
    if ($treeClose) $treeClose.addEventListener('click', () => $treePanel.classList.add('collapsed'));
  }
  // Props panel close
  const $propsClose = document.getElementById('btn-props-close');
  const $propsPanel = document.getElementById('part-props');
  if ($propsClose && $propsPanel) $propsClose.addEventListener('click', () => $propsPanel.classList.add('collapsed'));
}

function _bindExportBtn(id, fmt) {
  const $b = document.getElementById(id);
  if (!$b) return;
  $b.addEventListener('click', () => {
    if (!global.UARE_CAD) return;
    try {
      let data, fname, mime;
      if (fmt === 'step') {
        data = global.UARE_CAD.exportSTEP_AP214 ? global.UARE_CAD.exportSTEP_AP214(global.UARE_CAD.getLastScene && global.UARE_CAD.getLastScene()) : '-- STEP export requires Pass 3+ --';
        fname = 'assembly.step'; mime = 'text/plain';
      } else if (fmt === 'obj') {
        const r = global.UARE_CAD.exportOBJ ? global.UARE_CAD.exportOBJ(global.UARE_CAD.getLastScene && global.UARE_CAD.getLastScene()) : null;
        if (r) { _download(r.obj, 'assembly.obj', 'text/plain'); _download(r.mtl, 'assembly.mtl', 'text/plain'); return; }
        return;
      } else {
        _addMsg('assistant', 'STL export not yet implemented in this build. Use STEP or OBJ instead.');
        return;
      }
      _download(data, fname, mime);
    } catch(e) { _addMsg('assistant', 'Export failed: ' + esc(e.message)); }
  });
}

/* ── Send ────────────────────────────────────────────────────────────────── */
async function _onSend() {
  if (_isBusy || !$input) return;
  const text = $input.value.trim();
  if (!text) return;
  $input.value = '';
  if ($sendBtn) $sendBtn.disabled = true;
  _clearSuggestions();
  _addMsg('user', esc(text));
  _history.push({ role: 'user', content: text });
  _setBusy(true);
  try {
    await _processMessage(text);
  } catch(e) {
    console.error('[Enki] _processMessage error:', e);
    _addMsg('assistant', 'Something went wrong: ' + esc(e.message) + '. Please try again.');
  } finally {
    _setBusy(false);
  }
}

/* ── Message Processing ──────────────────────────────────────────────────── */
async function _processMessage(text) {
  // 1. Quick local intent check
  for (const p of QUICK_PATTERNS) {
    if (p.re.test(text)) {
      const intent = p.fn(text);
      if (intent && intent.assembly && intent.parts) {
        return await _buildAssemblyFromPlan(intent);
      }
    }
  }
  // 2. Show typing
  const typingId = _addTyping();
  // 3. Send to LLM
  try {
    const response = await _callLLM(text);
    _removeMsg(typingId);
    if (!response) { _addMsg('assistant', 'No response from AI. Is the server running?'); return; }
    // 4. Check for assembly JSON
    const plan = _parseAssemblyPlan(response);
    if (plan && plan.assembly && plan.parts && plan.parts.length > 0) {
      _addMsg('assistant', _mdToHtml(_stripJsonBlock(response)));
      await _buildAssemblyFromPlan(plan);
    } else {
      await _streamMsg(response);
      _history.push({ role: 'assistant', content: response });
    }
  } catch (e) {
    _removeMsg(typingId);
    throw e;
  }
}

/* ── LLM Call ────────────────────────────────────────────────────────────── */
async function _callLLM(userText) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ..._history.slice(-12)
  ];
  const res = await fetch(_opts.endpoint, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, _opts.headers),
    body: JSON.stringify({ messages, stream: false })
  });
  if (!res.ok) throw new Error('LLM API error ' + res.status);
  const data = await res.json();
  return data.message || data.content || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

/* ── Parse Assembly Plan ─────────────────────────────────────────────────── */
function _parseAssemblyPlan(text) {
  const match = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1].trim());
    if (obj.assembly && Array.isArray(obj.parts)) return obj;
    return null;
  } catch (_) { return null; }
}
function _stripJsonBlock(text) {
  return text.replace(/\`\`\`(?:json)?[\\s\\S]*?\`\`\`/g, '').trim();
}

/* ── Build Assembly from Plan ────────────────────────────────────────────── */
async function _buildAssemblyFromPlan(plan) {
  _assembly = plan;
  _setEnkiLive(true, 'Building assembly…');
  _setEnkiStatus('Building ' + plan.name + '…');
  // Update topbar
  if ($asmName) $asmName.textContent = plan.name || 'Assembly';
  if ($partCount) { $partCount.textContent = plan.parts.length + ' parts'; $partCount.classList.remove('hidden'); }
  if ($vpEmpty) $vpEmpty.classList.add('hidden');
  // Build message with part badges
  const msgBubble = _addMsg('assistant',
    '<strong>' + esc(plan.name || 'Assembly') + '</strong> — ' + esc(plan.description || '') +
    '<div class="part-badges" id="build-badges"></div>'
  );
  const $badges = msgBubble ? msgBubble.querySelector('#build-badges') : null;
  // Add pending badges
  const badgeEls = [];
  if ($badges) {
    for (const part of plan.parts) {
      const b = document.createElement('span');
      b.className = 'part-badge pending';
      b.textContent = part.name;
      b.id = 'badge-' + part.id;
      $badges.appendChild(b);
      badgeEls.push(b);
    }
  }
  // Build CAD for each part sequentially with morphing
  const canvas = document.getElementById('cad-canvas');
  const CAD = global.UARE_CAD;
  let builtParts = 0;
  const totalParts = plan.parts.length;
  for (let i = 0; i < plan.parts.length; i++) {
    const part = plan.parts[i];
    const badge = badgeEls[i];
    if (badge) badge.className = 'part-badge building';
    _setActionOverlay(true, 'Building: ' + part.name + ' (' + (i+1) + '/' + totalParts + ')', (i/totalParts)*100);
    _setEnkiLive(true, part.name + '…');
    // Build the part geometry
    try {
      if (CAD && CAD.morphAddPart) {
        await CAD.morphAddPart(canvas, part);
      } else if (CAD && CAD.buildScene) {
        // Fallback: build just this part using buildScene (only last part stays visible)
        const s = CAD.buildScene(canvas, part.dims || {}, part.type || 'bracket');
        if (s && s.animate) s.animate();
      }
    } catch (err) {
      console.warn('[Enki] Part build failed:', part.name, err.message);
    }
    if (badge) badge.className = 'part-badge done';
    builtParts++;
    _updateAssemblyTree(plan.parts.slice(0, builtParts));
    _updateMetrics(plan);
    await sleep(200);
  }
  _setActionOverlay(false);
  _setEnkiLive(false);
  _setEnkiStatus('Engineering AI · Ready');
  // Summary message
  const mass = plan.total_mass_kg != null ? plan.total_mass_kg + ' kg' : '—';
  _addMsg('assistant',
    'Assembly complete! <strong>' + plan.parts.length + ' parts</strong> built.' +
    (plan.bom_notes ? '<br><em>' + esc(plan.bom_notes) + '</em>' : '') +
    '<br><span class="text-muted">Total mass: ' + mass + '</span>'
  );
  _history.push({ role: 'assistant', content: '[Assembly: ' + plan.name + ', ' + plan.parts.length + ' parts]' });
  // Show suggestions
  _showSuggestions(_buildSuggestions(plan));
  // Update tree with full BOM
  _renderBOM(plan);
}

/* ── Suggestions ─────────────────────────────────────────────────────────── */
function _buildSuggestions(plan) {
  const suggs = [
    'Run physics simulation',
    'Run FEA stress analysis',
    'Explode assembly view',
    'Export as STEP file',
    'Add tolerances & fits',
    'Suggest material upgrade',
  ];
  if (plan && plan.parts) {
    const types = plan.parts.map(p => p.type);
    if (types.includes('shaft') || types.includes('gear')) suggs.unshift('Add lubrication system');
    if (types.includes('piston') || types.includes('cylinder')) suggs.unshift('Add cooling jacket');
  }
  return suggs.slice(0, 4);
}
function _showSuggestions(list) {
  if (!$sugg) return;
  $sugg.innerHTML = '';
  list.forEach(s => {
    const b = document.createElement('button');
    b.className = 'sug-chip'; b.textContent = s;
    b.addEventListener('click', () => {
      if (!$input) return;
      $input.value = s;
      _onSend();
    });
    $sugg.appendChild(b);
  });
}
function _clearSuggestions() { if ($sugg) $sugg.innerHTML = ''; }

/* ── Assembly Tree & BOM ─────────────────────────────────────────────────── */
function _updateAssemblyTree(parts) {
  if (!$asmTreeContent) return;
  $asmTreeContent.innerHTML = parts.map((p, i) => {
    const icon = _partIcon(p.type);
    return '<div class="tree-item" data-part-id="' + esc(p.id) + '">' +
      '<span class="tree-icon">' + icon + '</span>' +
      '<span class="tree-label">' + esc(p.name) + '</span>' +
      '<span class="tree-sub">' + esc(p.material || '') + '</span>' +
      '</div>';
  }).join('');
  // Click to select part / show properties
  $asmTreeContent.querySelectorAll('.tree-item').forEach(el => {
    el.addEventListener('click', () => {
      $asmTreeContent.querySelectorAll('.tree-item').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      const id = el.dataset.partId;
      const part = ((_assembly && _assembly.parts) || []).find(p => p.id === id);
      if (part) _showPartProps(part);
    });
  });
}
function _renderBOM(plan) {
  if (!$asmBOM || !plan || !plan.parts) return;
  const rows = plan.parts.map(p =>
    '<div class="bom-row"><span>' + esc(p.name) + '</span><span class="qty">1x</span></div>'
  ).join('');
  $asmBOM.innerHTML = '<div class="bom-header">Bill of Materials</div>' + rows;
}
function _showPartProps(part) {
  const $panel = document.getElementById('part-props');
  const $title = document.getElementById('part-props-title');
  const $content = document.getElementById('part-props-content');
  if (!$panel || !$content) return;
  if ($title) $title.textContent = part.name;
  const rows = [
    ['Type', part.type || '—'],
    ['Material', part.material || '—'],
    ['Mass', part.mass_kg != null ? part.mass_kg + ' kg' : '—'],
    ['Cost', part.cost_usd != null ? '$' + part.cost_usd.toFixed(2) : '—'],
    ...Object.entries(part.dims || {}).map(([k, v]) => [k.toUpperCase(), v + ' mm']),
    ['Notes', part.notes || '—'],
  ];
  $content.innerHTML = rows.map(([l, v]) =>
    '<div class="prop-row"><span class="prop-label">' + esc(l) + '</span><span class="prop-val">' + esc(v) + '</span></div>'
  ).join('');
  $panel.classList.remove('collapsed');
}
function _partIcon(type) {
  const icons = { gear:'⚙', shaft:'━', spring:'〰', bearing:'◎', bracket:'┐', piston:'▭', cylinder:'⌀', pcb:'▦', beam:'━', plate:'▬', housing:'▭', drone:'✦', pump:'⊚' };
  return icons[type] || '◈';
}

/* ── Metrics Update ──────────────────────────────────────────────────────── */
function _updateMetrics(plan) {
  if (!plan) return;
  if ($mParts) $mParts.textContent = (plan.parts || []).length;
  const mass = plan.total_mass_kg != null ? plan.total_mass_kg.toFixed(1) + ' kg' : '—';
  if ($mMass) $mMass.textContent = mass;
}
function _resetAssemblyUI() {
  if ($asmName) $asmName.textContent = 'No assembly loaded';
  if ($partCount) { $partCount.textContent = ''; $partCount.classList.add('hidden'); }
  if ($mParts) $mParts.textContent = '0';
  if ($mMass) $mMass.textContent = '0 kg';
  if ($asmTreeContent) $asmTreeContent.innerHTML = '';
  if ($asmBOM) $asmBOM.innerHTML = '';
}

/* ── DOM Helpers ─────────────────────────────────────────────────────────── */
function _addMsg(role, html) {
  if (!$msgs) return null;
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-' + role;
  wrap.innerHTML = '<div class="msg-bubble">' + html + '</div>' +
    '<div class="msg-time">' + now() + '</div>';
  $msgs.appendChild(wrap);
  $msgs.scrollTop = $msgs.scrollHeight;
  return wrap.querySelector('.msg-bubble');
}
let _typingCtr = 0;
function _addTyping() {
  if (!$msgs) return null;
  const id = 'typing-' + (++_typingCtr);
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant'; wrap.id = id;
  wrap.innerHTML = '<div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  $msgs.appendChild(wrap);
  $msgs.scrollTop = $msgs.scrollHeight;
  return id;
}
function _removeMsg(id) {
  if (!id || !$msgs) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}
async function _streamMsg(text) {
  if (!$msgs) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  const timeEl = document.createElement('div');
  timeEl.className = 'msg-time'; timeEl.textContent = now();
  wrap.appendChild(bubble); wrap.appendChild(timeEl);
  $msgs.appendChild(wrap);
  const html = _mdToHtml(text);
  // Stream char by char at a pace that feels fast but visible
  let shown = '';
  const step = Math.max(1, Math.floor(text.length / 80));
  for (let i = 0; i < html.length; i += step) {
    shown = html.slice(0, i + step);
    bubble.innerHTML = shown;
    $msgs.scrollTop = $msgs.scrollHeight;
    await sleep(8);
  }
  bubble.innerHTML = html;
  $msgs.scrollTop = $msgs.scrollHeight;
}
function _showGreeting() {
  const g = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  _addMsg('assistant', _mdToHtml(g));
  _showSuggestions([
    'Design a 4-cylinder engine',
    'Build a robotic arm',
    'Create a gearbox assembly',
    'Design a centrifugal pump',
  ]);
}

/* ── Status Helpers ──────────────────────────────────────────────────────── */
function _setBusy(b) {
  _isBusy = b;
  if ($sendBtn) $sendBtn.disabled = b;
}
function _setEnkiStatus(s) { if ($enkiSub) $enkiSub.textContent = s; }
function _setEnkiLive(on, msg) {
  if (!$enkiLive) return;
  if (on) { $enkiLive.classList.remove('hidden'); if ($enkiLiveMsg) $enkiLiveMsg.textContent = msg || 'Working…'; }
  else $enkiLive.classList.add('hidden');
}
function _setActionOverlay(on, msg, pct) {
  if (!$actionOverlay) return;
  if (on) {
    $actionOverlay.classList.remove('hidden');
    if ($actionText) $actionText.textContent = msg || 'Working…';
    if ($actionFill) $actionFill.style.width = (pct || 0) + '%';
  } else {
    if ($actionFill) $actionFill.style.width = '100%';
    setTimeout(() => { $actionOverlay.classList.add('hidden'); if ($actionFill) $actionFill.style.width = '0%'; }, 400);
  }
}

/* ── Viewport Controls ───────────────────────────────────────────────────── */
function _initViewportControls() {
  document.querySelectorAll('[data-vp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.vp;
      if (global.UARE_CAD && global.UARE_CAD.setView) global.UARE_CAD.setView(view);
    });
  });
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (global.UARE_CAD && global.UARE_CAD.setRenderMode) global.UARE_CAD.setRenderMode(btn.dataset.mode);
    });
  });
  const $explode = document.getElementById('btn-explode');
  if ($explode) $explode.addEventListener('click', () => {
    if (global.UARE_CAD && global.UARE_CAD.getLastScene) {
      const sc = global.UARE_CAD.getLastScene();
      if (sc) { sc.explode && sc.explode(2.5); }
    }
  });
}

/* ── Simulation Controls ─────────────────────────────────────────────────── */
function _initSimControls() {
  const $run    = document.getElementById('btn-sim-run');
  const $pause  = document.getElementById('btn-sim-pause');
  const $reset  = document.getElementById('btn-sim-reset');
  const $fea    = document.getElementById('btn-fea');
  const $stress = document.getElementById('btn-stress');
  const $status = document.getElementById('sim-status');
  const $mTime  = document.getElementById('m-simtime');
  const $mFPS   = document.getElementById('m-fps');
  const $mStr   = document.getElementById('m-stress');
  const $mSafe  = document.getElementById('m-safety');

  function setSimStatus(s) {
    if (!$status) return;
    $status.className = 'sim-badge ' + s;
    const labels = { idle: '● Idle', running: '▶ Running', complete: '✓ Complete', fail: '✗ Failed' };
    $status.textContent = labels[s] || s;
  }

  if ($run) $run.addEventListener('click', async () => {
    if (!global.UARE_SIM) { _addMsg('assistant', 'Physics engine not loaded yet.'); return; }
    const CAD = global.UARE_CAD;
    const scene = CAD && CAD.getLastScene && CAD.getLastScene();
    if (!scene) { _addMsg('assistant', 'No assembly loaded. Design something first!'); return; }
    setSimStatus('running');
    if ($run) $run.disabled = true;
    if ($pause) $pause.disabled = false;
    if ($reset) $reset.disabled = false;
    _setEnkiLive(true, 'Physics simulation running…');
    const canvas = document.getElementById('cad-canvas');
    global.UARE_SIM.init(scene, canvas, _assembly);
    global.UARE_SIM.run({
      onStep: (dt, t, fps) => {
        if ($mTime) $mTime.textContent = t.toFixed(1) + ' s';
        if ($mFPS) $mFPS.textContent = fps.toFixed(0);
      },
      onComplete: (results) => {
        setSimStatus('complete');
        _setEnkiLive(false);
        if ($run) $run.disabled = false;
        if ($pause) $pause.disabled = true;
        if ($mStr) $mStr.textContent = results.maxStress ? results.maxStress.toFixed(1) + ' MPa' : '—';
        if ($mSafe) $mSafe.textContent = results.safetyFactor ? results.safetyFactor.toFixed(2) + 'x' : '—';
        if ($simResult) $simResult.textContent = results.summary || '';
        _addMsg('assistant', '<strong>Simulation complete!</strong> ' +
          (results.summary || '') +
          (results.suggestions ? '<br>' + results.suggestions.map(s => '• ' + esc(s)).join('<br>') : ''));
      }
    });
  });
  if ($pause) $pause.addEventListener('click', () => {
    if (global.UARE_SIM) global.UARE_SIM.pause();
    setSimStatus('idle');
    _setEnkiLive(false);
    if ($run) $run.disabled = false;
    if ($pause) $pause.disabled = true;
  });
  if ($reset) $reset.addEventListener('click', () => {
    if (global.UARE_SIM) global.UARE_SIM.reset();
    setSimStatus('idle');
    if ($mTime) $mTime.textContent = '0.0 s';
    if ($mFPS) $mFPS.textContent = '–';
    if ($run) $run.disabled = false;
    if ($pause) $pause.disabled = true;
    _setEnkiLive(false);
  });
  if ($fea) $fea.addEventListener('click', async () => {
    if (!_assembly) { _addMsg('assistant', 'Load an assembly first.'); return; }
    if (!global.UARE_CAD || !global.UARE_CAD.computeStressProxy) { _addMsg('assistant', 'FEA engine not available.'); return; }
    _setEnkiLive(true, 'Running FEA…');
    const sc = global.UARE_CAD.getLastScene && global.UARE_CAD.getLastScene();
    if (sc) {
      const r = global.UARE_CAD.computeStressProxy(sc);
      _setEnkiLive(false);
      if (r && r.maxStress) {
        if ($mStr) $mStr.textContent = r.maxStress.toFixed(1) + ' MPa';
        _addMsg('assistant', '<strong>FEA Analysis Complete</strong><br>' +
          'Max stress: <code>' + r.maxStress.toFixed(1) + ' MPa</code><br>' +
          'Hotspots: ' + (r.hotspots ? r.hotspots.length : 0) + ' identified<br>' +
          '<em>Stress heatmap applied to model.</em>');
      }
    } else {
      _setEnkiLive(false);
      _addMsg('assistant', 'No geometry to analyse. Build an assembly first.');
    }
  });
  if ($stress) $stress.addEventListener('click', () => {
    if (global.UARE_CAD && global.UARE_CAD.setRenderMode) global.UARE_CAD.setRenderMode('stress');
    _addMsg('assistant', 'Stress heatmap mode active. Red = high stress, blue = low stress.');
  });
}

/* ── Quick Build Functions ───────────────────────────────────────────────── */
function _buildEngine4Cyl(text) {
  return {
    assembly: true, name: '4-Cylinder Engine',
    description: 'Inline 4-cylinder internal combustion engine with complete rotating assembly',
    total_mass_kg: 142,
    parts: [
      { id:'blk001', name:'Cylinder Block',   type:'housing', material:'aluminum', dims:{w:450,h:280,d:220}, position:[0,0,0],      color:'#8a9ab5', mass_kg:38, notes:'Cast aluminum alloy A380, bore 86mm' },
      { id:'hd001',  name:'Cylinder Head',    type:'plate',   material:'aluminum', dims:{w:450,h:60,d:220},  position:[0,280,0],    color:'#9dafc8', mass_kg:15, notes:'DOHC, 4 valves per cylinder' },
      { id:'cs001',  name:'Crankshaft',       type:'shaft',   material:'steel',    dims:{d:58,L:400},        position:[225,80,110], color:'#6a7a8a', mass_kg:18, notes:'Forged 4340 steel, 86mm stroke' },
      { id:'ps001',  name:'Piston #1',        type:'piston',  material:'aluminum', dims:{d:86,h:72},         position:[54,140,110], color:'#b8c8d8', mass_kg:0.38, notes:'Forged alloy, compression ratio 10.5:1' },
      { id:'ps002',  name:'Piston #2',        type:'piston',  material:'aluminum', dims:{d:86,h:72},         position:[162,140,110],color:'#b8c8d8', mass_kg:0.38 },
      { id:'ps003',  name:'Piston #3',        type:'piston',  material:'aluminum', dims:{d:86,h:72},         position:[270,140,110],color:'#b8c8d8', mass_kg:0.38 },
      { id:'ps004',  name:'Piston #4',        type:'piston',  material:'aluminum', dims:{d:86,h:72},         position:[378,140,110],color:'#b8c8d8', mass_kg:0.38 },
      { id:'cm001',  name:'Intake Camshaft',  type:'shaft',   material:'steel',    dims:{d:28,L:410},        position:[225,300,80], color:'#5a6a7a', mass_kg:4.2, notes:'Hydraulic valve lash adjusters' },
      { id:'cm002',  name:'Exhaust Camshaft', type:'shaft',   material:'steel',    dims:{d:28,L:410},        position:[225,300,155],color:'#5a6a7a', mass_kg:4.2 },
      { id:'op001',  name:'Oil Pan',          type:'housing', material:'aluminum', dims:{w:460,h:80,d:230},  position:[-5,-80,0],   color:'#4a5a6a', mass_kg:3.5 },
      { id:'fl001',  name:'Flywheel',         type:'gear',    material:'steel',    dims:{d:280,h:30},        position:[0,80,110],   color:'#7a8a9a', mass_kg:8.5, notes:'Dual-mass flywheel' },
      { id:'tb001',  name:'Timing Chain',     type:'custom',  material:'steel',    dims:{w:20,h:380,d:10},   position:[225,200,200],color:'#5a5a5a', mass_kg:0.6 },
    ],
    bom_notes: 'Excludes fuel system, ignition, exhaust manifold. All dims in mm.'
  };
}
function _buildGearAssembly(text) {
  return {
    assembly: true, name: '2-Stage Gearbox',
    description: 'Parallel-shaft 2-stage spur gearbox, 16:1 total ratio',
    total_mass_kg: 28,
    parts: [
      { id:'gh001', name:'Gearbox Housing',  type:'housing', material:'cast_iron', dims:{w:280,h:200,d:120}, position:[0,0,0], color:'#6a7a7a', mass_kg:9 },
      { id:'s1001', name:'Input Shaft',      type:'shaft',   material:'steel',     dims:{d:25,L:180}, position:[40,100,60], color:'#8a9a9a', mass_kg:1.2 },
      { id:'g1001', name:'Drive Gear Stage1',type:'gear',    material:'steel',     dims:{module:2,teeth:18,faceW:30}, position:[40,100,60], color:'#aabbcc', mass_kg:0.8, notes:'18T, m=2, carburized' },
      { id:'g2001', name:'Driven Gear S1',   type:'gear',    material:'steel',     dims:{module:2,teeth:72,faceW:30}, position:[140,100,60],color:'#8899aa', mass_kg:3.2, notes:'72T, m=2, 4:1 ratio stage 1' },
      { id:'s2001', name:'Intermediate Shaft',type:'shaft',  material:'steel',     dims:{d:35,L:180}, position:[140,100,60],color:'#8a9a9a', mass_kg:2.1 },
      { id:'g3001', name:'Drive Gear Stage2', type:'gear',   material:'steel',     dims:{module:3,teeth:20,faceW:35}, position:[140,100,60],color:'#aabbcc', mass_kg:1.4 },
      { id:'g4001', name:'Driven Gear S2',    type:'gear',   material:'steel',     dims:{module:3,teeth:80,faceW:35}, position:[240,100,60],color:'#8899aa', mass_kg:5.8, notes:'80T, 4:1 stage 2' },
      { id:'s3001', name:'Output Shaft',      type:'shaft',  material:'steel',     dims:{d:45,L:200}, position:[240,100,60],color:'#8a9a9a', mass_kg:3.1 },
      { id:'b1001', name:'Bearing Set (x6)',  type:'bearing',material:'steel',     dims:{innerD:25,outerD:52,width:15}, position:[0,100,60], color:'#ccddee', mass_kg:0.9 },
    ],
    bom_notes: 'Total ratio 16:1. Oil bath lubrication. Housing requires precision line-boring.'
  };
}
function _buildDrone(text) {
  return {
    assembly: true, name: 'Quadcopter Drone Frame',
    description: 'Racing quadcopter with carbon fiber frame and brushless motors',
    total_mass_kg: 0.85,
    parts: [
      { id:'fr001', name:'Main Frame',       type:'plate',  material:'carbon_fiber', dims:{w:250,h:8,d:250},  position:[0,0,0],    color:'#1a1a1a', mass_kg:0.12 },
      { id:'ar001', name:'Arm Front-Left',   type:'beam',   material:'carbon_fiber', dims:{w:150,h:8,d:20},   position:[-125,0,125],color:'#222222', mass_kg:0.04 },
      { id:'ar002', name:'Arm Front-Right',  type:'beam',   material:'carbon_fiber', dims:{w:150,h:8,d:20},   position:[125,0,125], color:'#222222', mass_kg:0.04 },
      { id:'ar003', name:'Arm Rear-Left',    type:'beam',   material:'carbon_fiber', dims:{w:150,h:8,d:20},   position:[-125,0,-125],color:'#222222', mass_kg:0.04 },
      { id:'ar004', name:'Arm Rear-Right',   type:'beam',   material:'carbon_fiber', dims:{w:150,h:8,d:20},   position:[125,0,-125],color:'#222222', mass_kg:0.04 },
      { id:'mo001', name:'Motor FL (2306)',   type:'custom', material:'aluminum',     dims:{d:28,h:32},         position:[-125,10,125],color:'#c8a020', mass_kg:0.06 },
      { id:'mo002', name:'Motor FR (2306)',   type:'custom', material:'aluminum',     dims:{d:28,h:32},         position:[125,10,125], color:'#c8a020', mass_kg:0.06 },
      { id:'mo003', name:'Motor RL (2306)',   type:'custom', material:'aluminum',     dims:{d:28,h:32},         position:[-125,10,-125],color:'#c8a020', mass_kg:0.06 },
      { id:'mo004', name:'Motor RR (2306)',   type:'custom', material:'aluminum',     dims:{d:28,h:32},         position:[125,10,-125],color:'#c8a020', mass_kg:0.06 },
      { id:'pr001', name:'Propeller FL 5045', type:'custom', material:'nylon',        dims:{d:127,h:5},         position:[-125,20,125],color:'#3366cc', mass_kg:0.01 },
      { id:'pr002', name:'Propeller FR 5045', type:'custom', material:'nylon',        dims:{d:127,h:5},         position:[125,20,125], color:'#cc3333', mass_kg:0.01 },
      { id:'pr003', name:'Propeller RL 5045', type:'custom', material:'nylon',        dims:{d:127,h:5},         position:[-125,20,-125],color:'#3366cc', mass_kg:0.01 },
      { id:'pr004', name:'Propeller RR 5045', type:'custom', material:'nylon',        dims:{d:127,h:5},         position:[125,20,-125],color:'#cc3333', mass_kg:0.01 },
      { id:'fc001', name:'Flight Controller', type:'pcb',   material:'fr4',          dims:{w:36,h:6,d:36},     position:[0,15,0],    color:'#00aa44', mass_kg:0.02 },
      { id:'bt001', name:'LiPo Battery 4S',   type:'housing',material:'abs',         dims:{w:80,h:35,d:55},    position:[0,-20,0],   color:'#3344aa', mass_kg:0.25 },
    ],
    bom_notes: 'AUW ~850g. 4S LiPo, 30A ESCs (x4) not modeled. FPV camera optional.'
  };
}
function _buildRoboticArm(text) {
  return {
    assembly: true, name: '6-DOF Robotic Arm',
    description: 'Industrial 6-axis robotic arm, 5kg payload, 800mm reach',
    total_mass_kg: 22,
    parts: [
      { id:'ba001', name:'Base Plate',    type:'plate',   material:'steel',    dims:{w:300,h:30,d:300},  position:[0,0,0],      color:'#5a6a7a', mass_kg:5.5 },
      { id:'j1001', name:'Joint 1 (Waist)',type:'gear',   material:'steel',    dims:{d:200,h:40},        position:[150,30,150], color:'#7a8a9a', mass_kg:3.2, notes:'Servo: 100Nm, 360deg rotation' },
      { id:'l1001', name:'Link 1 (Shoulder)',type:'beam', material:'aluminum', dims:{w:40,h:300,d:40},   position:[150,70,150], color:'#9aaabb', mass_kg:1.8 },
      { id:'j2001', name:'Joint 2 (Shoulder)',type:'gear',material:'steel',    dims:{d:120,h:35},        position:[150,370,150],color:'#7a8a9a', mass_kg:1.9, notes:'Servo: 60Nm' },
      { id:'l2001', name:'Link 2 (Elbow)',  type:'beam', material:'aluminum', dims:{w:35,h:280,d:35},   position:[150,405,150],color:'#9aaabb', mass_kg:1.4 },
      { id:'j3001', name:'Joint 3 (Elbow)', type:'gear', material:'steel',    dims:{d:100,h:30},        position:[150,685,150],color:'#7a8a9a', mass_kg:1.2, notes:'Servo: 40Nm' },
      { id:'l3001', name:'Link 3 (Forearm)',type:'beam', material:'aluminum', dims:{w:30,h:240,d:30},   position:[150,715,150],color:'#9aaabb', mass_kg:1.1 },
      { id:'j4001', name:'Joint 4 (Wrist)', type:'bearing',material:'steel',  dims:{innerD:40,outerD:80,width:25},position:[150,955,150],color:'#8899aa', mass_kg:0.6 },
      { id:'j5001', name:'Joint 5 (Pitch)', type:'gear', material:'steel',    dims:{d:80,h:25},         position:[150,980,150],color:'#7a8a9a', mass_kg:0.5 },
      { id:'j6001', name:'Joint 6 (Roll)',  type:'gear', material:'steel',    dims:{d:70,h:20},         position:[150,1005,150],color:'#7a8a9a', mass_kg:0.4, notes:'Tool flange ISO 9283' },
      { id:'ef001', name:'End Effector',    type:'custom',material:'aluminum', dims:{w:60,h:80,d:60},   position:[150,1025,150],color:'#ccddee', mass_kg:0.5, notes:'2-finger parallel gripper, 50N grip' },
    ],
    bom_notes: 'Repeatability ±0.05mm. Excludes servo drives, cables, controller.'
  };
}
function _buildPump(text) {
  return {
    assembly: true, name: 'Centrifugal Pump Assembly',
    description: 'End-suction centrifugal pump, 50 L/min @ 3bar, 1450 RPM',
    total_mass_kg: 14.5,
    parts: [
      { id:'vol001', name:'Volute Casing',   type:'housing', material:'cast_iron', dims:{w:240,h:180,d:120}, position:[0,0,0],    color:'#7a8070', mass_kg:5.5, notes:'EN-GJS-400, spiral casing' },
      { id:'imp001', name:'Impeller',        type:'gear',    material:'brass',     dims:{d:180,h:30},        position:[120,90,50], color:'#d4a020', mass_kg:1.8, notes:'6-vane semi-open, 180mm OD' },
      { id:'sh001',  name:'Pump Shaft',      type:'shaft',   material:'steel',     dims:{d:28,L:280},        position:[120,90,60], color:'#8a9a9a', mass_kg:1.1, notes:'17-4PH stainless' },
      { id:'mc001',  name:'Mechanical Seal', type:'custom',  material:'carbon',    dims:{d:35,h:25},         position:[120,90,160],color:'#3a3a3a', mass_kg:0.15 },
      { id:'br001',  name:'Bearing (DE)',    type:'bearing', material:'steel',     dims:{innerD:28,outerD:62,width:17},position:[120,90,220],color:'#ccddee', mass_kg:0.28 },
      { id:'br002',  name:'Bearing (NDE)',   type:'bearing', material:'steel',     dims:{innerD:28,outerD:62,width:17},position:[120,90,20], color:'#ccddee', mass_kg:0.28 },
      { id:'bk001',  name:'Bearing Housing', type:'housing', material:'cast_iron', dims:{w:120,h:100,d:140}, position:[80,40,180], color:'#6a7070', mass_kg:2.4 },
      { id:'mt001',  name:'Motor (1.5kW)',   type:'housing', material:'steel',     dims:{w:200,h:180,d:200}, position:[-200,0,0],  color:'#4a5060', mass_kg:12, notes:'IE3 1.5kW 4-pole, B3 mounting' },
      { id:'cp001',  name:'Coupling',        type:'custom',  material:'nylon',     dims:{d:80,h:50},         position:[-40,90,100],color:'#2288cc', mass_kg:0.3, notes:'Lovejoy L-090, elastomeric' },
      { id:'bp001',  name:'Baseplate',       type:'plate',   material:'steel',     dims:{w:600,h:30,d:260},  position:[-200,-30,0],color:'#5a5a5a', mass_kg:8.5 },
    ]
  };
}
function _buildBracket(text) {
  const m = text.match(/([0-9]+)\s*mm/);
  const sz = m ? parseInt(m[1]) : 100;
  return {
    assembly: true, name: 'Structural Bracket',
    description: 'Machined structural mounting bracket with gussets',
    total_mass_kg: 0.8,
    parts: [
      { id:'br001', name:'Base Flange',  type:'plate',   material:'aluminum', dims:{w:sz,h:10,d:sz*0.8}, position:[0,0,0],    color:'#9aaabb', mass_kg:0.35, notes:'6061-T6 aluminum' },
      { id:'br002', name:'Vertical Web', type:'plate',   material:'aluminum', dims:{w:sz,h:sz,d:8},      position:[0,10,0],   color:'#9aaabb', mass_kg:0.28 },
      { id:'br003', name:'Gusset Left',  type:'bracket', material:'aluminum', dims:{w:8,h:sz*0.6,d:sz*0.5}, position:[0,10,0], color:'#8899aa', mass_kg:0.08 },
      { id:'br004', name:'Gusset Right', type:'bracket', material:'aluminum', dims:{w:8,h:sz*0.6,d:sz*0.5}, position:[sz-8,10,0],color:'#8899aa', mass_kg:0.08 },
    ]
  };
}

/* ── Download Helper ─────────────────────────────────────────────────────── */
function _download(content, fname, mime) {
  if (!content) return;
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname; a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Markdown → HTML ─────────────────────────────────────────────────────── */
function _mdToHtml(md) {
  if (!md) return '';
  return md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/\`(.+?)\`/g, '<code>$1</code>')
    .replace(/^#{1,3}\\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^[-\\*]\\s+(.+)$/gm, '• $1')
    .replace(/\\n{2,}/g, '<br><br>')
    .replace(/\\n/g, '<br>');
}

/* ── Ambient Background ──────────────────────────────────────────────────── */
const QUOTES = [
  '"Imagination is more important than knowledge." — Einstein',
  '"The best way to predict the future is to invent it." — Alan Kay',
  '"Genius is 1% inspiration, 99% perspiration." — Edison',
  '"Everything should be as simple as possible, but not simpler." — Einstein',
  '"Invention is the mother of necessity." — Veblen',
  '"In the middle of every difficulty lies opportunity." — Einstein',
  '"To invent, you need a good imagination and a pile of junk." — Edison',
  '"Research is formalized curiosity." — Zora Neale Hurston',
  '"The scientist is not a person who gives right answers; he is one who asks right questions." — Lévi-Strauss',
  '"What we know is a drop, what we don\\'t know is an ocean." — Newton',
  '"Science is the belief in the ignorance of experts." — Feynman',
  '"The first step to improvement is knowing where you stand." — Anonymous',
  '"Engineering is the art of the practical." — Anonymous',
  '"Any sufficiently advanced technology is indistinguishable from magic." — Clarke',
];
const EQUATIONS = [
  'E = mc²', 'F = ma', 'PV = nRT', 'σ = F/A', 'τ = Tr/J',
  'δ = PL³/3EI', 'Re = ρvL/μ', '∇·E = ρ/ε₀', 'iℏ∂ψ/∂t = Ĥψ',
  'S = k ln W', 'W = ∫F·ds', 'p = mv', 'τ = Iα', 'η = 1 − Tc/Th',
  'Gμν + Λgμν = (8πG/c⁴)Tμν', 'λ = h/mv', 'v = fλ', 'Q = mcΔT',
  'P = I²R', 'ε = σ/E', 'SF = σ_yield / σ_actual',
];
const BP_FUNS = [
  (ctx) => { // Gear
    ctx.beginPath(); const N=8,r=22,ro=30;
    for(let i=0;i<N;i++){const a0=i/N*Math.PI*2,a1=(i+.4)/N*Math.PI*2,a2=(i+.6)/N*Math.PI*2;
      ctx.lineTo(40+ro*Math.cos(a0),40+ro*Math.sin(a0));ctx.lineTo(40+ro*Math.cos(a1),40+ro*Math.sin(a1));
      ctx.lineTo(40+r*Math.cos(a1),40+r*Math.sin(a1));ctx.lineTo(40+r*Math.cos(a2),40+r*Math.sin(a2));}
    ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(40,40,10,0,Math.PI*2); ctx.stroke();
  },
  (ctx) => { // I-beam cross section
    ctx.strokeRect(15,15,50,8); ctx.strokeRect(15,57,50,8);
    ctx.strokeRect(36,23,8,34);
  },
  (ctx) => { // Bracket
    ctx.beginPath(); ctx.moveTo(10,70); ctx.lineTo(10,10); ctx.lineTo(70,10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10,70); ctx.lineTo(50,10); ctx.stroke();
  },
  (ctx) => { // Shaft/bearing cross
    ctx.beginPath(); ctx.arc(40,40,25,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(40,40,12,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(15,40); ctx.lineTo(65,40); ctx.moveTo(40,15); ctx.lineTo(40,65); ctx.stroke();
  },
  (ctx) => { // Spring
    ctx.beginPath();
    for(let i=0;i<=40;i++){const t=i/40,x=15+50*t,y=40+20*Math.sin(t*Math.PI*6);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);} ctx.stroke();
  },
  (ctx) => { // Bolt
    ctx.beginPath(); ctx.moveTo(40,5); ctx.lineTo(40,75); ctx.stroke();
    for(let i=0;i<8;i++){const y=10+i*8;ctx.beginPath();ctx.moveTo(28,y);ctx.lineTo(52,y);ctx.stroke();}
    ctx.strokeRect(28,5,24,12);
  },
];

function _initAmbientBg() {
  const canvas = document.getElementById('ambient-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [], raf;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize); resize();
  const N = 32;
  for (let i = 0; i < N; i++) particles.push(_mkParticle());
  function _mkParticle() {
    const type = Math.random() < 0.4 ? 'quote' : Math.random() < 0.6 ? 'eq' : 'bp';
    return {
      type, x: rand(0, window.innerWidth), y: rand(0, window.innerHeight),
      vx: rand(-0.12, 0.12), vy: rand(-0.08, 0.06),
      alpha: rand(0.04, 0.14), alphaDir: 1, alphaSpeed: rand(0.0003, 0.001),
      rot: rand(-0.04, 0.04), rotV: rand(-0.0003, 0.0003),
      text: type === 'quote' ? QUOTES[randI(0, QUOTES.length)] : type === 'eq' ? EQUATIONS[randI(0, EQUATIONS.length)] : null,
      bpFn: type === 'bp' ? BP_FUNS[randI(0, BP_FUNS.length)] : null,
      size: type === 'quote' ? rand(10,13) : type === 'eq' ? rand(11,15) : 1,
    };
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV;
      p.alpha += p.alphaDir * p.alphaSpeed;
      if (p.alpha > 0.16 || p.alpha < 0.02) p.alphaDir *= -1;
      if (p.x < -200) p.x = W + 50; if (p.x > W + 200) p.x = -50;
      if (p.y < -50)  p.y = H + 20; if (p.y > H + 50)  p.y = -20;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.alpha;
      if (p.type === 'quote') {
        ctx.font = 'italic ' + p.size + 'px Georgia, serif';
        ctx.fillStyle = '#c8ddef'; ctx.fillText(p.text, 0, 0);
      } else if (p.type === 'eq') {
        ctx.font = '500 ' + p.size + 'px "JetBrains Mono", monospace';
        ctx.fillStyle = '#54d7ff'; ctx.fillText(p.text, 0, 0);
      } else if (p.type === 'bp' && p.bpFn) {
        ctx.strokeStyle = '#3366aa'; ctx.lineWidth = 1.2;
        p.bpFn(ctx);
      }
      ctx.restore();
    }
    raf = requestAnimationFrame(draw);
  }
  draw();
  return { stop: () => cancelAnimationFrame(raf), restart: draw };
}

/* ── Expose ──────────────────────────────────────────────────────────────── */
global.UARE_ENKI = {
  init: _init,
  getAssembly: () => _assembly,
  addMessage: _addMsg,
};

/* ── Boot (called from app.js or inline) ────────────────────────────────── */
if (typeof document !== 'undefined') {
  const _boot = () => {
    const hdrs = { 'Content-Type': 'application/json', 'x-user-id': 'tester', 'x-user-role': 'owner' };
    _init({ endpoint: '/copilot', headers: hdrs });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else setTimeout(_boot, 50);
}

})(typeof window !== 'undefined' ? window : global);`);

console.log('\\n All 3 files written successfully.');
console.log('Next: run node _rewrite.mjs DONE — now run syntax checks.');

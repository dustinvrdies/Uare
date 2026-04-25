/* ═══════════════════════════════════════════════════════════════════════════
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

function _num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _normVec3(v, fallback) {
  if (Array.isArray(v)) {
    return [
      _num(v[0], fallback[0]),
      _num(v[1], fallback[1]),
      _num(v[2], fallback[2]),
    ];
  }
  if (v && typeof v === 'object') {
    return [
      _num(v.x, fallback[0]),
      _num(v.y, fallback[1]),
      _num(v.z, fallback[2]),
    ];
  }
  return fallback.slice();
}

function _canonicalDims(part) {
  const src = Object.assign({}, part && part.dimensions_mm, part && part.dims);
  const pick = function() {
    for (let i = 0; i < arguments.length; i++) {
      const k = arguments[i];
      if (src[k] != null && src[k] !== '') return Number(src[k]);
    }
    return null;
  };

  const w = pick('w', 'width', 'x');
  const h = pick('h', 'height', 'z', 'thickness');
  const d = pick('d', 'depth', 'y');
  const L = pick('L', 'length', 'len', 'height', 'h', 'z');
  const dia = pick('diameter', 'dia', 'd', 'outerD', 'outer_diameter', 'od');

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

  const x = pick('x', 'width', 'w');
  const y = pick('y', 'depth', 'd');
  const z = pick('z', 'height', 'h', 'thickness');
  if (x != null) out.x = x;
  if (y != null) out.y = y;
  if (z != null) out.z = z;

  return out;
}

function _normalizePart(part, idx) {
  const p = Object.assign({}, part || {});
  const dims = _canonicalDims(p);
  const transform = p.transform_mm;
  const position = p.position != null ? p.position : transform;

  p.id = p.id || ('part_' + String(idx + 1).padStart(4, '0'));
  p.type = String(p.type || p.shape || p.kind || 'custom').toLowerCase();
  p.material = String(p.material || 'steel').toLowerCase();
  p.dims = dims;
  p.dimensions_mm = Object.assign({}, p.dimensions_mm || {}, dims);
  p.position = _normVec3(position, [0, 0, 0]);
  p.rotation = _normVec3(p.rotation, [0, 0, 0]);
  if (p.mass_kg != null) p.mass_kg = _num(p.mass_kg, p.mass_kg);
  return p;
}

function _promoteEngineSpecificPartType(part) {
  if (!part || typeof part !== 'object') return part;
  const type = String(part.type || '').toLowerCase();
  const name = String(part.name || '').toLowerCase();
  const setType = (next) => {
    part.type = next;
  };

  if ((type === 'housing' || type === 'custom') && /oil pump|gerotor/.test(name)) setType('oil_pump');
  if ((type === 'housing' || type === 'custom') && /water pump|coolant pump/.test(name)) setType('water_pump');
  if ((type === 'housing' || type === 'custom') && /thermostat housing/.test(name)) setType('thermostat_housing');
  if ((type === 'cylinder' || type === 'custom') && /^thermostat\b/.test(name)) setType('thermostat_valve');
  if ((type === 'housing' || type === 'custom') && /(ignition coil|coil-on-plug|\bcop\b|coil pack)/.test(name)) setType('ignition_coil');
  if (type === 'cylinder' && /fuel injector/.test(name)) setType('fuel_injector');
  if (type === 'cylinder' && /oil filter/.test(name)) setType('oil_filter');

  if (type === 'cylinder' || type === 'custom' || type === 'housing') {
    if (/\bmap sensor\b/.test(name)) setType('map_sensor');
    else if (/\biat sensor\b|intake air temp/.test(name)) setType('iat_sensor');
    else if (/\bo2 sensor\b|oxygen sensor/.test(name)) setType('o2_sensor');
    else if (/\bknock sensor\b/.test(name)) setType('knock_sensor');
    else if (/coolant temperature sensor|\bcts\b/.test(name)) setType('coolant_temp_sensor');
    else if (/crank position sensor|\bckp\b/.test(name)) setType('crank_sensor');
    else if (/cam position sensor|\bcmp\b/.test(name)) setType('cam_sensor');
    else if (/oil pressure sender|oil pressure sensor/.test(name)) setType('oil_pressure_sensor');
    else if (/\bsensor\b/.test(name)) setType('engine_sensor');
  }

  return part;
}

/* ── Enki System Prompt ──────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are Enki — UARE's hyper-precision autonomous engineering AI. You embody the combined mastery of a senior mechanical engineer, electrical engineer, manufacturing engineer, materials scientist, aerospace engineer, propulsion engineer, and systems integrator.

━━━ GOLDEN RULE ━━━
NEVER APPROXIMATE. NEVER OMIT. Every bolt is individually placed. Every weld bead is specified. Every solder joint exists. Every wire has a gauge and routing path. Every seal has a compound and groove spec. You are generating a SCIENTIFIC DIGITAL TWIN — accurate enough for CNC machining, FEA simulation, patent filing, and manufacturing. If the real assembly has 800 parts, your JSON has 800+ entries.

━━━ MANDATORY PART COUNT TARGETS ━━━
- Simple bracket/mount: 20–60 parts
- Gearbox / gearhead: 150–350 parts
- 4-cylinder engine (ICE): 350–600 parts
- Turbopump / compressor: 300–600 parts
- Full rocket engine (liquid): 600–1200 parts
- Complete electronics PCB: 80–300 parts (every component + every via + every solder joint)
- 6-DOF robot arm: 200–400 parts
- Full vehicle powertrain: 800–1500 parts
- Spacecraft stage: 1000–3000 parts

━━━ SCIENTIFIC ACCURACY REQUIREMENTS ━━━

FASTENERS — Every threaded fastener must have:
• ISO/DIN/SAE standard (ISO 4762, DIN 931, SAE J429)
• Thread spec: M8×1.25 or 3/8-16 UNC
• Shank length in mm
• Head type: hex / socket / pan / countersunk / flange
• Property class: 8.8 / 10.9 / 12.9 / A2-70 / A4-80 / Grade 5 / Grade 8
• Surface treatment: zinc-nickel 8μm / hot-dip galv / cadmium plate / black oxide
• Torque spec: Mk=25 N·m
• Position each fastener at its exact hole center

WELDS — Every weld must have:
• Process: GMAW (MIG) / GTAW (TIG) / SMAW (stick) / FCAW / SAW
• Filler metal: ER70S-6 / ER308L / ER4043 / E7018
• Fillet leg size (e.g., 6mm fillet = 4.2mm throat)
• Length of weld run in mm
• Position: 1G/2G/3F/4F (flat/horizontal/vertical/overhead)
• Preheat temperature if required (e.g., "preheat 150°C for 4340 steel")
• Use type "weld_fillet" for all fillet welds, "weld_butt" for groove welds

SOLDER JOINTS — Every electronic component must have:
• Individual solder_joint entries at each pad/pin
• Solder alloy: SAC305 (Sn96.5Ag3Cu0.5) or Sn63Pb37
• IPC J-STD-001 Class II or Class III
• Joint type: SMD reflow / through-hole wave / hand soldering
• Dims for SMD: { "d": 0.8, "h": 0.5 }; through-hole: { "d": 1.2, "h": 1.8 }

BEARINGS — Every bearing must have:
• Full designation: 6205-2RS C3 / 7308-BECBP / 32210 JR2 / NK 35/30
• Type: deep groove ball / angular contact (15° or 25°) / tapered roller / needle / thrust
• Bore × OD × Width in mm
• Dynamic load rating Cr in kN
• Grease type: Polyrex EM / Mobilgrease 28 / Kluber ISOFLEX NBU 15
• Speed limit in RPM

SEALS — Every dynamic seal must have:
• O-ring: AS568 dash number + Parker compound (V0747-75 Viton, N0674-70 NBR)
• Groove dimensions: ID × depth × width
• Static or dynamic; fluid compatibility; pressure rating in bar
• Lip seal: SKF/NOK designation + lip type (PTFE lip for high speed)

MATERIALS — Always use full alloy designation:
• "aluminum_7075_t6" not "aluminum"
• "steel_4340" with condition: "Q+T, HRC 38-42, AMS 6414"
• "stainless_316l" for weld fittings (low carbon for weld sensitization prevention)
• Electronics: "solder_sac305" for lead-free, "solder_snpb63" for leaded
• Coatings in notes: "anodize type III hard 25μm" / "Kanigen electroless nickel 25μm"

SURFACE FINISH:
• Bearing journals: Ra 0.4μm (Rz 1.6μm), grind to h6 tolerance
• General machined: Ra 1.6μm (Rz 6.3μm)
• Cast as-cast: Ra 12.5μm
• Sealing faces: Ra 0.8μm
• Gear tooth flanks: Ra 0.8μm (ground), Ra 1.6μm (hobbed)

TOLERANCES (ISO system):
• Running fits (bearings, bores): H7/h6 or H7/f7
• Locational clearance: H7/k6
• Press/interference: H7/p6 or H7/s6
• Keyway: N9/h9

WIRES & CABLES:
• AWG gauge: AWG 22 = 0.33mm², AWG 18 = 0.75mm², AWG 12 = 3.3mm²
• Insulation: XLPE (105°C) / PVC (80°C) / silicone (200°C) / PTFE (260°C)
• Color codes: black=ground, red=+12V, yellow=+5V, green=signal, white=return, orange=can_h, blue=can_l
• Connector type at each end: JST-XH / Molex MX-150 / TE DT / Deutsch DTM / TE AMP

━━━ COMPLETE PART TYPE LIST ━━━
STRUCTURAL:   plate, beam, bracket, housing, ibeam, strut, column, gusset, rib, web_plate, flange, dome, tank
ROTARY:       gear, shaft, bearing, spring, turbine_disk, flywheel, impeller, pulley, sprocket, coupling
FLUID:        piston, nozzle, pipe_straight, pipe_elbow, pipe_tee, valve_body, orifice
FASTENERS:    bolt_hex, nut_hex, washer, screw_socket, screw_pan, screw_countersunk, rivet, dowel_pin, roll_pin, snap_ring, circlip, parallel_key, woodruff_key, shim, stud, thread_insert
WELDS:        weld_fillet, weld_butt, weld_spot, weld_plug
SEALS:        o_ring, gasket, lip_seal, v_ring, back_up_ring
ELECTRICAL:   pcb, resistor, capacitor, inductor, ic_dip, ic_smd, connector_header, wire_segment, solder_joint, bus_bar, transformer, relay, fuse_holder, terminal_block, crystal, diode, transistor, led
THERMAL:      heat_sink, heat_pipe, fin_array, tec_module
SPECIALTY:    ablator, tile, mli_insulation, cable_tie, heat_shrink, foam_fill, label, handle

━━━ MATERIAL GRADES (use exact strings) ━━━
STEELS:       steel, steel_1018, steel_4130, steel_4340, steel_17_4ph, stainless_304, stainless_316, stainless_316l, tool_steel_d2, tool_steel_h13, spring_steel, cast_iron, cast_iron_ductile
ALUMINUMS:    aluminum, aluminum_2024_t3, aluminum_6061_t6, aluminum_7075_t6, aluminum_7050_t7451, aluminum_cast_a380
TITANIUMS:    titanium_cp2, titanium_6al4v, titanium_6al4v_eli
HIGH TEMP:    inconel_625, inconel_718, hastelloy_c276, haynes_188, waspalloy, rene_80
NON-FERROUS:  copper, copper_c110, copper_c17200, brass, bronze, magnesium_az31b
ELECTRONICS:  solder_sac305, solder_snpb63, copper_pcb, fr4, fr4_tg170
POLYMERS:     abs, nylon, nylon_pa66, peek, ptfe, pom_delrin, polycarbonate, silicone, nbr_rubber, viton, epoxy
COMPOSITES:   carbon_fiber, carbon_fiber_t800, cfrp_quasi_iso, fiberglass, nomex_honeycomb
SPECIALTY:    pica_x, rcc, mli_insulation, aerogel, graphene_composite, solder, pcb_copper

━━━ ASSEMBLY JSON SCHEMA (STRICT — DO NOT DEVIATE) ━━━
\`\`\`json
{
  "assembly": true,
  "name": "Full descriptive name — key specs in title",
  "description": "Operating envelope, peak power/thrust/torque, mass, key performance parameters",
  "revision": "A",
  "standard": "ISO 9001:2015",
  "total_mass_kg": 0.000,
  "parts": [
    {
      "id": "unique_id_snake_case",
      "name": "Engineering name + standard designation (e.g. ISO 4762 M8×25)",
      "type": "type_from_list",
      "material": "material_grade_string",
      "dims": { "w": 100, "h": 50, "d": 30 },
      "position": [x, y, z],
      "rotation": [rx, ry, rz],
      "color": "#rrggbb",
      "mass_kg": 0.000,
      "quantity": 1,
      "standard": "ISO 4762",
      "surface_finish": "Ra 0.8",
      "tolerance": "H7/k6",
      "torque_nm": 25,
      "notes": "Heat treatment, surface coating, mating part ID, assembly sequence, torque spec, material condition"
    }
  ],
  "bom_notes": "What IS modeled; what is NOT modeled; key manufacturing notes; critical tolerances"
}
\`\`\`

━━━ POSITIONING RULES ━━━
All dimensions in mm. position[] = part geometric centroid. Y = vertical (up). X = left-right. Z = front-back.
• Engine block:    crankshaft bore centerline at Y=0, Z=0. Cylinder 1 at X=0. Cylinders spaced 100mm in X.
• Rocket:         nozzle exit at Y=0. Combustion chamber above. Payload at Y=max.
• Electronics:    PCB top copper layer at Y=0. Component bodies extend +Y. Solder joints at Y=−0.5.
• Fasteners:      place at exact hole center with Y-axis along bolt axis.
• Welds:          place at joint midpoint. Orient along weld run direction.
• Solder joints:  place at pin/pad center on PCB surface.

━━━ EXAMPLE ENTRIES FOR MAXIMUM DETAIL ━━━

FASTENER example:
{ "id":"hb_001", "name":"Head Bolt — ISO 4762 M11×1.5×130 10.9 Torx55", "type":"bolt_hex", "material":"steel_4340", "dims":{"d":11,"L":130}, "position":[25,240,80], "color":"#4a4a4a", "mass_kg":0.085, "standard":"ISO 4762", "torque_nm":100, "surface_finish":"Ra 1.6", "notes":"Grade 10.9, zinc-nickel 8μm. Torque-angle: 80 N·m + 90° + 90°. Replace after 2 removals. ARP 2000 alternative." }

BEARING example:
{ "id":"mb_brg_1", "name":"Main Bearing #1 — SKF 6206-2RS C3", "type":"bearing", "material":"steel", "dims":{"innerD":30,"outerD":62,"width":16}, "position":[0,0,110], "color":"#8899aa", "mass_kg":0.19, "notes":"Deep groove ball bearing, 6206-2RS C3. Cr=19.5kN. Grease: Polyrex EM. Speed limit: 6000 RPM. H7 housing bore, k5 shaft journal." }

SOLDER JOINT example:
{ "id":"sj_r1_a", "name":"Solder Joint — R1 Pad A (SAC305 reflow)", "type":"solder_joint", "material":"solder_sac305", "dims":{"d":0.8,"h":0.5}, "position":[12.5,0,8.2], "color":"#d4c88a", "mass_kg":0.000001, "notes":"SAC305 Sn96.5Ag3Cu0.5. Reflow profile: 150°C preheat 60s, 250°C peak 10s. IPC J-STD-001 Class III. Fillet height 0.3–0.7mm. IPC-610E criterion: excellent fillet both ends." }

WELD example:
{ "id":"wld_001", "name":"Fillet Weld — Block to Sump Rail, GMAW", "type":"weld_fillet", "material":"steel", "dims":{"w":6,"h":4,"d":180}, "position":[0,-85,110], "color":"#8a7040", "mass_kg":0.04, "notes":"GMAW. Filler: ER70S-6. 6mm fillet × 180mm run. 1F position. Interpass temp ≤250°C. Visual + MT inspection per AWS D1.1." }

━━━ MANDATORY RULES ━━━
1. Output the COMPLETE JSON with ALL parts listed individually. NEVER write "repeat for each cylinder" or use "...etc".
2. For a 4-cylinder engine: include all 4 pistons, all 16 valves, all 32 collets, all 10 main bearing shells, all 8 rod bolts — each as a separate entry.
3. Color guide: steel/iron=#5a6a7a, aluminum=#9ab0c0, cast_iron=#5a6060, bronze=#cd7f32, pcb=#2a6030, copper_trace=#b87333, solder=#d4c88a, weld_bead=#8a7040, o_ring=#1a1a1a, gasket=#3a3a2a, bearing_steel=#c8d8e0.
4. Always end with exactly 3 specific engineering improvement recommendations (material upgrade, tolerance tightening, or process optimization).`;

/* ── Greeting Options ────────────────────────────────────────────────────── */
const GREETINGS = [
  "Hello! I'm Enki, your AI engineering co-designer. Describe any mechanical system, product, or assembly and I'll generate a full parametric 3D CAD model — complete with materials, dimensions, and a simulation-ready assembly. What are we building today?",
  "Ready to engineer something exceptional. I'm Enki — I can design complete multi-part assemblies with realistic materials and dimensions, then run physics simulations to validate performance. What's your concept?",
  "Engineering AI online. Tell me what you want to design — anything from a simple bracket to a complete engine or robotic system — and I'll build it part by part in the 3D viewport. Let's create.",
  "Welcome to UARE. I'm Enki, and I specialize in turning ideas into fully parametric engineering designs. Describe your project — including any requirements for materials, dimensions, or performance targets — and let's start building."
];

/* ── Quick Intent Patterns (offline, no LLM needed) ─────────────────────── */
const QUICK_PATTERNS = [
  { re: /\b((?:4|four)[ -]?(?:cyl|cylinder)|inline.?4|i4).*engine|engine.*((?:4|four)[ -]?(?:cyl|cylinder)|inline.?4|i4)/i, fn: _buildEngine4Cyl },
  { re: /\b(gear|gearbox|transmission|reducer|differential)/i, fn: _buildGearAssembly },
  { re: /\b(drone|quadcopter|uav|fpv.quad)/i, fn: _buildDrone },
  { re: /\b(robot|robotic).*(arm|manipulator)|6.?dof.*(arm|robot)/i, fn: _buildRoboticArm },
  { re: /\b(centrifugal.pump|pump|volute|impeller.pump)/i, fn: _buildPump },
  { re: /\b(electric.motor|induction.motor|bldc|pmsm|servo.motor|ac.motor|ie3)\b/i, fn: _buildMotor },
  { re: /\b(heat.exchanger|shell.and.tube|shell.*tube|tube.*bundle|condenser|evaporator)\b/i, fn: _buildHeatExchanger },
  { re: /\b(suspension|double.wishbone|coilover|shock.absorber|damper.spring|wishbone)\b/i, fn: _buildSuspension },
  { re: /\b(wind.turbine|windmill|hawt|offshore.wind|turbine.blade.wind)/i, fn: _buildWindTurbine },
  { re: /\b(bridge|truss.bridge|warren.truss|girder.bridge|arch.bridge|span.bridge)/i, fn: _buildBridge },
  { re: /\b(bracket|mount|clamp)/i, fn: _buildBracket },
  { re: /\b(spring|compression.spring|torsion.spring)/i, fn: (t) => ({ assembly:true, name:'Compression Spring', description:'Helical compression spring, steel wire', total_mass_kg:0.012, parts:[{ id:'sp001', name:'Compression Spring', type:'spring', material:'spring_steel', dims:{coils:10,wireD:3,outerD:25,freeLen:80}, position:[0,0,0], color:'#a0a0a8', mass_kg:0.012, notes:'EN 10270-1 SH wire. Free length 80mm.' }]}) },
  { re: /\b(bearing|ball.bearing|roller.bearing)/i, fn: (t) => ({ assembly:true, name:'Deep Groove Ball Bearing — SKF 6205-2RS', description:'Single-row deep groove ball bearing', total_mass_kg:0.19, parts:[{ id:'brg001', name:'Deep Groove Ball Bearing 6205-2RS', type:'bearing', material:'steel', dims:{innerD:25,outerD:52,width:15}, position:[0,0,0], color:'#c8d8e0', mass_kg:0.19, notes:'SKF 6205-2RS C3. Cr=14.0kN. Polyrex EM grease. H7 housing, k5 shaft.' }]}) },
  { re: /\b(shaft|axle|spindle)/i, fn: (t) => ({ assembly:true, name:'Stepped Shaft', description:'Precision machined steel shaft', total_mass_kg:1.4, parts:[{ id:'sh001', name:'Main Shaft — 4340 Steel', type:'shaft', material:'steel_4340', dims:{d:40,L:320}, position:[0,0,0], color:'#6a7a8a', mass_kg:1.1, notes:'4340 Q+T. Ground OD Ra 0.4μm. k5 bearing seats.' }, { id:'sh002', name:'Shaft Key — Parallel', type:'parallel_key', material:'steel', dims:{w:10,h:8,d:50}, position:[0,20,155], color:'#5a6070', mass_kg:0.03 }, { id:'sh003', name:'Lock Nut M40×1.5', type:'nut_hex', material:'steel', dims:{d:40,h:14}, position:[0,0,145], color:'#4a4a4a', mass_kg:0.06 }]}) },
  { re: /\b(heat.?sink|heatsink|thermal)/i, fn: (t) => ({ assembly:true, name:'Extruded Aluminum Heat Sink', description:'Fin array heat sink, 80×60mm base, 40mm fins', total_mass_kg:0.22, parts:[{ id:'hs001', name:'Heat Sink Body — 6063-T5', type:'heat_sink', material:'aluminum', dims:{w:80,h:40,d:60,fins:14}, position:[0,0,0], color:'#b0c0d0', mass_kg:0.19, notes:'6063-T5 extrusion. Anodize type II 10μm. Thermal resistance 1.8°C/W natural convection.' }, { id:'hs002', name:'Thermal Interface Pad', type:'gasket', material:'silicone', dims:{w:80,h:1,d:60}, position:[0,-1,0], color:'#888888', mass_kg:0.008, notes:'Bergquist GP3000. 3.0 W/m·K. 0.1–0.3mm compressed.' }]}) },
  { re: /\b(pcb|circuit.board|electronics)/i, fn: (t) => ({ assembly:true, name:'PCB Assembly', description:'4-layer PCB with SMD components', total_mass_kg:0.08, parts:[{ id:'pcb001', name:'PCB — FR4 4-layer', type:'pcb', material:'fr4', dims:{w:100,h:1.6,d:80}, position:[0,0,0], color:'#1a5a20', mass_kg:0.04 }, { id:'pcb002', name:'MCU IC — LQFP64', type:'ic_smd', material:'abs', dims:{w:10,h:1.4,d:10}, position:[30,1.6,25], color:'#2a2a2a', mass_kg:0.002 }, { id:'pcb003', name:'Decoupling Cap 100nF — 0402', type:'capacitor', material:'abs', dims:{d:1,h:0.5}, position:[20,1.6,20], color:'#c8c8a0', mass_kg:0.0001 }, { id:'pcb004', name:'Power Connector', type:'connector', material:'nylon', dims:{w:12,h:8,d:5}, position:[5,1.6,5], color:'#cc4400', mass_kg:0.003 }]}) },
  { re: /\b(i.?beam|h.?beam|structural.steel)/i, fn: (t) => ({ assembly:true, name:'I-Beam Structure', description:'Hot-rolled steel I-beam, IPE 200', total_mass_kg:22.4, parts:[{ id:'ib001', name:'I-Beam — IPE 200, S275JR', type:'ibeam', material:'steel', dims:{H:200,W:100,tw:5.6,tf:8.5,L:1000}, position:[0,0,0], color:'#5a6a7a', mass_kg:22.4, notes:'EN 10025 S275JR. Hot-rolled. Moment of inertia Iy=1943cm⁴.' }]}) },
];

/* ── State ───────────────────────────────────────────────────────────────── */
let _opts = {};
let _history = []; // [{role:'user'|'assistant', content:str}]
let _assembly = null; // current assembly object
let _partBuildQueue = [];
let _isBusy = false;
let _pendingCadPlan = null;
let _pendingDerivedCadSpec = null;
const _MAX_AUTOLOAD_STL_BYTES = 48 * 1024 * 1024;
let _engineCycleState = null;

/* ── DOM Refs ────────────────────────────────────────────────────────────── */
let $msgs, $sugg, $input, $sendBtn, $enkiSub, $actionOverlay, $actionText,
    $actionFill, $enkiLive, $enkiLiveMsg, $asmName, $partCount,
  $vpEmpty, $asmTreeContent, $asmBOM, $mParts, $mMass, $simResult,
  $derivedSpecPanel, $derivedSpecSummary, $derivedSpecGrid, $derivedSpecStatus,
  $derivedSpecExecute, $derivedSpecDismiss,
  $engineBenchPanel, $engineThrottle, $engineThrottleVal, $engineLoad,
  $engineLoadVal, $engineRpmTarget, $enginePowerReadout, $engineTorqueReadout,
  $engineOilReadout, $engineCoolantReadout,
  $qaPanel, $qaScore, $qaDimDev, $qaMateViolations, $qaGeomWarnings,
  $qaDimensionList, $qaMateList, $qaGeometryList;

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
  $derivedSpecPanel = document.getElementById('derived-spec-panel');
  $derivedSpecSummary = document.getElementById('derived-spec-summary');
  $derivedSpecGrid = document.getElementById('derived-spec-grid');
  $derivedSpecStatus = document.getElementById('derived-spec-status');
  $derivedSpecExecute = document.getElementById('btn-derived-spec-execute');
  $derivedSpecDismiss = document.getElementById('btn-derived-spec-dismiss');
  $engineBenchPanel = document.getElementById('engine-bench-panel');
  $engineThrottle = document.getElementById('engine-throttle');
  $engineThrottleVal = document.getElementById('engine-throttle-val');
  $engineLoad = document.getElementById('engine-load');
  $engineLoadVal = document.getElementById('engine-load-val');
  $engineRpmTarget = document.getElementById('engine-rpm-target');
  $enginePowerReadout = document.getElementById('engine-power-readout');
  $engineTorqueReadout = document.getElementById('engine-torque-readout');
  $engineOilReadout = document.getElementById('engine-oil-readout');
  $engineCoolantReadout = document.getElementById('engine-coolant-readout');
  $qaPanel = document.getElementById('engineering-qa-panel');
  $qaScore = document.getElementById('qa-score');
  $qaDimDev = document.getElementById('qa-dim-dev');
  $qaMateViolations = document.getElementById('qa-mate-violations');
  $qaGeomWarnings = document.getElementById('qa-geom-warnings');
  $qaDimensionList = document.getElementById('qa-dimension-list');
  $qaMateList = document.getElementById('qa-mate-list');
  $qaGeometryList = document.getElementById('qa-geometry-list');

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
    _resetDerivedSpecPanel();
    _showGreeting();
  });
  const $newBtn = document.getElementById('btn-new');
  if ($newBtn) $newBtn.addEventListener('click', () => {
    _assembly = null;
    if ($msgs) $msgs.innerHTML = '';
    _history = [];
    _clearSuggestions();
    _resetAssemblyUI();
    _resetDerivedSpecPanel();
    if (global.UARE_CAD && global.UARE_CAD.clearScene) global.UARE_CAD.clearScene();
    if ($vpEmpty) $vpEmpty.classList.remove('hidden');
    _showGreeting();
  });
  if ($derivedSpecExecute) $derivedSpecExecute.addEventListener('click', _executePendingCadPlan);
  if ($derivedSpecDismiss) $derivedSpecDismiss.addEventListener('click', _resetDerivedSpecPanel);
  [$engineThrottle, $engineLoad].forEach((input) => {
    if (!input) return;
    input.addEventListener('input', _updateEngineBenchLabels);
  });
  if ($engineRpmTarget) {
    $engineRpmTarget.addEventListener('change', () => {
      const clamped = Math.max(700, Math.min(7600, Number($engineRpmTarget.value || 1200)));
      $engineRpmTarget.value = String(clamped);
    });
  }
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

  // Voice input button
  const $voiceBtn = document.getElementById('btn-voice');
  if ($voiceBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      let _listening = false;
      recognition.onstart = () => {
        _listening = true;
        $voiceBtn.classList.add('active');
        $voiceBtn.title = 'Listening… (click to stop)';
      };
      recognition.onresult = (e) => {
        const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
        if ($input) $input.value = transcript;
        if ($sendBtn) $sendBtn.disabled = !transcript.trim();
        if (e.results[e.results.length - 1].isFinal) {
          $voiceBtn.classList.remove('active');
          $voiceBtn.title = 'Voice input';
          _listening = false;
          if (transcript.trim()) setTimeout(_onSend, 400);
        }
      };
      recognition.onerror = (e) => {
        $voiceBtn.classList.remove('active');
        _listening = false;
        const msgs = { 'not-allowed': 'Microphone access denied. Please allow in browser settings.', 'no-speech': 'No speech detected.', 'network': 'Network error during speech recognition.' };
        _addMsg('assistant', msgs[e.error] || 'Voice input error: ' + e.error);
      };
      recognition.onend = () => { $voiceBtn.classList.remove('active'); _listening = false; };
      $voiceBtn.addEventListener('click', () => {
        if (_listening) { recognition.stop(); } else { recognition.start(); }
      });
    } else {
      $voiceBtn.title = 'Voice input not supported in this browser';
      $voiceBtn.style.opacity = '0.4';
      $voiceBtn.addEventListener('click', () => _addMsg('assistant', 'Voice input requires Chrome, Edge, or Safari with Web Speech API support.'));
    }
  }
}

function _bindExportBtn(id, fmt) {
  const $b = document.getElementById(id);
  if (!$b) return;
  $b.addEventListener('click', () => {
    if (!global.UARE_CAD) return;
    try {
      const sc = global.UARE_CAD.getLastScene && global.UARE_CAD.getLastScene();
      // Collect all mesh triangles from the Three.js scene graph
      const _collectTriangles = (root) => {
        const tris = [];
        if (!root) return tris;
        root.traverse(mesh => {
          if (!mesh.isMesh || !mesh.geometry) return;
          const geo = mesh.geometry;
          const pos = geo.attributes.position;
          if (!pos) return;
          const idx = geo.index;
          // Ensure world matrix is up-to-date
          if (mesh.matrixWorldNeedsUpdate) mesh.updateMatrixWorld(true);
          const e = mesh.matrixWorld.elements;
          const xfm = (i) => {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            return [e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]];
          };
          if (idx) {
            for (let i = 0; i < idx.count; i += 3)
              tris.push([xfm(idx.getX(i)), xfm(idx.getX(i+1)), xfm(idx.getX(i+2))]);
          } else {
            for (let i = 0; i < pos.count; i += 3)
              tris.push([xfm(i), xfm(i+1), xfm(i+2)]);
          }
        });
        return tris;
      };
      const _triNormal = (a, b, c) => {
        const ax=b[0]-a[0], ay=b[1]-a[1], az=b[2]-a[2];
        const bx=c[0]-a[0], by=c[1]-a[1], bz=c[2]-a[2];
        const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
        const l = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
        return [nx/l, ny/l, nz/l];
      };

      if (fmt === 'stl') {
        if (!sc || !sc.scene) { _addMsg('assistant', 'No assembly loaded.'); return; }
        const triangles = _collectTriangles(sc.scene);
        if (!triangles.length) { _addMsg('assistant', 'No geometry to export — load an assembly first.'); return; }
        const buf  = new ArrayBuffer(84 + triangles.length * 50);
        const view = new DataView(buf);
        for (let i = 0; i < 80; i++) view.setUint8(i, 0x55); // header 'U'×80
        view.setUint32(80, triangles.length, true);
        let off = 84;
        for (const [v0,v1,v2] of triangles) {
          const n = _triNormal(v0, v1, v2);
          [n[0],n[1],n[2]].forEach(f => { view.setFloat32(off, f, true); off+=4; });
          [v0,v1,v2].forEach(v => { v.forEach(f => { view.setFloat32(off, f, true); off+=4; }); });
          view.setUint16(off, 0, true); off+=2;
        }
        const blob = new Blob([new Uint8Array(buf)], { type: 'model/stl' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'assembly.stl'; a.click(); URL.revokeObjectURL(a.href);
        _addMsg('assistant', `STL exported: <strong>assembly.stl</strong> — ${triangles.length.toLocaleString()} triangles.`);
        return;

      } else if (fmt === 'obj') {
        if (!sc || !sc.scene) { _addMsg('assistant', 'No assembly loaded.'); return; }
        const triangles = _collectTriangles(sc.scene);
        if (!triangles.length) { _addMsg('assistant', 'No geometry to export — load an assembly first.'); return; }
        let obj = '# UARE CAD Engine — OBJ export\n# Parts: ' + (Object.keys(sc.partMeshes || {}).length) + '\ng assembly\n\n';
        let vIdx = 1;
        for (const [v0,v1,v2] of triangles) {
          const n = _triNormal(v0, v1, v2);
          obj += `v ${v0[0].toFixed(4)} ${v0[1].toFixed(4)} ${v0[2].toFixed(4)}\n`;
          obj += `v ${v1[0].toFixed(4)} ${v1[1].toFixed(4)} ${v1[2].toFixed(4)}\n`;
          obj += `v ${v2[0].toFixed(4)} ${v2[1].toFixed(4)} ${v2[2].toFixed(4)}\n`;
          obj += `vn ${n[0].toFixed(4)} ${n[1].toFixed(4)} ${n[2].toFixed(4)}\n`;
          const ni = Math.floor(vIdx / 3) + 1;
          obj += `f ${vIdx}//${ni} ${vIdx+1}//${ni} ${vIdx+2}//${ni}\n`;
          vIdx += 3;
        }
        _download(obj, 'assembly.obj', 'text/plain');
        _addMsg('assistant', `OBJ exported: <strong>assembly.obj</strong> — ${triangles.length.toLocaleString()} triangles, ${vIdx-1} vertices.`);
        return;

      } else if (fmt === 'step') {
        if (!sc || !sc.scene) { _addMsg('assistant', 'No assembly loaded.'); return; }
        const triangles = _collectTriangles(sc.scene);
        if (!triangles.length) { _addMsg('assistant', 'No geometry to export — load an assembly first.'); return; }
        const date = new Date().toISOString().slice(0,10);
        const parts = Object.keys(sc.partMeshes || {});
        let s = 'ISO-10303-21;\nHEADER;\n';
        s += "FILE_DESCRIPTION(('UARE Assembly Export'),'2;1');\n";
        s += `FILE_NAME('assembly.stp','${date}',('UARE CAD'),('UARE'),'UARE CAD Engine v3','','');\n`;
        s += "FILE_SCHEMA(('AP214E3'));\nENDSEC;\n\nDATA;\n";
        s += "#1=APPLICATION_CONTEXT('automotive design');\n";
        s += "#2=PRODUCT('ASSEMBLY','Assembly','',(#1));\n";
        s += "#3=PRODUCT_DEFINITION('','',#2,#1);\n";
        s += "#4=PRODUCT_DEFINITION_SHAPE('','',#3);\n";
        s += "#5=CARTESIAN_POINT('',(0.,0.,0.));\n";
        s += "#6=DIRECTION('',(0.,0.,1.));\n";
        s += "#7=DIRECTION('',(1.,0.,0.));\n";
        s += "#8=AXIS2_PLACEMENT_3D('',#5,#6,#7);\n";
        let id = 9;
        const L = (content) => { s += `#${id}=${content};\n`; return id++; };
        const triIds = [];
        for (const [v0,v1,v2] of triangles) {
          const n = _triNormal(v0,v1,v2);
          const pA=L(`CARTESIAN_POINT('',(${v0.map(f=>f.toFixed(6)).join(',')}))`);
          const pB=L(`CARTESIAN_POINT('',(${v1.map(f=>f.toFixed(6)).join(',')}))`);
          const pC=L(`CARTESIAN_POINT('',(${v2.map(f=>f.toFixed(6)).join(',')}))`);
          const vA=L(`VERTEX_POINT('',#${pA})`);
          const vB=L(`VERTEX_POINT('',#${pB})`);
          const vC=L(`VERTEX_POINT('',#${pC})`);
          triIds.push(L(`TRIANGULATED_FACE('',#${vA},#${vB},#${vC})`));
        }
        L(`CONNECTED_FACE_SET('',(${triIds.map(i=>'#'+i).join(',')}))`);
        s += 'ENDSEC;\nEND-ISO-10303-21;\n';
        _download(s, 'assembly.step', 'text/plain');
        _addMsg('assistant', `STEP exported: <strong>assembly.step</strong> — ${triangles.length.toLocaleString()} faces, ${parts.length} parts. Compatible with FreeCAD, SOLIDWORKS, Fusion 360.`);
        return;
      }
    } catch(e) { _addMsg('assistant', 'Export error: ' + esc(e.message)); }
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
  const quickPattern = QUICK_PATTERNS.find((pattern) => pattern.re.test(text)) || null;
  _resetDerivedSpecPanel();
  // 1. Show typing
  const typingId = _addTyping();
  // 2. Send to AI planner first; keep quick patterns as offline fallback.
  try {
    const resp = await _callLLM(text);
    _removeMsg(typingId);
    const response = resp.narrative || resp; // backwards compat if string returned
    if (!response) { _addMsg('assistant', 'No response from AI. Is the server running?'); return; }

    // 4a. Use server-provided assembly_plan if available (skips regex parse)
    let plan = resp.assembly_plan || _parseAssemblyPlan(response);
    if (quickPattern && quickPattern.fn === _buildEngine4Cyl && plan && !_isEngineAssembly(plan)) {
      plan = quickPattern.fn(text);
    }
    if (plan && plan.assembly && plan.parts && plan.parts.length > 0) {
      _addMsg('assistant', _mdToHtml(_stripJsonBlock(response)));
      await _buildAssemblyFromPlan(plan);
      _renderDerivedSpecPanel(resp.derived_cad_spec || plan.derived_cad_spec || null, plan);
      if (resp.cad_execution_id) {
        _addMsg('assistant',
          '🔩 CadQuery kernel execution started — <a href="/lab/?execution_id=' + esc(resp.cad_execution_id) + '">Open in unified app</a>'
        );
        // Auto-load the accurate kernel STL into the 3D viewport once ready
        _loadKernelSTLWhenReady(resp.cad_execution_id, plan && plan.name);
      } else if (resp.derived_cad_spec) {
        _addMsg('assistant', 'Review the <strong>Derived CAD Spec</strong> panel, then click <strong>Generate CAD</strong> when the inferred dimensions and tolerances look right.');
      }
    } else if (quickPattern) {
      const intent = quickPattern.fn(text);
      if (intent && intent.assembly && intent.parts) {
        await _buildAssemblyFromPlan(intent);
        return;
      }
    } else {
      await _streamMsg(response);
      _history.push({ role: 'assistant', content: response });
    }
  } catch (e) {
    _removeMsg(typingId);
    if (quickPattern) {
      const intent = quickPattern.fn(text);
      if (intent && intent.assembly && intent.parts) {
        await _buildAssemblyFromPlan(intent);
        return;
      }
    }
    throw e;
  }
}

/* ── LLM Call ────────────────────────────────────────────────────────────── */
async function _callLLM(userText) {
  // Build conversation context for Ollama (last 6 turns)
  const history = _history.slice(-12).map(m => m.content).join('\n');
  const contextualPrompt = history ? history + '\n' + userText : userText;

  // Use /copilot/contextual-analysis which routes to Ollama (with fallback to builtin)
  const endpoint = _opts.endpoint.replace(/\/?$/, '').replace(/\/contextual-analysis$/, '') + '/contextual-analysis';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, _opts.headers),
    body: JSON.stringify({ prompt: contextualPrompt, current_prompt: userText, system_prompt: SYSTEM_PROMPT, auto_execute_cad: false })
  });
  if (!res.ok) throw new Error('LLM API error ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'LLM API returned error');
  // Return enriched response — callers that only need text still get it via .narrative
  return {
    narrative: data.narrative || '',
    cad_execution_id: data.cad_execution_id || null,
    assembly_plan: data.assembly_plan || null,
    derived_cad_spec: data.derived_cad_spec || null,
    insights: data.insights || [],
    suggestions: data.suggestions || [],
  };
}

/* ── Parse Assembly Plan ─────────────────────────────────────────────────── */
function _parseAssemblyPlan(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1].trim());
    if (obj.assembly && Array.isArray(obj.parts)) return obj;
    return null;
  } catch (_) { return null; }
}
function _stripJsonBlock(text) {
  return text.replace(/```(?:json)?[\s\S]*?```/g, '').trim();
}

/* ── Kernel STL Auto-loader ──────────────────────────────────────────────── */
// Polls the artifact endpoint until assembly_kernel.stl is ready, then loads
// it into the 3D viewport for 100% accurate CadQuery geometry.
async function _loadKernelSTLWhenReady(executionId, assemblyName) {
  const CAD = global.UARE_CAD;
  if (!CAD || !CAD.loadKernelSTL) return false;
  const maxAttempts = 12; // up to ~24s
  const delay = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(delay);
    try {
      const r = await fetch('/cad/executions/' + executionId + '/artifacts', {
        headers: Object.assign({}, _opts && _opts.headers ? _opts.headers : {}),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
      const kernelArt = artifacts.find((artifact) => artifact.type === 'stl_kernel' || /kernel/i.test(artifact.filename || ''));
      const envelopeArt = artifacts.find((artifact) => /\.stl$/i.test(artifact.filename || '') && !/kernel/i.test(artifact.filename || ''));
      const kernelWithinLimit = !kernelArt || !kernelArt.bytes || Number(kernelArt.bytes) <= _MAX_AUTOLOAD_STL_BYTES;
      const envelopeWithinLimit = !envelopeArt || !envelopeArt.bytes || Number(envelopeArt.bytes) <= _MAX_AUTOLOAD_STL_BYTES;

      let art = null;
      if (kernelArt && kernelWithinLimit) art = kernelArt;
      else if (envelopeArt && envelopeWithinLimit) art = envelopeArt;
      else if (kernelArt || envelopeArt) {
        _addMsg('assistant', 'Kernel mesh artifacts are ready, but the STL is too large for automatic browser loading. The viewport will keep the lighter parametric scene to avoid memory failure.');
        return false;
      }
      if (!art) continue;

      if (art === envelopeArt && kernelArt && !kernelWithinLimit) {
        _addMsg('assistant', 'Loaded the lighter envelope STL because the full kernel mesh is too large for safe browser autoload.');
      }

      const stlUrl = art.url || ('/cad/artifacts/' + executionId + '/' + art.filename);
      const loaded = await CAD.loadKernelSTL(stlUrl, assemblyName || 'Assembly');
      if (!loaded && art !== envelopeArt && envelopeArt && envelopeWithinLimit) {
        const fallbackUrl = envelopeArt.url || ('/cad/artifacts/' + executionId + '/' + envelopeArt.filename);
        const fallbackLoaded = await CAD.loadKernelSTL(fallbackUrl, assemblyName || 'Assembly');
        if (fallbackLoaded) {
          _addMsg('assistant', '✅ <strong>Envelope mesh loaded</strong> — the browser fell back to a lighter STL because the full kernel mesh could not be loaded safely.');
          return true;
        }
      }
      if (loaded) {
        _addMsg('assistant', '✅ <strong>Accurate CadQuery geometry loaded</strong> — 3D viewport updated with real kernel mesh.');
        return true;
      }
    } catch (_) { /* keep polling */ }
  }
  return false;
}

async function _loadExecutionInUnifiedShell(executionId) {
  const id = String(executionId || '').trim();
  if (!id) return false;

  _addMsg('assistant', 'Loading CAD execution <code>' + esc(id) + '</code> in unified workspace…');

  let assemblyName = 'Assembly';
  try {
    const statusRes = await fetch('/cad/status/' + encodeURIComponent(id), {
      headers: Object.assign({}, _opts && _opts.headers ? _opts.headers : {}),
    });
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      assemblyName = (statusData && statusData.manifest && (statusData.manifest.recipe && statusData.manifest.recipe.name))
        || (statusData && statusData.manifest && statusData.manifest.execution_id)
        || assemblyName;
    }
  } catch (_) { /* non-fatal */ }

  const loaded = await _loadKernelSTLWhenReady(id, assemblyName);
  if (!loaded) {
    _addMsg('assistant', 'Waiting for CAD mesh artifacts for <code>' + esc(id) + '</code>. If this is a new run, they may still be generating.');
  }
  return Boolean(loaded);
}

/* ── Build Assembly from Plan ────────────────────────────────────────────── */
async function _buildAssemblyFromPlan(plan) {
  plan = Object.assign({}, plan || {}, {
    parts: ((plan && plan.parts) || []).map((p, i) => _promoteEngineSpecificPartType(_normalizePart(p, i))),
  });
  _resolveAssemblyConstraints(plan);
  const audit = _runAssemblyEngineeringAudit(plan);
  _stopEngineCycle(true);
  _assembly = plan;
  _setEngineBenchVisible(plan);
  _updateEngineeringQaPanel(plan, audit);
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
    '<br><span class="text-muted">Total mass: ' + mass + '</span>' +
    '<br><span class="text-muted">Engineering audit: ' + audit.score + '/100 (' + audit.issueCount + ' issue(s)).</span>'
  );
  if (audit.issueCount) {
    _addMsg('assistant', '<strong>Engineering Findings</strong><br>' + audit.issues.slice(0, 6).map((issue) => '• ' + esc(issue)).join('<br>'));
  }
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
    'Run thermal analysis',
    'Explode assembly view',
    'Export as STEP file',
    'Export as STL file',
    'Export as OBJ file',
    'Add tolerances & fits to all mating parts',
    'Suggest material upgrade for highest-stress parts',
    'Show bill of materials',
    'Add assembly instructions and torque specs',
    'Optimize for weight reduction (topology)',
    'Add fasteners and hardware',
    'Apply surface finish specifications',
  ];
  if (plan && plan.parts) {
    const types = plan.parts.map(p => p.type);
    if (_isEngineAssembly(plan)) suggs.unshift('Run engine cycle simulation');
    if (types.includes('shaft') || types.includes('gear')) suggs.unshift('Add lubrication system and oil passages');
    if (types.includes('piston') || types.includes('housing')) suggs.unshift('Add cooling water jacket and passages');
    if (types.some(t => ['bolt_hex','nut_hex','washer'].includes(t))) suggs.unshift('Verify torque specs and thread engagement');
    if (types.some(t => ['pcb','resistor','capacitor','ic_dip','ic_smd'].includes(t))) suggs.unshift('Add power planes, ground fills, and decoupling caps');
    if (types.some(t => ['bearing','shaft'].includes(t))) suggs.unshift('Add bearing pre-load and axial retention');
    if (types.includes('spring')) suggs.unshift('Calculate spring natural frequency and surge margin');
    if (types.includes('weld_fillet') || types.includes('weld_butt')) suggs.unshift('Verify weld heat input and preheat requirements');
    if (types.some(t => t.includes('turbine') || t.includes('impeller') || t.includes('compressor'))) suggs.unshift('Run CFD flow analysis and map velocity triangles');
  }
  return suggs.slice(0, 6);
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
      if (part) {
        _showPartProps(part);
        // Highlight in 3D viewport
        if (window.UARE_CAD && window.UARE_CAD._PS && window.UARE_CAD._PS._selectPart) {
          window.UARE_CAD._PS._selectPart(id);
        }
      }
    });
  });
}
function _renderBOM(plan) {
  if (!$asmBOM || !plan || !plan.parts) return;
  const totalMass = plan.parts.reduce((s, p) => s + (p.mass_kg || 0), 0);
  let html = '<div class="bom-header">Bill of Materials — ' + plan.parts.length + ' parts | ' + totalMass.toFixed(3) + ' kg</div>';
  html += '<div class="bom-table">' +
    '<div class="bom-thead"><span>#</span><span>Name</span><span>Material</span><span>Mass</span><span>Type</span></div>';
  plan.parts.forEach((p, i) => {
    const mat = p.material ? p.material.replace(/_/g, ' ') : '—';
    const mass = p.mass_kg != null ? (p.mass_kg >= 0.1 ? p.mass_kg.toFixed(3) + ' kg' : (p.mass_kg * 1000).toFixed(1) + ' g') : '—';
    html += '<div class="bom-row" data-bom-id="' + esc(p.id) + '" title="' + esc(p.name) + ' — click to inspect">' +
      '<span class="bom-idx">' + (i + 1) + '</span>' +
      '<span class="bom-name">' + esc(p.name) + '</span>' +
      '<span class="bom-mat">' + esc(mat) + '</span>' +
      '<span class="bom-mass">' + esc(mass) + '</span>' +
      '<span class="bom-type">' + esc(p.type || '—') + '</span>' +
    '</div>';
  });
  html += '</div>';
  if (plan.bom_notes) html += '<div class="bom-notes">' + esc(plan.bom_notes) + '</div>';
  $asmBOM.innerHTML = html;
  // Wire click → _showPartProps + 3D highlight
  $asmBOM.querySelectorAll('.bom-row').forEach(row => {
    row.addEventListener('click', () => {
      $asmBOM.querySelectorAll('.bom-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      const id = row.dataset.bomId;
      const part = ((_assembly && _assembly.parts) || []).find(p => p.id === id);
      if (part) {
        _showPartProps(part);
        if (window.UARE_CAD && window.UARE_CAD._PS && window.UARE_CAD._PS._selectPart) {
          window.UARE_CAD._PS._selectPart(id);
        }
      }
    });
  });
}
/* ── Engineering Material Database ──────────────────────────────────────── */
const _MAT_DB = {
  // Steels
  '316L stainless':  { grade:'AISI 316L', density:7980, yield_mpa:170, uts_mpa:485, elongation_pct:40, hardness_hrc:95, youngs_gpa:193, poisson:0.265, cte_per_k:16e-6, thermal_k:13.5, cp_j_kgk:500, notes:'Austenitic SS, excellent corrosion resistance, non-magnetic, weldable, FDA/pharma grade' },
  '304 stainless':   { grade:'AISI 304',  density:8000, yield_mpa:215, uts_mpa:505, elongation_pct:45, hardness_hrc:92, youngs_gpa:193, poisson:0.265, cte_per_k:17.2e-6, thermal_k:16.2, cp_j_kgk:500, notes:'Standard austenitic stainless, food/marine grade' },
  '17-4 ph':         { grade:'17-4 PH H900', density:7800, yield_mpa:1170, uts_mpa:1310, elongation_pct:10, hardness_hrc:44, youngs_gpa:197, poisson:0.28, cte_per_k:10.8e-6, thermal_k:18.3, cp_j_kgk:460, notes:'Precipitation hardened SS, aerospace fasteners & structural' },
  'inconel 718':     { grade:'IN718 AMS5662', density:8190, yield_mpa:1000, uts_mpa:1240, elongation_pct:12, hardness_hrc:36, youngs_gpa:211, poisson:0.294, cte_per_k:13e-6, thermal_k:11.4, cp_j_kgk:435, notes:'Ni superalloy, hot-section turbine & rocket engine blades' },
  'inconel 625':     { grade:'IN625 AMS5666', density:8440, yield_mpa:414, uts_mpa:827, elongation_pct:30, hardness_hrc:20, youngs_gpa:207, poisson:0.278, cte_per_k:12.8e-6, thermal_k:9.8, cp_j_kgk:410, notes:'High corrosion resistance, cryogenic to 980°C service' },
  'hastelloy c276':  { grade:'C276 AMS5750', density:8890, yield_mpa:276, uts_mpa:690, elongation_pct:40, hardness_hrc:18, youngs_gpa:205, poisson:0.284, cte_per_k:11.2e-6, thermal_k:11.1, cp_j_kgk:427, notes:'Excellent pitting & crevice corrosion resistance' },
  'titanium gr5':    { grade:'Ti-6Al-4V ELI', density:4430, yield_mpa:880, uts_mpa:950, elongation_pct:14, hardness_hrc:36, youngs_gpa:114, poisson:0.342, cte_per_k:8.6e-6, thermal_k:6.7, cp_j_kgk:526, notes:'Aerospace structural Ti, biocompatible, ASTM B265' },
  'titanium gr2':    { grade:'Ti Gr2 ASTM B338', density:4510, yield_mpa:275, uts_mpa:345, elongation_pct:20, hardness_hrc:70, youngs_gpa:102, poisson:0.37, cte_per_k:8.9e-6, thermal_k:16, cp_j_kgk:520, notes:'CP Ti, heat exchangers & cryogenic piping' },
  '4340 steel':      { grade:'SAE 4340 Q&T', density:7850, yield_mpa:1470, uts_mpa:1570, elongation_pct:12, hardness_hrc:49, youngs_gpa:210, poisson:0.29, cte_per_k:12.3e-6, thermal_k:44.5, cp_j_kgk:475, notes:'Aircraft-grade alloy steel, shafts, gears, landing gear' },
  'a286 superalloy': { grade:'A-286 AMS5737', density:7920, yield_mpa:586, uts_mpa:896, elongation_pct:23, hardness_hrc:30, youngs_gpa:200, poisson:0.286, cte_per_k:16.9e-6, thermal_k:14.7, cp_j_kgk:460, notes:'Fe-Ni superalloy, turbine discs, fasteners to 700°C' },
  // Aluminium
  '7075-t6 aluminium':{ grade:'AA7075-T6', density:2810, yield_mpa:503, uts_mpa:572, elongation_pct:11, hardness_hrc:87, youngs_gpa:71.7, poisson:0.33, cte_per_k:23.6e-6, thermal_k:130, cp_j_kgk:960, notes:'Highest-strength aerospace Al, structural frames & forgings' },
  '6061-t6 aluminium':{ grade:'AA6061-T6', density:2700, yield_mpa:276, uts_mpa:310, elongation_pct:17, hardness_hrc:60, youngs_gpa:68.9, poisson:0.33, cte_per_k:23.6e-6, thermal_k:167, cp_j_kgk:896, notes:'General aerospace/structural Al, weldable, anodizable' },
  '2024-t3 aluminium':{ grade:'AA2024-T3', density:2780, yield_mpa:345, uts_mpa:483, elongation_pct:18, hardness_hrc:78, youngs_gpa:73.1, poisson:0.33, cte_per_k:23.2e-6, thermal_k:121, cp_j_kgk:875, notes:'Fuselage skins & stringers, excellent fatigue strength' },
  // Copper alloys
  'cupronickel 90/10':{ grade:'CuNi 90/10 ASTM B111', density:8900, yield_mpa:110, uts_mpa:310, elongation_pct:30, hardness_hrc:50, youngs_gpa:136, poisson:0.33, cte_per_k:17.1e-6, thermal_k:50, cp_j_kgk:377, notes:'Heat exchanger tubes, seawater cooling lines' },
  'copper c110':     { grade:'C11000 (ETP Cu)', density:8940, yield_mpa:70, uts_mpa:220, elongation_pct:45, hardness_hrc:40, youngs_gpa:117, poisson:0.343, cte_per_k:16.9e-6, thermal_k:388, cp_j_kgk:385, notes:'High-conductivity electrical & thermal busbars' },
  // Polymers / seals
  'ptfe':            { grade:'PTFE Virgin', density:2200, yield_mpa:14, uts_mpa:31, elongation_pct:400, hardness_hrc:0, youngs_gpa:0.5, poisson:0.46, cte_per_k:135e-6, thermal_k:0.25, cp_j_kgk:1040, notes:'Chemically inert seals, cryogenic to 260°C, LOX compatible' },
  'viton fkm':       { grade:'Viton® FKM 75A', density:1840, yield_mpa:8.3, uts_mpa:14, elongation_pct:225, hardness_hrc:0, youngs_gpa:0.003, poisson:0.499, cte_per_k:180e-6, thermal_k:0.22, cp_j_kgk:1100, notes:'High-temp fluoroelastomer, fuel/oil seals, -20 to 204°C' },
  'epdm':            { grade:'EPDM 70A', density:1360, yield_mpa:4, uts_mpa:12, elongation_pct:350, hardness_hrc:0, youngs_gpa:0.002, poisson:0.499, cte_per_k:160e-6, thermal_k:0.25, cp_j_kgk:1100, notes:'Steam, water, UV-resistant seals, -55 to 150°C' },
  // Ceramics
  'silicon carbide': { grade:'SiC SSiC', density:3100, yield_mpa:410, uts_mpa:500, elongation_pct:0, hardness_hrc:92, youngs_gpa:410, poisson:0.14, cte_per_k:4.3e-6, thermal_k:120, cp_j_kgk:750, notes:'Ultra-hard ceramic, nozzle throats & pump wear rings' },
  'alumina 99.5':    { grade:'Al₂O₃ 99.5%', density:3890, yield_mpa:300, uts_mpa:380, elongation_pct:0, hardness_hrc:91, youngs_gpa:380, poisson:0.22, cte_per_k:8.4e-6, thermal_k:30, cp_j_kgk:880, notes:'Electrical insulation, high-temp bushings' },
  // Composites
  'cfrp ud':         { grade:'CFRP AS4/3501-6 UD', density:1550, yield_mpa:1500, uts_mpa:2280, elongation_pct:1.5, hardness_hrc:0, youngs_gpa:135, poisson:0.27, cte_per_k:-1e-6, thermal_k:7, cp_j_kgk:1200, notes:'Unidirectional carbon fibre, pressure vessels & structure' },
};
function _matLookup(materialName) {
  if (!materialName) return null;
  const key = materialName.toLowerCase().trim();
  if (_MAT_DB[key]) return _MAT_DB[key];
  // Fuzzy: find first key that is a substring of the name or vice-versa
  for (const [k, v] of Object.entries(_MAT_DB)) {
    if (key.includes(k) || k.includes(key.split(' ')[0])) return v;
  }
  return null;
}

/* ── Process Library ─────────────────────────────────────────────────────── */
const _PROCESS_DB = {
  turning:       'CNC turning, Ra 0.8–3.2 μm, IT6–IT9, tolerances ±0.01–0.05 mm',
  milling:       'CNC milling, Ra 0.8–6.4 μm, IT6–IT8, tolerances ±0.01–0.05 mm',
  grinding:      'Cylindrical/surface grinding, Ra 0.1–0.4 μm, IT5–IT6',
  additive:      'DMLS/SLM 316L, Ra 8–15 μm as-built, 20–50 μm layer, support removal required',
  casting:       'Investment casting, Ra 3.2–6.4 μm, IT8–IT10, post-machine critical faces',
  forging:       'Closed-die forging, IT8–IT11, grain flow follows contour for higher fatigue life',
  extrusion:     'Hot/cold extrusion, tight diametral tolerances ±0.05–0.1 mm',
  stamping:      'Progressive die stamping, ±0.05–0.1 mm, sheet metal 0.3–6 mm',
  edm:           'Wire/sinker EDM, Ra 0.4–1.6 μm, ±0.005–0.02 mm, no cutting force',
  injection:     'Injection moulding, Ra 0.8–3.2 μm, IT8–IT12, shrinkage 0.3–1.2%',
};

/* ── FEA Results Cache ───────────────────────────────────────────────────── */
const _feaResultsCache = {};
function _cacheFeaResult(partId, result) { _feaResultsCache[partId] = result; }
function _getFeaResult(partId) { return _feaResultsCache[partId] || null; }

/* ── Show Part Properties Panel ─────────────────────────────────────────── */
function _showPartProps(part, partDefOverride) {
  const $panel   = document.getElementById('part-props');
  const $title   = document.getElementById('part-props-title');
  const $content = document.getElementById('part-props-content');
  if (!$panel || !$content) return;

  const d   = partDefOverride || part;
  const mat = _matLookup(d.material);
  const dims= d.dims || {};
  const fea = _getFeaResult(d.id) || {};

  // Compute derived quantities
  const massG   = d.mass_kg != null ? (d.mass_kg * 1000).toFixed(1) : null;
  const weightN = d.mass_kg != null ? (d.mass_kg * 9.81).toFixed(2) : null;

  // Volume estimate from dims (bounding box → cylinder or box)
  let volCm3 = null;
  if (dims.diameter && dims.length) {
    const r = dims.diameter / 2 / 10;
    const l = dims.length / 10;
    volCm3 = (Math.PI * r * r * l).toFixed(2);
  } else if (dims.width && dims.height && dims.length) {
    volCm3 = ((dims.width / 10) * (dims.height / 10) * (dims.length / 10)).toFixed(2);
  }

  // Density cross-check
  let densityCheck = null;
  if (mat && volCm3 && d.mass_kg) {
    const calcMass = (mat.density * volCm3 / 1e6).toFixed(4);
    densityCheck = 'Calc: ' + calcMass + ' kg (ρ×V, ' + (Math.abs(d.mass_kg - calcMass) / d.mass_kg * 100).toFixed(1) + '% δ)';
  }

  // SF from FEA
  const sf = fea.safety_factor != null ? fea.safety_factor.toFixed(2) : (mat ? (mat.yield_mpa / Math.max(1, fea.sigma_mpa || 0)).toFixed(2) : null);
  const sfColor = sf ? (sf >= 2 ? '#4ade80' : sf >= 1.5 ? '#facc15' : '#f87171') : '#aaa';

  // Fastener torque spec
  let torqueSpec = null;
  if (d.torque_nm != null) {
    torqueSpec = d.torque_nm + ' N·m';
    if (mat) torqueSpec += ' — ' + (d.torque_nm * 0.738).toFixed(1) + ' ft·lbf';
  }

  // Build sections
  const sections = [
    {
      title: 'IDENTIFICATION',
      rows: [
        ['Part ID',     d.id],
        ['Name',        d.name],
        ['Type',        d.type],
        ['Standard',    d.standard],
        ['Revision',    d.revision || 'A'],
        ['Quantity',    d.quantity != null ? d.quantity + 'x' : null],
        ['Assembly seq',d.assembly_seq != null ? '#' + d.assembly_seq : null],
        ['Drawing ref', d.drawing_ref],
        ['BOM notes',   d.bom_notes],
      ]
    },
    {
      title: 'GEOMETRY',
      rows: [
        ...Object.entries(dims).map(([k, v]) => [k.toUpperCase() + ' [mm]', v]),
        ['Volume [cm³]',  volCm3],
        ['Surface finish',d.surface_finish || (mat ? 'Ra 1.6 μm (default)' : null)],
        ['Tolerance',     d.tolerance || 'General ±0.1 mm per ISO 2768-m'],
        ['Thread',        d.thread_spec],
        ['Weld class',    d.weld_class],
        ['Position [mm]', d.position ? d.position.map(v => v.toFixed(1)).join(', ') : null],
        ['Rotation [°]',  d.rotation ? d.rotation.map(v => v.toFixed(1)).join(', ') : null],
        ['Assembly joint',d.joint_type],
        ['Clearance fit', d.clearance_fit],
        ['Interference',  d.interference_um != null ? d.interference_um + ' μm' : null],
      ]
    },
    {
      title: 'MATERIAL PROPERTIES',
      rows: mat ? [
        ['Material',      d.material],
        ['Grade/spec',    mat.grade],
        ['Density [kg/m³]',mat.density.toLocaleString()],
        ['Yield Rp0.2 [MPa]', mat.yield_mpa],
        ['UTS [MPa]',     mat.uts_mpa],
        ['Elongation [%]',mat.elongation_pct],
        ['Hardness [HRB]',mat.hardness_hrc],
        ['Young\'s E [GPa]',mat.youngs_gpa],
        ['Poisson ν',     mat.poisson],
        ['CTE [×10⁻⁶/K]', (mat.cte_per_k * 1e6).toFixed(1)],
        ['Thermal k [W/m·K]', mat.thermal_k],
        ['Cp [J/kg·K]',   mat.cp_j_kgk],
        ['Mat notes',     mat.notes],
      ] : [
        ['Material', d.material || '—'],
        ['Note', 'Material not in database — manual spec required'],
      ]
    },
    {
      title: 'MASS & INERTIA',
      rows: [
        ['Mass [kg]',     d.mass_kg != null ? d.mass_kg.toFixed(4) : null],
        ['Mass [g]',      massG],
        ['Weight [N]',    weightN],
        ['Density check', densityCheck],
        ['CoG offset [mm]',d.cog_offset],
        ['Ixx [kg·m²]',   d.Ixx != null ? d.Ixx.toExponential(3) : null],
        ['Iyy [kg·m²]',   d.Iyy != null ? d.Iyy.toExponential(3) : null],
        ['Izz [kg·m²]',   d.Izz != null ? d.Izz.toExponential(3) : null],
      ]
    },
    {
      title: 'MANUFACTURING',
      rows: [
        ['Process',       d.process ? (d.process + ': ' + (_PROCESS_DB[d.process] || '')) : null],
        ['Heat treat',    d.heat_treatment],
        ['Coating',       d.coating],
        ['Plating',       d.plating],
        ['NDT method',    d.ndt || (d.mass_kg > 0.5 ? 'UT + PT per ASTM E1417' : 'Visual per ASTM E165')],
        ['Test pressure', d.test_pressure_bar != null ? d.test_pressure_bar + ' bar hydro' : null],
        ['Lead time',     d.lead_time_days != null ? d.lead_time_days + ' working days' : null],
        ['Supplier',      d.supplier],
        ['Cost (est.)',   d.cost_usd != null ? '$' + Number(d.cost_usd).toFixed(2) : null],
      ]
    },
    {
      title: 'ASSEMBLY & INTERFACE',
      rows: [
        ['Mating part',   d.mating_part],
        ['Torque spec',   torqueSpec],
        ['Tighten seq',   d.tighten_seq || (d.torque_nm ? 'Cross-pattern 30%→60%→100%' : null)],
        ['Preload [kN]',  d.preload_kn != null ? d.preload_kn.toFixed(2) : null],
        ['Loctite grade', d.loctite],
        ['Gasket/seal',   d.seal_type],
        ['Seating pressure [MPa]', d.seat_pressure_mpa],
        ['Leak test',     d.leak_test || (d.seal_type ? 'Helium leak, 1×10⁻⁸ mbar·l/s' : null)],
        ['Operating temp [°C]', d.temp_max_c != null ? d.temp_min_c + ' to ' + d.temp_max_c : null],
        ['Max pressure [bar]', d.pressure_max_bar],
        ['Flow rate [L/min]', d.flow_rate_lpm],
        ['Fluid',         d.fluid],
      ]
    },
    {
      title: 'STRUCTURAL ANALYSIS (BEAM THEORY)',
      rows: [
        ['Applied load [N]', fea.F_applied_N != null ? fea.F_applied_N.toFixed(1) : (d.mass_kg ? (d.mass_kg * 9.81 * 5).toFixed(1) + ' (5g shock)' : null)],
        ['Bending moment [N·m]', fea.moment_nm != null ? fea.moment_nm.toFixed(3) : null],
        ['Section',       fea.section_type || (dims.diameter ? 'Circular, d=' + dims.diameter + 'mm' : dims.width ? 'Rectangular ' + dims.width + '×' + (dims.height || dims.width) + 'mm' : null)],
        ['σ bending [MPa]',fea.sigma_mpa != null ? fea.sigma_mpa.toFixed(2) : null],
        ['σ axial [MPa]', fea.sigma_axial_mpa != null ? fea.sigma_axial_mpa.toFixed(2) : null],
        ['τ shear [MPa]', fea.tau_mpa != null ? fea.tau_mpa.toFixed(2) : null],
        ['σ von Mises [MPa]', fea.von_mises_mpa != null ? fea.von_mises_mpa.toFixed(2) : null],
        ['Yield [MPa]',   mat ? mat.yield_mpa : null],
        ['Safety factor', sf ? '<span style="color:' + sfColor + ';font-weight:700">' + sf + '</span>' : null],
        ['Fatigue limit [MPa]', mat ? (mat.uts_mpa * 0.45).toFixed(0) + ' (est. 0.45×UTS)' : null],
        ['FEA status',    sf ? (sf >= 1.5 ? '✅ PASS (SF≥1.5)' : '⚠️ MARGINAL — review required') : '—'],
        ['Normalized stress', fea.normalized != null ? (fea.normalized * 100).toFixed(1) + '%' : null],
      ]
    },
    {
      title: 'NOTES & COMPLIANCE',
      rows: [
        ['Engineering note', d.notes],
        ['Revision note', d.rev_note],
        ['REACH/RoHS',    d.reach_rohs || 'Verify with supplier'],
        ['CE marking',    d.ce_marking],
        ['Material cert', d.material_cert || 'MTR per EN 10204 3.1 required for flight-critical parts'],
      ]
    },
  ];

  // Render HTML
  let html = '';
  sections.forEach(sec => {
    const validRows = sec.rows.filter(([, v]) => v != null && v !== '' && v !== '—');
    if (!validRows.length) return;
    html += '<div class="props-section"><div class="props-section-title">' + esc(sec.title) + '</div>';
    validRows.forEach(([l, v]) => {
      const vStr = String(v);
      // Allow safe HTML tags in value (color spans, etc.)
      const safeV = vStr.startsWith('<span') ? vStr : esc(vStr);
      html += '<div class="prop-row"><span class="prop-label">' + esc(l) + '</span><span class="prop-val">' + safeV + '</span></div>';
    });
    html += '</div>';
  });

  // Export datasheet button
  html += '<div style="margin-top:8px;text-align:right">' +
    '<button class="btn-xs" onclick="(function(){' +
      'const data = document.getElementById(\'part-props-content\').innerText;' +
      'const blob = new Blob([data],{type:\'text/plain\'});' +
      'const a = document.createElement(\'a\');a.href=URL.createObjectURL(blob);' +
      'a.download=\'' + esc((d.name||d.id||'part').replace(/[^a-z0-9_-]/gi,'_')) + '_spec.txt\';' +
      'a.click();})()" style="background:#334466;color:#aaccff;border:1px solid #556;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px">⬇ Export Spec</button>' +
    '<button class="btn-xs" onclick="' +
      'const el=document.getElementById(\'part-props-content\');' +
      'const r=document.createRange();r.selectNode(el);window.getSelection().removeAllRanges();window.getSelection().addRange(r);document.execCommand(\'copy\');" ' +
      'style="background:#334466;color:#aaccff;border:1px solid #556;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px;margin-left:4px">📋 Copy</button>' +
    '</div>';

  $content.innerHTML = html;
  if ($title) $title.textContent = (d.name || d.id || 'Part') + (d.quantity > 1 ? ' ×' + d.quantity : '');
  $panel.classList.remove('collapsed');

  // Tell cad-engine to select/highlight this part in the 3D viewport
  if (window.UARE_CAD && window.UARE_CAD._PS && window.UARE_CAD._PS._selectPart) {
    window.UARE_CAD._PS._selectPart(d.id);
  }
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

function _renderQaRows(container, rows, formatValue) {
  if (!container) return;
  if (!Array.isArray(rows) || !rows.length) {
    container.innerHTML = '<div class="qa-empty">No findings.</div>';
    return;
  }
  container.innerHTML = rows.slice(0, 8).map((row) => {
    const label = row && (row.label || row.name || row.message || row.id || 'Check');
    const value = formatValue(row);
    return '<div class="qa-item"><span>' + esc(String(label)) + '</span><strong>' + esc(String(value)) + '</strong></div>';
  }).join('');
}

function _updateEngineeringQaPanel(plan, audit) {
  if (!$qaPanel) return;
  if (!plan || !audit) {
    $qaPanel.classList.add('hidden');
    if ($qaScore) $qaScore.textContent = '--/100';
    if ($qaDimDev) $qaDimDev.textContent = '-- mm';
    if ($qaMateViolations) $qaMateViolations.textContent = '--';
    if ($qaGeomWarnings) $qaGeomWarnings.textContent = '--';
    if ($qaDimensionList) $qaDimensionList.innerHTML = '<div class="qa-empty">No assembly loaded.</div>';
    if ($qaMateList) $qaMateList.innerHTML = '<div class="qa-empty">No assembly loaded.</div>';
    if ($qaGeometryList) $qaGeometryList.innerHTML = '<div class="qa-empty">No assembly loaded.</div>';
    return;
  }

  const solver = plan.constraint_solver || {};
  const mateRows = [];
  (solver.violations || []).forEach((violation) => {
    mateRows.push({
      label: (violation.partId || '?') + ' -> ' + (violation.baseId || '?'),
      deviationMm: violation.deviationMm,
    });
  });
  (solver.conflicts || []).forEach((conflict) => {
    mateRows.push({
      label: 'Conflict: ' + (conflict.partId || '?'),
      deviationMm: conflict.deltaMm,
    });
  });

  const maxDim = Number(audit.maxDimensionalDeviationMm || 0);
  const geomWarnings = Array.isArray(audit.geometryWarnings) ? audit.geometryWarnings : [];
  if ($qaScore) $qaScore.textContent = String(audit.score || 0) + '/100';
  if ($qaDimDev) $qaDimDev.textContent = maxDim.toFixed(2) + ' mm';
  if ($qaMateViolations) $qaMateViolations.textContent = String(mateRows.length);
  if ($qaGeomWarnings) $qaGeomWarnings.textContent = String(geomWarnings.length);

  _renderQaRows($qaDimensionList, audit.dimensionalChecks || [], (row) => {
    return row && row.deviationMm != null
      ? row.deviationMm.toFixed(2) + ' mm / tol ' + Number(row.toleranceMm || 0).toFixed(2)
      : 'n/a';
  });
  _renderQaRows($qaMateList, mateRows, (row) => Number(row.deviationMm || 0).toFixed(2) + ' mm');
  _renderQaRows($qaGeometryList, geomWarnings.map((message, index) => ({ label: 'Warning ' + (index + 1), message })), (row) => row.message || '');
  $qaPanel.classList.remove('hidden');
}

function _resetDerivedSpecPanel() {
  _pendingCadPlan = null;
  _pendingDerivedCadSpec = null;
  if ($derivedSpecPanel) $derivedSpecPanel.classList.add('hidden');
  if ($derivedSpecSummary) $derivedSpecSummary.innerHTML = '';
  if ($derivedSpecGrid) $derivedSpecGrid.innerHTML = '';
  if ($derivedSpecStatus) $derivedSpecStatus.textContent = 'Review before execution';
  if ($derivedSpecExecute) {
    $derivedSpecExecute.disabled = true;
    $derivedSpecExecute.textContent = 'Generate CAD';
  }
}
function _resetAssemblyUI() {
  if ($asmName) $asmName.textContent = 'No assembly loaded';
  if ($partCount) { $partCount.textContent = ''; $partCount.classList.add('hidden'); }
  if ($mParts) $mParts.textContent = '0';
  if ($mMass) $mMass.textContent = '0 kg';
  if ($asmTreeContent) $asmTreeContent.innerHTML = '';
  if ($asmBOM) $asmBOM.innerHTML = '';
  _setEngineBenchVisible(null);
  _updateEngineeringQaPanel(null, null);
}

function _formatSpecValue(value, suffix) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    const rendered = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
    return suffix ? rendered + ' ' + suffix : rendered;
  }
  return suffix ? String(value) + ' ' + suffix : String(value);
}

function _isEngineAssembly(plan) {
  const parts = Array.isArray(plan && plan.parts) ? plan.parts : [];
  if (!parts.length) return false;
  const types = new Set(parts.map((part) => String(part.type || '').toLowerCase()));
  return types.has('engine_block') && types.has('crankshaft') && types.has('piston');
}

function _captureEngineTransform(mesh) {
  return {
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
    scale: mesh.scale.clone(),
  };
}

function _restoreEngineTransforms(state) {
  if (!state || !Array.isArray(state.entries)) return;
  state.entries.forEach((entry) => {
    if (!entry.mesh || !entry.base) return;
    entry.mesh.position.copy(entry.base.position);
    entry.mesh.rotation.copy(entry.base.rotation);
    entry.mesh.scale.copy(entry.base.scale);
  });
}

function _stopEngineCycle(resetTransforms) {
  if (!_engineCycleState) return;
  if (_engineCycleState.rafId) cancelAnimationFrame(_engineCycleState.rafId);
  if (resetTransforms) _restoreEngineTransforms(_engineCycleState);
  _engineCycleState = null;
}

function _engineBenchSnapshot() {
  return {
    throttlePct: Math.max(0, Math.min(100, Number($engineThrottle && $engineThrottle.value || 28))),
    loadNm: Math.max(0, Math.min(260, Number($engineLoad && $engineLoad.value || 45))),
    rpmTarget: Math.max(700, Math.min(7600, Number($engineRpmTarget && $engineRpmTarget.value || 1200))),
  };
}

function _updateEngineBenchLabels() {
  const bench = _engineBenchSnapshot();
  if ($engineThrottleVal) $engineThrottleVal.textContent = bench.throttlePct.toFixed(0) + '%';
  if ($engineLoadVal) $engineLoadVal.textContent = bench.loadNm.toFixed(0) + ' N·m';
}

function _updateEngineBenchTelemetry(metrics) {
  if ($enginePowerReadout) $enginePowerReadout.textContent = metrics ? metrics.powerKw.toFixed(1) + ' kW' : '0.0 kW';
  if ($engineTorqueReadout) $engineTorqueReadout.textContent = metrics ? metrics.torqueNm.toFixed(0) + ' N·m' : '0 N·m';
  if ($engineOilReadout) $engineOilReadout.textContent = metrics ? metrics.oilPressureBar.toFixed(1) + ' bar' : '0.0 bar';
  if ($engineCoolantReadout) $engineCoolantReadout.textContent = metrics ? metrics.coolantTempC.toFixed(0) + ' C' : '20 C';
}

function _setEngineBenchVisible(plan) {
  const visible = _isEngineAssembly(plan);
  if ($engineBenchPanel) $engineBenchPanel.classList.toggle('hidden', !visible);
  if (!visible) {
    _updateEngineBenchTelemetry(null);
    return;
  }
  _updateEngineBenchLabels();
}

function _createInline4EngineSpec(overrides) {
  const spec = Object.assign({
    cylinders: 4,
    boreMm: 86,
    strokeMm: 86,
    rodLengthMm: 155,
    borePitchMm: 100,
    deckHeightMm: 240.5,
    headCenterYMm: 279,
    crankCenterYMm: 0,
    centerXMm: 150,
    centerZMm: 110,
    mainCapXsMm: [0, 100, 200, 300, 350],
    flywheelXOffsetMm: 280,
    compressionRatio: 10.5,
    redlineRpm: 6800,
    peakTorqueRpm: 4500,
    intakeValveHeadMm: 33,
    exhaustValveHeadMm: 28,
    intakeRunnerMm: 220,
    exhaustRunnerMm: 200,
    intakeCamCenterDeg: 112,
    exhaustCamCenterDeg: 116,
    vvtAuthorityDeg: 26,
    targetPeakTorqueNm: 200,
    targetPeakPowerKw: 147,
    peakPowerRpm: 6500,
    torqueCurveWidthRpm: 1850,
    powerCurveWidthRpm: 1400,
    fuelLhvJPerKg: 43e6,
    stoichAfr: 14.1,
    rotationalInertia: 0.34,
  }, overrides || {});
  spec.displacementCc = Math.PI / 4 * Math.pow(spec.boreMm / 10, 2) * (spec.strokeMm / 10) * spec.cylinders;
  spec.displacementLiters = spec.displacementCc / 1000;
  return spec;
}

function _createInline4Layout(spec) {
  const startX = spec.centerXMm - ((spec.cylinders - 1) * spec.borePitchMm) / 2;
  const cylinderXsMm = Array.from({ length: spec.cylinders }, (_, index) => startX + index * spec.borePitchMm);
  return {
    cylinderXsMm,
    crankCenter: [spec.centerXMm, spec.crankCenterYMm, spec.centerZMm],
    blockCenter: [spec.centerXMm, 70, spec.centerZMm],
    headCenter: [spec.centerXMm, spec.headCenterYMm, spec.centerZMm],
    intakeCamCenter: [spec.centerXMm, 390, 80],
    exhaustCamCenter: [spec.centerXMm, 390, 140],
    intakeManifoldCenter: [spec.centerXMm, 360, 60],
    exhaustManifoldCenter: [spec.centerXMm, 300, 160],
    oilPanCenter: [spec.centerXMm, -138, spec.centerZMm],
    valveCoverCenter: [spec.centerXMm, 415, spec.centerZMm],
    waterPumpCenter: [-30, 120, 20],
    starterCenter: [spec.centerXMm + spec.flywheelXOffsetMm - 70, -20, 175],
    alternatorCenter: [-60, 120, 50],
    valveZsMm: [80, 100, 115, 135],
  };
}

function _applyMateGraph(parts, mates) {
  const partMap = new Map((parts || []).map((part) => [part.id, part]));
  (mates || []).forEach((mate) => {
    const part = partMap.get(mate.partId);
    const base = partMap.get(mate.baseId);
    if (!part || !base) return;
    const basePos = Array.isArray(base.position) ? base.position : [0, 0, 0];
    const offset = Array.isArray(mate.offset) ? mate.offset : [0, 0, 0];
    part.position = [
      basePos[0] + offset[0],
      basePos[1] + offset[1],
      basePos[2] + offset[2],
    ];
    part.mate = { base_id: mate.baseId, joint: mate.joint || 'offset', offset_mm: offset.slice() };
  });
  return parts;
}

function _buildInline4MateGraph(parts, specOverrides) {
  const spec = _createInline4EngineSpec(specOverrides || {});
  const layout = _createInline4Layout(spec);
  const find = (pattern) => parts.find((part) => pattern.test(String(part.name || '')));
  const mates = [];
  const link = (pattern, basePattern, joint, offset) => {
    const part = find(pattern);
    const base = find(basePattern);
    if (part && base) mates.push({ partId: part.id, baseId: base.id, joint, offset });
  };
  const linkToPoint = (pattern, basePattern, joint, targetPoint) => {
    const part = find(pattern);
    const base = find(basePattern);
    if (!part || !base) return;
    const basePos = Array.isArray(base.position) ? base.position : [0, 0, 0];
    mates.push({
      partId: part.id,
      baseId: base.id,
      joint,
      offset: [
        targetPoint[0] - basePos[0],
        targetPoint[1] - basePos[1],
        targetPoint[2] - basePos[2],
      ],
    });
  };

  linkToPoint(/Cylinder Head/, /Cylinder Block/, 'deck_face', layout.headCenter);
  linkToPoint(/Intake Camshaft/, /Cylinder Head/, 'cam_bore', layout.intakeCamCenter);
  linkToPoint(/Exhaust Camshaft/, /Cylinder Head/, 'cam_bore', layout.exhaustCamCenter);
  link(/Intake Cam Sprocket/, /Intake Camshaft/, 'shaft_face', [-162, 0, 0]);
  link(/Exhaust Cam Sprocket/, /Exhaust Camshaft/, 'shaft_face', [-162, 0, 0]);
  link(/Timing Chain —/, /Cylinder Block/, 'timing_drive', [-162, 195, 0]);
  linkToPoint(/Intake Manifold/, /Cylinder Head/, 'intake_face', layout.intakeManifoldCenter);
  linkToPoint(/Exhaust Manifold/, /Cylinder Head/, 'exhaust_face', layout.exhaustManifoldCenter);
  linkToPoint(/Valve Cover/, /Cylinder Head/, 'cover_flange', layout.valveCoverCenter);
  linkToPoint(/Oil Pan —/, /Cylinder Block/, 'sump_rail', layout.oilPanCenter);
  linkToPoint(/Water Pump —/, /Cylinder Block/, 'front_cover', layout.waterPumpCenter);
  link(/Thermostat Housing/, /Cylinder Head/, 'coolant_outlet', [-100, -24, -90]);
  link(/Flywheel —/, /Crankshaft —/, 'crank_flange', [280, 0, 0]);
  link(/Clutch Disc —/, /Flywheel —/, 'clutch_face', [18, 0, 0]);
  link(/Pressure Plate —/, /Flywheel —/, 'clutch_cover', [38, 0, 0]);
  link(/Starter Motor —/, /Flywheel —/, 'ring_gear_mesh', [-70, -20, 62]);
  linkToPoint(/Alternator —/, /Cylinder Block/, 'front_accessory', layout.alternatorCenter);
  link(/Drive Belt Tensioner —/, /Cylinder Block/, 'front_accessory', [-210, -10, -60]);
  link(/Idler Pulley —/, /Cylinder Block/, 'front_accessory', [-175, -15, -60]);

  return mates;
}

function _mateOrderByDependency(mates) {
  const list = Array.isArray(mates) ? mates : [];
  const indegree = new Array(list.length).fill(0);
  const edges = new Map();
  const byPart = new Map();

  list.forEach((mate, idx) => {
    const partId = String(mate && mate.partId || '');
    if (!partId) return;
    if (!byPart.has(partId)) byPart.set(partId, []);
    byPart.get(partId).push(idx);
  });

  list.forEach((mate, idx) => {
    const baseId = String(mate && mate.baseId || '');
    const dependents = byPart.get(baseId) || [];
    dependents.forEach((depIdx) => {
      if (depIdx === idx) return;
      if (!edges.has(idx)) edges.set(idx, []);
      edges.get(idx).push(depIdx);
      indegree[depIdx] += 1;
    });
  });

  const queue = [];
  indegree.forEach((deg, idx) => { if (deg === 0) queue.push(idx); });
  const ordered = [];
  while (queue.length) {
    const idx = queue.shift();
    ordered.push(list[idx]);
    const out = edges.get(idx) || [];
    out.forEach((toIdx) => {
      indegree[toIdx] -= 1;
      if (indegree[toIdx] === 0) queue.push(toIdx);
    });
  }

  const unresolvedIndices = [];
  indegree.forEach((deg, idx) => {
    if (deg > 0) unresolvedIndices.push(idx);
  });
  unresolvedIndices.forEach((idx) => ordered.push(list[idx]));

  return {
    ordered,
    unresolvedMateIds: unresolvedIndices.map((idx) => String(list[idx] && list[idx].partId || '?')),
    cycleCount: unresolvedIndices.length,
  };
}

function _solveMateConstraints(plan, mates, options) {
  const cfg = Object.assign({
    maxPasses: 8,
    convergeTolMm: 0.05,
    hardTolMm: 0.8,
  }, options || {});
  const partMap = new Map((plan.parts || []).map((part) => [part.id, part]));
  const order = _mateOrderByDependency(mates);
  const conflicts = [];
  const unknownRefs = [];
  let iterations = 0;

  for (let pass = 0; pass < cfg.maxPasses; pass++) {
    iterations = pass + 1;
    let moved = 0;
    const targetByPart = new Map();

    order.ordered.forEach((mate) => {
      const part = partMap.get(mate.partId);
      const base = partMap.get(mate.baseId);
      if (!part || !base) {
        unknownRefs.push({ partId: mate.partId, baseId: mate.baseId });
        return;
      }
      const basePos = Array.isArray(base.position) ? base.position : [0, 0, 0];
      const off = Array.isArray(mate.offset) ? mate.offset : [0, 0, 0];
      const target = [basePos[0] + off[0], basePos[1] + off[1], basePos[2] + off[2]];

      if (targetByPart.has(part.id)) {
        const prior = targetByPart.get(part.id);
        const dx = target[0] - prior[0];
        const dy = target[1] - prior[1];
        const dz = target[2] - prior[2];
        const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (delta > cfg.hardTolMm) {
          conflicts.push({ partId: part.id, deltaMm: delta, baseId: mate.baseId });
        }
      }
      targetByPart.set(part.id, target);

      const cur = Array.isArray(part.position) ? part.position : [0, 0, 0];
      const dx = target[0] - cur[0];
      const dy = target[1] - cur[1];
      const dz = target[2] - cur[2];
      const shift = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (shift > cfg.convergeTolMm) moved += 1;

      part.position = target;
      part.mate = { base_id: mate.baseId, joint: mate.joint || 'offset', offset_mm: off.slice() };
    });

    if (moved === 0) break;
  }

  const violations = [];
  let maxDeviationMm = 0;
  order.ordered.forEach((mate) => {
    const part = partMap.get(mate.partId);
    const base = partMap.get(mate.baseId);
    if (!part || !base) return;
    const basePos = Array.isArray(base.position) ? base.position : [0, 0, 0];
    const off = Array.isArray(mate.offset) ? mate.offset : [0, 0, 0];
    const expected = [basePos[0] + off[0], basePos[1] + off[1], basePos[2] + off[2]];
    const cur = Array.isArray(part.position) ? part.position : [0, 0, 0];
    const dx = cur[0] - expected[0];
    const dy = cur[1] - expected[1];
    const dz = cur[2] - expected[2];
    const deviation = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (deviation > maxDeviationMm) maxDeviationMm = deviation;
    if (deviation > cfg.hardTolMm) {
      violations.push({
        partId: mate.partId,
        baseId: mate.baseId,
        deviationMm: deviation,
      });
    }
  });

  return {
    iterations,
    hardToleranceMm: cfg.hardTolMm,
    convergenceToleranceMm: cfg.convergeTolMm,
    cycleCount: order.cycleCount,
    unresolvedMateIds: order.unresolvedMateIds,
    unknownReferences: unknownRefs,
    conflicts,
    violations,
    maxDeviationMm,
  };
}

function _resolveAssemblyConstraints(plan) {
  if (!plan || !Array.isArray(plan.parts)) return plan;
  let mates = Array.isArray(plan.mates) ? plan.mates.slice() : [];
  if (_isEngineAssembly(plan)) {
    mates = _buildInline4MateGraph(plan.parts, plan.engine_spec || {});
  }
  if (mates.length) {
    const report = _solveMateConstraints(plan, mates, { maxPasses: 10, hardTolMm: 0.75, convergeTolMm: 0.03 });
    plan.constraint_solver = report;
    plan.mates = mates;
  } else {
    plan.constraint_solver = {
      iterations: 0,
      hardToleranceMm: 0.75,
      convergenceToleranceMm: 0.03,
      cycleCount: 0,
      unresolvedMateIds: [],
      unknownReferences: [],
      conflicts: [],
      violations: [],
      maxDeviationMm: 0,
    };
  }
  return plan;
}

function _runAssemblyEngineeringAudit(plan) {
  const parts = Array.isArray(plan && plan.parts) ? plan.parts : [];
  const issues = [];
  const geometryWarnings = [];
  const dimensionalChecks = [];
  const byName = (pattern) => parts.find((part) => pattern.test(String(part && part.name || '')));
  const byNameAll = (pattern) => parts.filter((part) => pattern.test(String(part && part.name || '')));
  const pos = (part) => Array.isArray(part && part.position) ? part.position : [0, 0, 0];
  const dist = (a, b) => {
    const pa = pos(a);
    const pb = pos(b);
    const dx = pa[0] - pb[0];
    const dy = pa[1] - pb[1];
    const dz = pa[2] - pb[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  const block = byName(/Cylinder Block/);
  const head = byName(/Cylinder Head/);
  const crank = byName(/Crankshaft/);
  const cams = byNameAll(/Camshaft/);
  const injectors = byNameAll(/Fuel Injector/);
  const intake = byName(/Intake Manifold/);
  const starter = byName(/Starter Motor/);
  const flywheel = byName(/Flywheel/);
  const checkRange = (label, actual, lo, hi) => {
    const deviation = actual < lo ? (lo - actual) : actual > hi ? (actual - hi) : 0;
    dimensionalChecks.push({ label, actualMm: actual, expectedMinMm: lo, expectedMaxMm: hi, toleranceMm: 0, deviationMm: deviation });
    return deviation;
  };

  if (block && head) {
    const dy = pos(head)[1] - pos(block)[1];
    const dev = checkRange('Head-to-block deck offset', dy, 120, 320);
    if (dev > 0) issues.push('Head-to-block deck offset is outside expected range (' + dy.toFixed(1) + ' mm).');
  }
  if (block && crank) {
    const dy = Math.abs(pos(crank)[1] - pos(block)[1]);
    dimensionalChecks.push({ label: 'Crank centerline offset', actualMm: dy, expectedMinMm: 0, expectedMaxMm: 100, toleranceMm: 0, deviationMm: Math.max(0, dy - 100) });
    if (dy > 100) issues.push('Crank centerline appears offset from block datum (' + dy.toFixed(1) + ' mm).');
  }
  if (cams.length >= 2) {
    const dz = Math.abs(pos(cams[0])[2] - pos(cams[1])[2]);
    const dev = checkRange('Camshaft bank spacing', dz, 35, 120);
    if (dz < 35 || dz > 120) issues.push('Camshaft bank spacing seems unrealistic (' + dz.toFixed(1) + ' mm).');
  }
  if (intake && injectors.length) {
    const far = injectors.filter((inj) => dist(inj, intake) > 300).length;
    if (far) issues.push(far + ' injector(s) are too far from intake manifold runners.');
  }
  if (starter && flywheel) {
    const meshDist = dist(starter, flywheel);
    const dev = checkRange('Starter-flywheel packaging', meshDist, 40, 180);
    if (meshDist < 40 || meshDist > 180) issues.push('Starter-to-flywheel mesh distance is outside expected packaging (' + meshDist.toFixed(1) + ' mm).');
  }

  const genericEnginePartTypes = new Set(['housing', 'cylinder', 'washer', 'circlip', 'bearing', 'piston', 'custom']);
  const genericEngineParts = parts.filter((part) => {
    const name = String(part && part.name || '');
    const type = String(part && part.type || '').toLowerCase();
    return /(Cylinder Block|Cylinder Head|Camshaft|Fuel Injector|Starter Motor|Pressure Plate|Rod Bearing|Valve Collet|Lash Adjuster)/i.test(name)
      && genericEnginePartTypes.has(type);
  });
  if (genericEngineParts.length) {
    const msg = genericEngineParts.length + ' engine-critical part(s) still use generic geometry types.';
    issues.push(msg);
    geometryWarnings.push(msg);
  }

  const missingMaterials = parts.filter((part) => !String(part && part.material || '').trim()).length;
  if (missingMaterials) {
    const msg = missingMaterials + ' part(s) have missing material assignments.';
    issues.push(msg);
    geometryWarnings.push(msg);
  }

  const solver = plan && plan.constraint_solver ? plan.constraint_solver : null;
  const mateViolationCount = solver ? ((solver.violations || []).length + (solver.conflicts || []).length + (solver.cycleCount || 0)) : 0;
  if (mateViolationCount) {
    const msg = 'Constraint solver reported ' + mateViolationCount + ' mate violation(s)/conflict(s).';
    issues.push(msg);
  }

  const maxDimensionalDeviationMm = dimensionalChecks.reduce((mx, row) => Math.max(mx, Number(row.deviationMm || 0)), 0);

  const score = Math.max(0, Math.min(100, 100 - issues.length * 9));
  const result = {
    score,
    issueCount: issues.length,
    issues,
    checkedParts: parts.length,
    maxDimensionalDeviationMm,
    dimensionalChecks,
    mateViolations: solver ? (solver.violations || []) : [],
    geometryWarnings,
  };
  plan.engineering_audit = result;
  return result;
}

function _estimateCombustionState(spec, bench, state, dt) {
  const throttle = Math.max(0, Math.min(1, bench.throttlePct / 100));
  const currentRpm = Math.max(700, state.currentRpm || bench.rpmTarget || 900);
  const rpmNorm = Math.max(0, Math.min(1.15, currentRpm / spec.redlineRpm));
  const atmKpa = 101.325;
  const coolantTempC = state.coolantTempC == null ? 24 : state.coolantTempC;
  const oilTempC = state.oilTempC == null ? 28 : state.oilTempC;
  const intakeTempC = Math.max(20, 24 + throttle * 9 + Math.max(0, coolantTempC - 90) * 0.08);
  const rpmBlend = Math.max(0, Math.min(1, (currentRpm - 1200) / Math.max(1200, spec.redlineRpm - 1200)));
  const camIntakeAdvanceDeg = (spec.intakeCamAdvanceDeg != null)
    ? Number(spec.intakeCamAdvanceDeg)
    : Math.max(-spec.vvtAuthorityDeg, Math.min(spec.vvtAuthorityDeg, 14 - rpmBlend * 18 + throttle * 6));
  const camExhaustRetardDeg = (spec.exhaustCamRetardDeg != null)
    ? Number(spec.exhaustCamRetardDeg)
    : Math.max(-spec.vvtAuthorityDeg, Math.min(spec.vvtAuthorityDeg, 4 + rpmBlend * 14 - throttle * 4));
  const camOverlapDeg = Math.max(0, camIntakeAdvanceDeg + camExhaustRetardDeg - 2);
  const manifoldPressureKpa = Math.max(24, Math.min(atmKpa, 26 + throttle * 75 - Math.max(0, bench.loadNm - 40) * 0.035));
  const ve = Math.max(0.48, Math.min(1.04,
    0.58 + throttle * 0.16
    + Math.sin(Math.PI * Math.max(0, Math.min(1, currentRpm / spec.peakTorqueRpm))) * 0.18
    + camIntakeAdvanceDeg * 0.0022
    - camOverlapDeg * 0.0014
    - Math.max(0, coolantTempC - 102) * 0.0018
  ));
  const airDensity = 1.225 * (manifoldPressureKpa / atmKpa) * (293.15 / (273.15 + intakeTempC));
  const displacementM3 = spec.displacementCc / 1e6;
  const airflowM3s = displacementM3 * (currentRpm / 120) * ve;
  const airMassFlowKgs = airflowM3s * airDensity;
  const lambda = throttle > 0.82 ? 0.88 : throttle > 0.55 ? 0.94 : 1.0;
  const afr = spec.stoichAfr * lambda;
  const fuelMassFlowKgs = airMassFlowKgs / Math.max(10.5, afr);
  const baseSparkDeg = 12 + (1 - throttle) * 8 + rpmNorm * 16;
  let sparkAdvanceDeg = Math.max(4, Math.min(34, baseSparkDeg - Math.max(0, coolantTempC - 96) * 0.18));
  const mbtDeg = Math.max(10, Math.min(32, 16 + rpmNorm * 14 - throttle * 4));
  const knockIndex = (manifoldPressureKpa / atmKpa)
    * (spec.compressionRatio / 10.5)
    * (1 + Math.max(0, sparkAdvanceDeg - mbtDeg) * 0.055)
    * (1 + Math.max(0, intakeTempC - 45) * 0.0085);
  const knockMargin = 1.02 - knockIndex;
  if (knockMargin < 0) {
    sparkAdvanceDeg = Math.max(3, sparkAdvanceDeg + knockMargin * 10.5);
  }
  const knockFactor = knockMargin >= 0 ? 1 : Math.max(0.65, 1 + knockMargin * 0.7);
  const sparkEfficiency = Math.max(0.74, 1 - Math.abs(sparkAdvanceDeg - mbtDeg) / 30);
  const thermalEfficiency = Math.max(0.18, Math.min(0.37,
    0.21 + ve * 0.11 + sparkEfficiency * 0.06 - Math.max(0, coolantTempC - 105) * 0.0015
  ));
  const fuelPowerKw = fuelMassFlowKgs * spec.fuelLhvJPerKg / 1000;
  const omega = Math.max(80, currentRpm * Math.PI * 2 / 60);
  const grossTorqueNm = (fuelPowerKw * thermalEfficiency * 1000) / omega;
  const frictionTorqueNm = 16 + currentRpm * 0.011 + Math.max(0, oilTempC - 95) * 0.05;
  const rawBrakeTorqueNm = Math.max(0, grossTorqueNm - frictionTorqueNm);
  const tqCurve = spec.targetPeakTorqueNm * Math.exp(-Math.pow((currentRpm - spec.peakTorqueRpm) / Math.max(600, spec.torqueCurveWidthRpm), 2) * 0.5);
  const pwrCurveKw = spec.targetPeakPowerKw * Math.exp(-Math.pow((currentRpm - spec.peakPowerRpm) / Math.max(500, spec.powerCurveWidthRpm), 2) * 0.5);
  const torqueFromPowerNm = (pwrCurveKw * 9549) / Math.max(700, currentRpm);
  const shapedTargetNm = Math.max(tqCurve * (0.45 + throttle * 0.55), torqueFromPowerNm * (0.35 + throttle * 0.65));
  const calibrationGain = Math.max(0.65, Math.min(1.45, shapedTargetNm / Math.max(45, rawBrakeTorqueNm)));
  const brakeTorqueNm = Math.max(0, rawBrakeTorqueNm * calibrationGain * knockFactor);
  const netTorqueNm = brakeTorqueNm - bench.loadNm;
  const rpmAccel = (netTorqueNm / spec.rotationalInertia) * (60 / (Math.PI * 2));
  const nextRpm = Math.max(700, Math.min(spec.redlineRpm, currentRpm + rpmAccel * dt));
  const heatRejectKw = Math.max(0, fuelPowerKw * (1 - thermalEfficiency) * 0.58);
  const nextCoolant = coolantTempC + ((heatRejectKw * 0.022) - (coolantTempC - 88) * 0.028) * dt * 10;
  const nextOil = oilTempC + ((heatRejectKw * 0.011) - (oilTempC - 96) * 0.018) * dt * 10;
  const oilPressureBar = Math.max(0.7, Math.min(6.9, 0.85 + nextRpm / 1500 - Math.max(0, nextOil - 112) * 0.02));
  return {
    rpm: nextRpm,
    ve,
    lambda,
    knockIndex,
    knockMarginDeg: (mbtDeg - sparkAdvanceDeg),
    camIntakeAdvanceDeg,
    camExhaustRetardDeg,
    sparkAdvanceDeg,
    manifoldPressureKpa,
    airflowGPerS: airMassFlowKgs * 1000,
    fuelFlowGPerS: fuelMassFlowKgs * 1000,
    torqueNm: brakeTorqueNm,
    powerKw: brakeTorqueNm * (nextRpm * Math.PI * 2 / 60) / 1000,
    oilPressureBar,
    coolantTempC: nextCoolant,
    oilTempC: nextOil,
    intakeTempC,
  };
}

function _startEngineCycle(scene, plan, ui) {
  if (!scene || !scene.partMeshes || !_isEngineAssembly(plan)) return false;
  _stopEngineCycle(true);

  const engineSpec = Object.assign(
    _createInline4EngineSpec(),
    plan && plan.engine_spec ? plan.engine_spec : {},
  );

  const parts = Array.isArray(plan.parts) ? plan.parts : [];
  const partById = new Map(parts.map((part) => [part.id, part]));
  const entries = Object.entries(scene.partMeshes).map(([id, mesh]) => ({
    id,
    mesh,
    part: partById.get(id) || mesh.userData?.partDef || null,
    base: _captureEngineTransform(mesh),
  }));

  const pistons = entries.filter((entry) => /piston$/.test(String(entry.part?.type || '')) && !/ring|pin/.test(String(entry.part?.type || '')))
    .sort((a, b) => (a.part?.position?.[0] || 0) - (b.part?.position?.[0] || 0));
  const rods = entries.filter((entry) => String(entry.part?.type || '') === 'con_rod')
    .sort((a, b) => (a.part?.position?.[0] || 0) - (b.part?.position?.[0] || 0));
  const crankMeshes = entries.filter((entry) => ['crankshaft', 'flywheel', 'pulley', 'sprocket'].includes(String(entry.part?.type || '')));
  const camMeshes = entries.filter((entry) => {
    const type = String(entry.part?.type || '').toLowerCase();
    return type === 'camshaft' || /camshaft/.test(String(entry.part?.name || '').toLowerCase());
  });
  const valveMeshes = entries.filter((entry) => /valve_(intake|exhaust)/.test(String(entry.part?.type || '')))
    .sort((a, b) => (a.part?.position?.[0] || 0) - (b.part?.position?.[0] || 0) || (a.part?.position?.[2] || 0) - (b.part?.position?.[2] || 0));

  if (!pistons.length || !crankMeshes.length) return false;

  const strokeMm = Number(pistons[0].part?.dims?.stroke || plan.recipe?.parameters?.stroke_mm || engineSpec.strokeMm);
  const crankRadius = Math.max(4, strokeMm * 0.5) * 0.1;
  const rodLength = Math.max(crankRadius * 1.8, (Number(rods[0]?.part?.dims?.ctc || engineSpec.rodLengthMm)) * 0.1);
  const valveLift = 9.5 * 0.1;
  const firingOrder = [0, Math.PI, Math.PI, 0];

  const state = {
    entries,
    rafId: null,
    startTs: null,
    lastTs: null,
    crankAngle: 0,
    currentRpm: Math.max(850, _engineBenchSnapshot().rpmTarget),
    coolantTempC: 24,
    oilTempC: 28,
  };
  _engineCycleState = state;

  function sliderCrankDisplacement(theta) {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const rodTerm = Math.sqrt(Math.max(0, rodLength * rodLength - (crankRadius * sinTheta) * (crankRadius * sinTheta)));
    return crankRadius * cosTheta + rodTerm - rodLength;
  }

  function frame(ts) {
    if (!_engineCycleState || _engineCycleState !== state) return;
    if (state.startTs == null) state.startTs = ts;
    if (state.lastTs == null) state.lastTs = ts;
    const dt = Math.max(0.001, Math.min(0.05, (ts - state.lastTs) / 1000));
    state.lastTs = ts;
    const elapsed = (ts - state.startTs) / 1000;
    const bench = _engineBenchSnapshot();
    const metrics = _estimateCombustionState(engineSpec, bench, state, dt);
    state.currentRpm = metrics.rpm;
    state.coolantTempC = metrics.coolantTempC;
    state.oilTempC = metrics.oilTempC;
    state.crankAngle += state.currentRpm * Math.PI * 2 / 60 * dt;
    const crankAngle = state.crankAngle;

    crankMeshes.forEach((entry) => {
      entry.mesh.rotation.x = entry.base.rotation.x + crankAngle;
    });
    camMeshes.forEach((entry) => {
      entry.mesh.rotation.x = entry.base.rotation.x + crankAngle * 0.5;
    });

    pistons.forEach((entry, index) => {
      const phase = firingOrder[index % firingOrder.length];
      const displacement = sliderCrankDisplacement(crankAngle + phase);
      entry.mesh.position.y = entry.base.position.y + displacement;
    });

    rods.forEach((entry, index) => {
      const phase = firingOrder[index % firingOrder.length];
      const theta = crankAngle + phase;
      const pistonOffset = sliderCrankDisplacement(theta);
      const rodAngle = Math.asin(Math.max(-1, Math.min(1, (crankRadius * Math.sin(theta)) / rodLength)));
      entry.mesh.position.y = entry.base.position.y + pistonOffset * 0.52;
      entry.mesh.rotation.z = entry.base.rotation.z + rodAngle;
    });

    valveMeshes.forEach((entry, index) => {
      const cylinderIndex = Math.floor(index / 4);
      const valveIndex = index % 4;
      const phase = firingOrder[cylinderIndex % firingOrder.length] + (String(entry.part?.type || '').includes('exhaust') ? Math.PI * 0.55 : 0);
      const openProfile = Math.max(0, Math.sin(crankAngle * 0.5 + phase + valveIndex * 0.12));
      entry.mesh.position.y = entry.base.position.y - openProfile * valveLift;
    });

    if (ui && ui.onStep) {
      ui.onStep(elapsed, {
        rpm: metrics.rpm,
        throttlePct: bench.throttlePct,
        loadNm: bench.loadNm,
        torqueNm: metrics.torqueNm,
        powerKw: metrics.powerKw,
        oilPressureBar: metrics.oilPressureBar,
        coolantTempC: metrics.coolantTempC,
        ve: metrics.ve,
        lambda: metrics.lambda,
        knockIndex: metrics.knockIndex,
        knockMarginDeg: metrics.knockMarginDeg,
        camIntakeAdvanceDeg: metrics.camIntakeAdvanceDeg,
        camExhaustRetardDeg: metrics.camExhaustRetardDeg,
        sparkAdvanceDeg: metrics.sparkAdvanceDeg,
        manifoldPressureKpa: metrics.manifoldPressureKpa,
      });
    }
    state.rafId = requestAnimationFrame(frame);
  }

  state.rafId = requestAnimationFrame(frame);
  return true;
}

function _setNestedValue(target, path, value) {
  if (!target || !path) return;
  const keys = Array.isArray(path) ? path : String(path).split('.');
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function _renderSpecSection(title, rows) {
  const validRows = rows.filter((row) => row[1] !== null && row[1] !== undefined && row[1] !== '');
  return '<section class="derived-spec-section">'
    + '<div class="derived-spec-section-title">' + esc(title) + '</div>'
    + (validRows.length
      ? validRows.map((row) => '<div class="derived-spec-row"><span class="derived-spec-label">' + esc(row[0]) + '</span><span class="derived-spec-value">' + esc(String(row[1])) + '</span></div>').join('')
      : '<div class="derived-spec-empty">No inferred ' + esc(title.toLowerCase()) + '.</div>')
    + '</section>';
}

function _renderSpecInput(label, options) {
  const value = options && options.value != null ? options.value : '';
  const type = options && options.type ? options.type : 'text';
  const step = options && options.step != null ? ' step="' + esc(options.step) + '"' : '';
  const min = options && options.min != null ? ' min="' + esc(options.min) + '"' : '';
  const placeholder = options && options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '';
  const unit = options && options.unit ? '<span class="derived-spec-unit">' + esc(options.unit) + '</span>' : '';
  const path = options && options.path ? ' data-spec-path="' + esc(options.path) + '"' : '';
  const valueAttr = type === 'number' ? ' value="' + esc(String(value)) + '"' : ' value="' + esc(String(value || '')) + '"';
  return '<label class="derived-spec-input-row">'
    + '<span class="derived-spec-label">' + esc(label) + '</span>'
    + '<span class="derived-spec-field">'
    + '<input class="derived-spec-input" type="' + esc(type) + '"' + path + valueAttr + step + min + placeholder + '>'
    + unit
    + '</span>'
    + '</label>';
}

function _renderEditableSpecSection(title, fields) {
  const validFields = fields.filter((field) => field && field.path);
  return '<section class="derived-spec-section">'
    + '<div class="derived-spec-section-title">' + esc(title) + '</div>'
    + (validFields.length
      ? validFields.map((field) => _renderSpecInput(field.label, field)).join('')
      : '<div class="derived-spec-empty">No editable ' + esc(title.toLowerCase()) + '.</div>')
    + '</section>';
}

function _coerceSpecInputValue(input) {
  if (!input) return null;
  if (input.type === 'number') {
    if (input.value === '') return null;
    const num = Number(input.value);
    return Number.isFinite(num) ? num : null;
  }
  const text = String(input.value || '').trim();
  return text || null;
}

function _syncDerivedSpecSummary() {
  if (!$derivedSpecSummary || !_pendingDerivedCadSpec) return;
  const spec = _pendingDerivedCadSpec;
  const params = spec.normalized_parameters || {};
  const holePatterns = Array.isArray(spec.hole_patterns) ? spec.hole_patterns : [];
  const chips = [
    spec.material_name ? 'material: ' + spec.material_name : null,
    spec.process ? 'process: ' + spec.process : null,
    params.fit_designation ? 'fit: ' + params.fit_designation : null,
    params.tolerance_general_mm != null ? 'tol: ±' + params.tolerance_general_mm + ' mm' : null,
    holePatterns[0]?.hole_count ? 'holes: ' + holePatterns[0].hole_count + 'x' : (holePatterns[0]?.pattern ? 'holes: ' + holePatterns[0].pattern : null),
  ].filter(Boolean);
  $derivedSpecSummary.innerHTML = chips.map((chip) => '<span class="derived-spec-chip">' + esc(chip) + '</span>').join('');
}

function _applyDerivedSpecEdit(path, value) {
  if (!_pendingDerivedCadSpec) return;
  const spec = _pendingDerivedCadSpec;
  spec.dimensions = spec.dimensions || {};
  spec.fits = Array.isArray(spec.fits) ? spec.fits : [];
  spec.tolerances = Array.isArray(spec.tolerances) ? spec.tolerances : [];
  spec.hole_patterns = Array.isArray(spec.hole_patterns) ? spec.hole_patterns : [];
  spec.normalized_parameters = spec.normalized_parameters || {};

  const holePattern = spec.hole_patterns[0] || (spec.hole_patterns[0] = { pattern: 'bolt_circle', source: 'panel_edit' });
  const fit = spec.fits[0] || (spec.fits[0] = { designation: null, type: null, source: 'panel_edit' });
  const tolerance = spec.tolerances[0] || (spec.tolerances[0] = { kind: 'plus_minus', value: null, unit: 'mm', value_mm: null, source: 'panel_edit' });

  switch (path) {
    case 'dimensions.length_mm':
      spec.dimensions.length_mm = value;
      spec.normalized_parameters.bracket_length_mm = value;
      break;
    case 'dimensions.width_mm':
      spec.dimensions.width_mm = value;
      spec.normalized_parameters.bracket_width_mm = value;
      break;
    case 'dimensions.height_mm':
      spec.dimensions.height_mm = value;
      spec.normalized_parameters.bracket_height_mm = value;
      break;
    case 'dimensions.wall_thickness_mm':
      spec.dimensions.wall_thickness_mm = value;
      spec.normalized_parameters.wall_thickness_mm = value;
      break;
    case 'dimensions.hole_diameter_mm':
      spec.dimensions.hole_diameter_mm = value;
      spec.normalized_parameters.bolt_hole_diameter_mm = value;
      holePattern.hole_diameter_mm = value;
      break;
    case 'metadata.material_name':
      spec.material_name = value;
      spec.normalized_parameters.material_name = value;
      break;
    case 'metadata.process':
      spec.process = value;
      spec.normalized_parameters.process = value;
      break;
    case 'fits.0.designation':
      fit.designation = value;
      spec.normalized_parameters.fit_designation = value;
      break;
    case 'tolerances.0.value_mm':
      tolerance.value = value;
      tolerance.value_mm = value;
      tolerance.unit = 'mm';
      spec.normalized_parameters.tolerance_general_mm = value;
      break;
    case 'hole_patterns.0.hole_count':
      holePattern.hole_count = value;
      spec.normalized_parameters.hole_count = value;
      break;
    case 'hole_patterns.0.thread_spec':
      holePattern.thread_spec = value;
      break;
    case 'hole_patterns.0.bolt_circle_mm':
      holePattern.bolt_circle_mm = value;
      spec.dimensions.bolt_circle_mm = value;
      spec.normalized_parameters.bolt_circle_diameter_mm = value;
      break;
    case 'hole_patterns.0.spacing_mm':
      holePattern.spacing_mm = value;
      spec.dimensions.hole_spacing_mm = value;
      spec.normalized_parameters.hole_spacing_mm = value;
      break;
    default:
      _setNestedValue(spec, path, value);
      break;
  }

  if (_pendingCadPlan) {
    _pendingCadPlan.recipe = _pendingCadPlan.recipe || {};
    _pendingCadPlan.recipe.parameters = Object.assign({}, _pendingCadPlan.recipe.parameters || {}, spec.normalized_parameters || {});
    _pendingCadPlan.derived_cad_spec = JSON.parse(JSON.stringify(spec));
  }

  _syncDerivedSpecSummary();
}

function _bindDerivedSpecInputs() {
  if (!$derivedSpecGrid) return;
  $derivedSpecGrid.querySelectorAll('[data-spec-path]').forEach((input) => {
    input.addEventListener('input', () => {
      const path = input.getAttribute('data-spec-path');
      _applyDerivedSpecEdit(path, _coerceSpecInputValue(input));
    });
  });
}

function _renderDerivedSpecPanel(spec, plan) {
  if (!$derivedSpecPanel || !spec) return;
  _pendingCadPlan = plan ? JSON.parse(JSON.stringify(plan)) : null;
  _pendingDerivedCadSpec = JSON.parse(JSON.stringify(spec));

  const dims = _pendingDerivedCadSpec.dimensions || {};
  const fits = Array.isArray(_pendingDerivedCadSpec.fits) ? _pendingDerivedCadSpec.fits : [];
  const tolerances = Array.isArray(_pendingDerivedCadSpec.tolerances) ? _pendingDerivedCadSpec.tolerances : [];
  const holePatterns = Array.isArray(_pendingDerivedCadSpec.hole_patterns) ? _pendingDerivedCadSpec.hole_patterns : [];
  const params = _pendingDerivedCadSpec.normalized_parameters || {};

  if ($derivedSpecStatus) {
    $derivedSpecStatus.textContent = _pendingCadPlan
      ? 'Review these inferred values before execution'
      : 'Inspection only';
  }
  _syncDerivedSpecSummary();
  if ($derivedSpecGrid) {
    $derivedSpecGrid.innerHTML = [
      _renderEditableSpecSection('Dimensions', [
        { label: 'Length', path: 'dimensions.length_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: dims.length_mm },
        { label: 'Width', path: 'dimensions.width_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: dims.width_mm },
        { label: 'Height', path: 'dimensions.height_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: dims.height_mm },
        { label: 'Wall', path: 'dimensions.wall_thickness_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: dims.wall_thickness_mm },
        { label: 'Hole Ø', path: 'dimensions.hole_diameter_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: dims.hole_diameter_mm },
      ]),
      _renderEditableSpecSection('Manufacturing', [
        { label: 'Material', path: 'metadata.material_name', type: 'text', value: _pendingDerivedCadSpec.material_name, placeholder: 'cast_iron' },
        { label: 'Process', path: 'metadata.process', type: 'text', value: _pendingDerivedCadSpec.process, placeholder: 'casting' },
        { label: 'Fit', path: 'fits.0.designation', type: 'text', value: fits[0]?.designation || params.fit_designation || '', placeholder: 'H7/g6' },
        { label: 'Tolerance', path: 'tolerances.0.value_mm', type: 'number', step: '0.001', min: '0', unit: 'mm', value: tolerances[0]?.value_mm != null ? tolerances[0].value_mm : params.tolerance_general_mm },
      ]),
      _renderEditableSpecSection('Hole Pattern', [
        { label: 'Hole Count', path: 'hole_patterns.0.hole_count', type: 'number', step: '1', min: '1', value: holePatterns[0]?.hole_count },
        { label: 'Thread Spec', path: 'hole_patterns.0.thread_spec', type: 'text', value: holePatterns[0]?.thread_spec || '', placeholder: 'M8' },
        { label: 'Bolt Circle', path: 'hole_patterns.0.bolt_circle_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: holePatterns[0]?.bolt_circle_mm != null ? holePatterns[0].bolt_circle_mm : dims.bolt_circle_mm },
        { label: 'Spacing', path: 'hole_patterns.0.spacing_mm', type: 'number', step: '0.1', min: '0', unit: 'mm', value: holePatterns[0]?.spacing_mm != null ? holePatterns[0].spacing_mm : dims.hole_spacing_mm },
      ]),
      _renderSpecSection('Review Notes', [
        ['Status', _pendingCadPlan ? 'Edits here will be applied to the reviewed CAD execution plan.' : 'Inspection only'],
        ['Source', _pendingDerivedCadSpec.source || 'prompt_inference'],
      ]),
    ].join('');
    _bindDerivedSpecInputs();
  }
  if ($derivedSpecExecute) {
    $derivedSpecExecute.disabled = !_pendingCadPlan;
    $derivedSpecExecute.textContent = 'Generate CAD';
  }
  $derivedSpecPanel.classList.remove('hidden');
}

async function _executePendingCadPlan() {
  if (_isBusy || !_pendingCadPlan) return;
  const executeLabel = $derivedSpecExecute ? $derivedSpecExecute.textContent : 'Generate CAD';
  try {
    _setBusy(true);
    _setEnkiStatus('Submitting reviewed CAD spec…');
    _setEnkiLive(true, 'Submitting reviewed CAD spec…');
    if ($derivedSpecExecute) {
      $derivedSpecExecute.disabled = true;
      $derivedSpecExecute.textContent = 'Submitting…';
    }

    const response = await fetch('/cad/execute', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _opts.headers),
      body: JSON.stringify({ plan: _pendingCadPlan }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || ('CAD execute failed with HTTP ' + response.status));

    const manifest = data.manifest || {};
    if ($derivedSpecStatus) $derivedSpecStatus.textContent = manifest.execution_id ? 'Execution ' + manifest.execution_id : 'Execution submitted';
    if ($derivedSpecExecute) $derivedSpecExecute.textContent = 'CAD Submitted';
    _addMsg('assistant', '🔩 <strong>Derived CAD spec approved.</strong> Started execution <code>' + esc(manifest.execution_id || 'pending') + '</code> from the reviewed spec.');

    if (manifest.execution_id) {
      await _loadKernelSTLWhenReady(manifest.execution_id, _pendingCadPlan.name || manifest.recipe?.name || 'Assembly');
    }
  } catch (error) {
    if ($derivedSpecStatus) $derivedSpecStatus.textContent = 'Execution failed — review and retry';
    if ($derivedSpecExecute) {
      $derivedSpecExecute.disabled = false;
      $derivedSpecExecute.textContent = executeLabel;
    }
    _addMsg('assistant', 'CAD execution failed: ' + esc(error.message));
  } finally {
    _setBusy(false);
    _setEnkiStatus('Engineering AI · Ready');
    _setEnkiLive(false);
  }
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
    const CAD = global.UARE_CAD;
    const scene = CAD && CAD.getLastScene && CAD.getLastScene();
    if (!scene) { _addMsg('assistant', 'No assembly loaded. Design something first!'); return; }

    if (_isEngineAssembly(_assembly)) {
      _updateEngineBenchLabels();
      const started = _startEngineCycle(scene, _assembly, {
        onStep: (t, metrics) => {
          if ($mTime) $mTime.textContent = t.toFixed(1) + ' s';
          if ($mFPS) $mFPS.textContent = 'live';
          if ($mStr) $mStr.textContent = metrics.powerKw.toFixed(1) + ' kW';
          if ($mSafe) $mSafe.textContent = metrics.torqueNm.toFixed(0) + ' N·m';
          _updateEngineBenchTelemetry(metrics);
          if ($simResult) {
            $simResult.textContent = 'Dyno mode: ' + metrics.rpm.toFixed(0)
              + ' rpm, VE ' + (metrics.ve * 100).toFixed(0)
              + '%, spark ' + metrics.sparkAdvanceDeg.toFixed(1)
              + '° (knock margin ' + metrics.knockMarginDeg.toFixed(1)
              + '°), cam I+' + metrics.camIntakeAdvanceDeg.toFixed(1)
              + '/E+' + metrics.camExhaustRetardDeg.toFixed(1)
              + '°, MAP ' + metrics.manifoldPressureKpa.toFixed(0)
              + ' kPa, ' + metrics.loadNm.toFixed(0) + ' N·m brake load.';
          }
        },
      });
      if (!started) {
        _addMsg('assistant', 'Engine runtime animation could not be started for this assembly.');
        return;
      }
      setSimStatus('running');
      if ($run) $run.disabled = true;
      if ($pause) $pause.disabled = false;
      if ($reset) $reset.disabled = false;
      _setEnkiLive(true, 'Engine dyno running…');
      _addMsg('assistant', '<strong>Engine dyno mode running.</strong> Adjust throttle, brake load, and RPM target from the test bench strip while the viewport animates the crankshaft, pistons, rods, cams, and valves.');
      return;
    }

    if (!global.UARE_SIM) { _addMsg('assistant', 'Physics engine not loaded yet.'); return; }
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
    _stopEngineCycle(false);
    if (_isEngineAssembly(_assembly) && $simResult) $simResult.textContent = 'Dyno paused. Adjust throttle, load, or RPM target, then run again.';
    if (global.UARE_SIM) global.UARE_SIM.pause();
    setSimStatus('idle');
    _setEnkiLive(false);
    if ($run) $run.disabled = false;
    if ($pause) $pause.disabled = true;
  });
  if ($reset) $reset.addEventListener('click', () => {
    _stopEngineCycle(true);
    if (global.UARE_SIM) global.UARE_SIM.reset();
    setSimStatus('idle');
    if ($mTime) $mTime.textContent = '0.0 s';
    if ($mFPS) $mFPS.textContent = '–';
    if ($mStr) $mStr.textContent = '– MPa';
    if ($mSafe) $mSafe.textContent = '–';
    _updateEngineBenchTelemetry(null);
    _updateEngineBenchLabels();
    if (_isEngineAssembly(_assembly) && $simResult) $simResult.textContent = 'Dyno reset. Set throttle, brake load, and RPM target to run the engine again.';
    if ($run) $run.disabled = false;
    if ($pause) $pause.disabled = true;
    _setEnkiLive(false);
  });
  if ($fea) $fea.addEventListener('click', async () => {
    if (!_assembly) { _addMsg('assistant', 'Load an assembly first.'); return; }
    if (!global.UARE_CAD) { _addMsg('assistant', 'CAD engine not loaded.'); return; }
    _setEnkiLive(true, 'Running FEA — beam theory model…');
    await sleep(80);
    const sc = global.UARE_CAD.getLastScene && global.UARE_CAD.getLastScene();
    if (!sc) { _setEnkiLive(false); _addMsg('assistant', 'No geometry to analyse. Build an assembly first.'); return; }

    const parts = ((_assembly && _assembly.parts) || []).map((p, i) => _normalizePart(p, i));
    const feaLoadN = 5000;
    let maxStressVal = 0;
    let minSafetyFactor = 99;
    let hotspotCount = 0;

    const fea = global.UARE_SIM && global.UARE_SIM.runFEA
      ? global.UARE_SIM.runFEA({ parts: parts }, feaLoadN)
      : null;

    const stressById = {};
    if (fea && Array.isArray(fea.partResults)) {
      fea.partResults.forEach(r => {
        if (r && r.id) stressById[r.id] = r;
      });
      maxStressVal = Number(fea.maxStress || 0);
      minSafetyFactor = Number(fea.minSafety || 99);
    }

    if (sc.partMeshes) {
      const vals = [];
      Object.keys(sc.partMeshes).forEach(id => {
        const r = stressById[id];
        vals.push(r ? Number(r.stressMPa || 0) : 0);
      });
      const rawMax = Math.max(1e-9, ...vals);
      const rawMin = Math.min(0, ...vals);

      Object.entries(sc.partMeshes).forEach(([id, mesh]) => {
        const part = parts.find(p => p.id === id) || {};
        const dims = _canonicalDims(part);
        const r = stressById[id] || { stressMPa: 0, safetyFactor: 99, loadN: 0 };
        const sigma = Number(r.stressMPa || 0);
        const normalizedStress = Math.min(1, Math.max(0, (sigma - rawMin) / (rawMax - rawMin || 1)));
        if (mesh && mesh.userData) mesh.userData.stressValue = normalizedStress;
        if (normalizedStress > 0.70) hotspotCount++;

        _cacheFeaResult(id, {
          sigma_mpa: sigma,
          safety_factor: Number(r.safetyFactor || 99),
          normalized: normalizedStress,
          F_applied_N: Number(r.loadN || 0),
          section_type: (dims.d || dims.diameter || dims.outerD) ? 'Circular D' + (dims.d || dims.diameter || dims.outerD) + 'mm' : dims.w ? 'Rect ' + dims.w + 'x' + (dims.h || dims.w) + 'mm' : null,
          von_mises_mpa: sigma,
        });
      });
    }

    // Apply stress render mode
    if (global.UARE_CAD.setRenderMode) global.UARE_CAD.setRenderMode('stress');
    _setEnkiLive(false);
    if ($mStr) $mStr.textContent = maxStressVal.toFixed(1) + ' MPa';
    if ($mSafe) $mSafe.textContent = minSafetyFactor.toFixed(2) + 'x';
    _addMsg('assistant',
      '<strong>FEA Analysis Complete</strong> — section-property stress model, ' + feaLoadN.toFixed(0) + ' N assembly load<br>' +
      'Max von Mises stress: <code>' + maxStressVal.toFixed(1) + ' MPa</code><br>' +
      'Minimum safety factor: <code>' + minSafetyFactor.toFixed(2) + 'x</code> ' +
        (minSafetyFactor < 1.5 ? '⚠️ <strong>Below 1.5 — redesign required</strong>' :
         minSafetyFactor < 2.5 ? '✓ Acceptable for dynamic load' : '✓ Safe') + '<br>' +
      'High-stress parts (&gt;70% of max): <code>' + hotspotCount + '</code><br>' +
      '<em>Red = highest stress, blue = lowest. Use <strong>Solid</strong> to reset colours.</em>');
  });
  if ($stress) $stress.addEventListener('click', () => {
    if (global.UARE_CAD && global.UARE_CAD.setRenderMode) global.UARE_CAD.setRenderMode('stress');
    _addMsg('assistant', 'Stress heatmap mode active. Red = high stress, blue = low stress.');
  });

  // Thermal analysis button
  const $thermal = document.getElementById('btn-thermal');
  if ($thermal) $thermal.addEventListener('click', async () => {
    if (!_assembly) { _addMsg('assistant', 'Load an assembly first.'); return; }
    _setEnkiLive(true, 'Running thermal analysis…');
    const sc = global.UARE_CAD && global.UARE_CAD.getLastScene && global.UARE_CAD.getLastScene();
    if (sc && global.UARE_SIM && global.UARE_SIM.runThermal) {
      try {
        const r = global.UARE_SIM.runThermal(_assembly, 500, 25); // 500W heat load, 25°C ambient
        _setEnkiLive(false);
        // Apply thermalValue to each mesh based on results
        if (r && r.results && sc.partMeshes) {
          const parts = (_assembly && _assembly.parts) || [];
          r.results.forEach((res, i) => {
            const part = parts[i];
            if (!part) return;
            const mesh = sc.partMeshes[part.id];
            if (mesh && mesh.userData) {
              // Normalize: 25°C = 0.0, 200°C = 1.0
              mesh.userData.thermalValue = Math.min(1, Math.max(0, (parseFloat(res.maxTemp_C) - 25) / 175));
            }
          });
        }
        if (global.UARE_CAD && global.UARE_CAD.setRenderMode) global.UARE_CAD.setRenderMode('thermal');
        const hotParts = r.results ? r.results.filter(p => parseFloat(p.deltaT_C) > 20) : [];
        const maxT = r.results ? Math.max(...r.results.map(p => parseFloat(p.maxTemp_C))) : 0;
        _addMsg('assistant', '<strong>Thermal Analysis Complete</strong><br>' +
          'Peak temperature: <code>' + maxT.toFixed(1) + ' °C</code><br>' +
          'Hot parts (ΔT > 20°C): <code>' + hotParts.length + '</code><br>' +
          (hotParts.length ? 'Hottest: ' + hotParts.slice(0,3).map(p => esc(p.name) + ' (' + p.maxTemp_C + '°C)').join(', ') + '<br>' : '') +
          '<em>Thermal heatmap applied. Orange/white = hot, dark = cool.<br>Use "Solid" mode to reset colours.</em>');
      } catch(e) {
        _setEnkiLive(false);
        _addMsg('assistant', 'Thermal analysis failed: ' + esc(e.message));
      }
    } else {
      // Fallback: apply proxy thermal coloring based on material conductivity from assembly data
      _setEnkiLive(false);
      if (global.UARE_CAD && global.UARE_CAD.setRenderMode) global.UARE_CAD.setRenderMode('thermal');
      const partCount = _assembly && _assembly.parts ? _assembly.parts.length : 0;
      _addMsg('assistant', '<strong>Thermal Heatmap Applied</strong><br>' +
        'Proxy thermal analysis based on material conductivity.<br>' +
        'Parts analysed: <code>' + partCount + '</code><br>' +
        'High-conductivity parts (Al, Cu) shown cool. Low-conductivity parts (polymers, ceramics) shown hot.<br>' +
        '<em>Use "Solid" mode to reset. Run Physics Sim for full transient thermal FEA.</em>');
    }
  });
}

/* ── Quick Build Functions ───────────────────────────────────────────────── */
function _buildEngine4Cyl(text) {
    const U = 1; // all dims in mm
    const engineSpec = _createInline4EngineSpec();
    const layout = _createInline4Layout(engineSpec);
    const parts = [];
    const mates = [];
    let id = 1;
    const p = (obj) => {
      const part = { id: `p${String(id++).padStart('3','0')}`, ...obj };
      parts.push(part);
      return part;
    };

    // ══════════════════════════════════════════════
    // §1  CYLINDER BLOCK & MAIN STRUCTURE
    // ══════════════════════════════════════════════
    p({ name:'Cylinder Block — A380 Die-Cast Aluminum', type:'engine_block', material:'aluminum_cast_a380',
      dims:{w:465,h:340,d:220, cylinders:engineSpec.cylinders, bore:engineSpec.boreMm, pitch:engineSpec.borePitchMm, stroke:engineSpec.strokeMm}, position:layout.blockCenter, color:'#8a9ab5', mass_kg:38.5,
        surface_finish:'Ra 1.6 deck, Ra 3.2 bores (as-cast)', tolerance:'bore H7',
        notes:'A380 die cast. Deck face ground Ra 0.4μm. Main bearing bore Ø58 H7. Bore 86mm, line-bored after main cap install. Bore-to-bore pitch 100mm. Water jacket integral.' });
    p({ name:'Main Bearing Cap #1 — Steel Forged 4340', type:'bracket', material:'steel_4340',
        dims:{w:75,h:32,d:58}, position:[0,0,110], color:'#5a6070', mass_kg:0.62,
        tolerance:'H7 bore Ø58', surface_finish:'Ra 0.4 bearing bore',
        notes:'Line-bored with block installed. Match-marked to block. Replace as set only.' });
    p({ name:'Main Bearing Cap #2', type:'bracket', material:'steel_4340', dims:{w:75,h:32,d:58}, position:[100,0,110], color:'#5a6070', mass_kg:0.62, notes:'Same spec as cap #1.' });
    p({ name:'Main Bearing Cap #3', type:'bracket', material:'steel_4340', dims:{w:75,h:32,d:58}, position:[200,0,110], color:'#5a6070', mass_kg:0.62, notes:'Same spec as cap #3.' });
    p({ name:'Main Bearing Cap #4', type:'bracket', material:'steel_4340', dims:{w:75,h:32,d:58}, position:[300,0,110], color:'#5a6070', mass_kg:0.62, notes:'Same spec as cap #4.' });
    p({ name:'Main Bearing Cap #5 (thrust)', type:'bracket', material:'steel_4340', dims:{w:75,h:32,d:58}, position:[350,0,110], color:'#5a6070', mass_kg:0.68, notes:'Thrust bearing cap. Side-load flanges. Crankshaft end-play 0.07–0.18mm.' });

    // Main bearing cap bolts — M12×1.75×85 Gr.10.9, 2 per cap × 5 caps = 10
    const capBoltY = -16;
    [[0,30],[0,-30],[100,30],[100,-30],[200,30],[200,-30],[300,30],[300,-30],[350,30],[350,-30]].forEach(([x,z],i)=>{
      p({ name:`Main Bearing Cap Bolt #${i+1} — ISO 4762 M12×1.75×85 10.9`, type:'bolt_hex', material:'steel_4340',
          dims:{d:12,L:85}, position:[x,capBoltY,z+110], color:'#4a4a4a', mass_kg:0.062,
          standard:'ISO 4762', torque_nm:130,
          notes:'Grade 10.9. Zinc-nickel 8μm. ARP 2000 spec. Angle: 80 N·m + 90°. Replace after 3 removals.' });
    });

    // Main bearing shells — upper & lower, 5 positions × 2 = 10 shells
    [[0],[100],[200],[300],[350]].forEach(([x],i)=>{
      p({ name:`Main Bearing #${i+1} Upper Shell — ACL 5M2342HX`, type:'bearing', material:'copper',
          dims:{innerD:57.98,outerD:63,width:18}, position:[x,0,110], color:'#c8a860', mass_kg:0.04,
          standard:'ACL Bearings', notes:'Tri-metal: steel back, copper-lead middle, babbitt overlay. Eccentricity 0.05mm. Oil groove 270°. Check clearance 0.025–0.055mm.' });
      p({ name:`Main Bearing #${i+1} Lower Shell`, type:'bearing', material:'copper',
          dims:{innerD:57.98,outerD:63,width:18}, position:[x,-4,110], color:'#c8a860', mass_kg:0.04,
          notes:'No oil groove on lower shell. Install with locating tab in cap groove.' });
    });

    // ══════════════════════════════════════════════
    // §2  CRANKSHAFT ASSEMBLY
    // ══════════════════════════════════════════════
    p({ name:'Crankshaft — 4340 Steel Forged + Microalloy Nitrided', type:'crankshaft', material:'steel_4340',
        dims:{d:55, rodD:48, L:420, stroke:86, cylinders:4}, position:[150,0,110], color:'#6a7a8a', mass_kg:14.2,
        surface_finish:'Ra 0.4 journals', tolerance:'k5 main journals, k5 rod journals',
        notes:'4340 steel forged, nitrided 0.3mm case HV 600. Main journal Ø55 k5. Rod journal Ø48 k5. 5 main throws, 4 rod throws at 180° pairs. Dynamic balance ±2 g·cm. Oil drillings 3mm to all journals.' });
    p({ name:'Crankshaft Front Seal — SKF 17367', type:'lip_seal', material:'viton',
        dims:{innerD:28,outerD:47,h:10}, position:[-10,0,110], color:'#181818', mass_kg:0.02,
        notes:'PTFE lip. Oil-resistant spring. Lip angle 45°. Max speed 6000 RPM. Install with seal driver to 2mm below block face.' });
    p({ name:'Crankshaft Rear Seal — SKF 99260', type:'lip_seal', material:'viton',
        dims:{innerD:80,outerD:100,h:12}, position:[385,0,110], color:'#181818', mass_kg:0.035,
        notes:'PTFE lip. RTV sealant on OD during install. Compress crankshaft rearward before installing.' });
    p({ name:'Harmonic Balancer / Crankshaft Pulley', type:'pulley', material:'cast_iron',
        dims:{d:180,h:52}, position:[-40,0,110], color:'#505050', mass_kg:3.8,
        notes:'Elastomeric vibration damper. Rubber bond cured in. TDC mark at 0° on OD. Align to timing cover index mark.' });
    p({ name:'Flywheel — Nodular Iron Ring Gear Assembly', type:'flywheel', material:'cast_iron_ductile',
      dims:{d:290,h:32}, position:[430,0,110], color:'#5f6772', mass_kg:8.9,
      notes:'Dual-mass style flywheel with integral starter ring gear. Indexed to crank flange with dowel. Face runout max 0.10mm.' });
    p({ name:'Clutch Disc — Organic Friction 240mm', type:'clutch_disc', material:'steel_1018',
      dims:{d:240,h:10}, position:[448,0,110], color:'#6b5b4d', mass_kg:1.35,
      notes:'Sprung-hub disc, 240mm OD, organic friction lining. Torque capacity 320 N·m. Inspect for hot spotting and radial cracks.' });
    p({ name:'Pressure Plate — Diaphragm Spring 240mm', type:'pressure_plate', material:'steel_1018',
      dims:{w:250,h:45,d:250}, position:[468,0,110], color:'#4f5660', mass_kg:4.6,
      notes:'Cast cover with diaphragm spring. Clamp load 8.5 kN. Balanced with flywheel as matched set.' });
    p({ name:'Harmonic Balancer Bolt — ISO 4162 M20×1.5×65 10.9', type:'bolt_hex', material:'steel_4340',
        dims:{d:20,L:65}, position:[-52,0,110], color:'#3a3a3a', mass_kg:0.11, standard:'ISO 4162',
        torque_nm:280, notes:'Grade 10.9. Single-use (plastic region). Threadlocker Loctite 277. 280 N·m + angle 90°.' });

    // ══════════════════════════════════════════════
    // §3  PER-CYLINDER ASSEMBLIES (4×)
    // ══════════════════════════════════════════════
    const BORES = layout.cylinderXsMm;
    BORES.forEach((bx, ci) => {
      const cn = ci + 1;

      // Cylinder liner
      p({ name:`Cylinder Liner #${cn} — Cast Iron Centrifugal`, type:'cylinder_liner', material:'cast_iron',
          dims:{d:86,innerD:78,L:150}, position:[bx,75,110], color:'#686868', mass_kg:0.85,
          surface_finish:'Ra 0.8 bore honed (plateau hone)', tolerance:'H6 bore Ø86',
          notes:'Cast iron, honed bore 86.000±0.010mm. Plateau hone 45° crosshatch 120° each. Press-fit into block 0.04–0.07mm interference.' });

      // Piston
      p({ name:`Piston #${cn} — Forged Aluminum 4032-T6, Ø86mm`, type:'piston', material:'aluminum',
          dims:{d:86,h:70}, position:[bx,110,110], color:'#a8b8c8', mass_kg:0.38,
          surface_finish:'Ra 1.6 OD, dry film (Molykote) skirts',
          notes:'4032-T6 forged. Piston-to-wall clearance 0.025–0.040mm. Wrist pin offset 0.5mm anti-thrust. Crown dome volume calculated for CR 10.5:1.' });

      // Compression ring 1
      p({ name:`Piston Ring #${cn}-1 — Top Compression, PVD Coated Cr`, type:'piston_ring', material:'steel',
          dims:{innerD:86, ringW:1.2, ringT:3.5}, position:[bx,130,110], color:'#9a9a9a', mass_kg:0.012,
          notes:'Barrel-face top ring. PVD CrN coating 10μm. Width 1.2mm × 3.5mm height. Ring gap 0.20–0.35mm installed.' });
      p({ name:`Piston Ring #${cn}-2 — Second Compression, Taper-face`, type:'piston_ring', material:'cast_iron',
          dims:{innerD:86, ringW:1.5, ringT:3.5}, position:[bx,126,110], color:'#7a7a7a', mass_kg:0.014,
          notes:'Taper-face second ring. Phosphate coated. 1.5mm width, 3.5mm height. Gap 0.35–0.55mm.' });
      p({ name:`Piston Ring #${cn}-3 — Oil Control, 3-Piece`, type:'piston_ring', material:'spring_steel',
          dims:{innerD:86, ringW:3.0, ringT:3.2}, position:[bx,121,110], color:'#a0a0a0', mass_kg:0.018,
          notes:'3-piece oil ring: 2 chrome-faced rails + 1 coiled expander. Width 2×0.4mm + 3mm expander. Tension 22–28 N.' });

      // Wrist pin
      p({ name:`Wrist Pin #${cn} — Case-hardened Steel Ø22×58`, type:'shaft', material:'steel_4340',
          dims:{d:22,L:58}, position:[bx,110,110], color:'#8080a0', mass_kg:0.085,
          surface_finish:'Ra 0.2 OD', tolerance:'k5',
          notes:'Case-carburized 0.8mm, HRC 58-62 surface, HRC 25-32 core. Fully floating in piston. Pin-to-bore clearance 0.005–0.015mm.' });
      p({ name:`Wrist Pin Circlip #${cn}A — DIN 472 Ø22`, type:'circlip', material:'spring_steel',
          dims:{innerD:22,tubeR:1.5}, position:[bx,110,81], color:'#3a3a3a', mass_kg:0.004,
          standard:'DIN 472', notes:'Install with gap facing up. Replace each disassembly.' });
      p({ name:`Wrist Pin Circlip #${cn}B — DIN 472 Ø22`, type:'circlip', material:'spring_steel',
          dims:{innerD:22,tubeR:1.5}, position:[bx,110,139], color:'#3a3a3a', mass_kg:0.004,
          standard:'DIN 472', notes:'Install with gap facing down (opposite to A).' });

      // Connecting rod
      p({ name:`Connecting Rod #${cn} — 4340 Steel H-Beam Forged`, type:'con_rod', material:'steel_4340',
          dims:{w:22, h:155, ctc:155, bigEndD:52, smallEndD:24}, position:[bx,50,110], color:'#5a6878', mass_kg:0.58,
          surface_finish:'Ra 0.4 big/small end bores',
          notes:'4340 H-beam forged, shot-peened. Big end bore Ø48.98mm, small end Ø22.015mm. Center-to-center 155mm. Weight-matched ±1g across set.' });
      p({ name:`Con Rod Bolt #${cn}A — ARP 2000 M9×1.0×34`, type:'bolt_hex', material:'steel_4340',
          dims:{d:9,L:34}, position:[bx,2,100], color:'#3a3a4a', mass_kg:0.025,
          standard:'ARP 200-6301', torque_nm:50, notes:'ARP 2000 wave-loc washer head. 50 N·m lubed with ARP moly lube. Single-use.' });
      p({ name:`Con Rod Bolt #${cn}B — ARP 2000 M9×1.0×34`, type:'bolt_hex', material:'steel_4340',
          dims:{d:9,L:34}, position:[bx,2,120], color:'#3a3a4a', mass_kg:0.025,
          standard:'ARP 200-6301', torque_nm:50, notes:'Same spec as A bolt.' });
        p({ name:`Rod Bearing #${cn} Upper — ACL 4B2342H`, type:'rod_bearing', material:'copper',
          dims:{innerD:47.98,outerD:53,width:18}, position:[bx,-5,110], color:'#c8a860', mass_kg:0.03,
          notes:'Clearance 0.020–0.050mm. Check with Plastigauge. Oil groove full 360°.' });
        p({ name:`Rod Bearing #${cn} Lower — ACL 4B2342H`, type:'rod_bearing', material:'copper',
          dims:{innerD:47.98,outerD:53,width:18}, position:[bx,-8,110], color:'#c8a860', mass_kg:0.03,
          notes:'No oil groove on lower shell. Locating notch at parting face.' });
    });

    // ══════════════════════════════════════════════
    // §4  CYLINDER HEAD
    // ══════════════════════════════════════════════
    p({ name:'Cylinder Head — A356-T6 Sand-Cast Aluminum, DOHC 16V', type:'cylinder_head', material:'aluminum',
      dims:{w:380,h:78,d:220, cylinders:engineSpec.cylinders, bore:engineSpec.boreMm, pitch:engineSpec.borePitchMm, depth:220}, position:layout.headCenter, color:'#9ab0c0', mass_kg:14.8,
        surface_finish:'Ra 0.4 deck, Ra 0.8 cam bores',
        notes:'A356-T6 T4 heat-treated. Combustion chamber CNC-machined. Intake port flow 210 cfm @ 28" H2O. Exhaust port flow 155 cfm. Valve seat: steel-alloy insert press-fit.' });
    p({ name:'Head Gasket — Multi-Layer Steel (MLS), 0.7mm', type:'gasket', material:'stainless_304',
        dims:{w:380,h:1,d:220}, position:[150,240.5,110], color:'#b8b0a0', mass_kg:0.22,
        notes:'5-layer MLS: outer beaded SUS301 + armoring + viton elastomer. Bore 87.5mm. Torque in-sequence. Inspect for re-use: max 0.1mm crush differential.' });

    // Head bolts — 10 × M11×1.5×135 (typical DOHC inline-4)
    const HB_POSITIONS = [[20,240],[60,240],[100,240],[140,240],[180,240],[220,240],[260,240],[300,240],[340,240],[370,240]];
    HB_POSITIONS.forEach(([x,y],i)=>{
      p({ name:`Head Bolt #${i+1} — ISO 4762 M11×1.5×135 10.9 Torx55`, type:'bolt_hex', material:'steel_4340',
          dims:{d:11,L:135}, position:[x,y,110], color:'#4a4a4a', mass_kg:0.085,
          standard:'ISO 4762', torque_nm:0,
          notes:'Grade 10.9. Zinc-nickel. Torque-angle: 20 N·m + 60° + 60° + 60°. Single use — replace every removal. Oil thread and under-head before install.' });
    });

    // ══════════════════════════════════════════════
    // §5  VALVETRAIN — DOHC 16V
    // ══════════════════════════════════════════════
    p({ name:'Intake Camshaft — Billet 4340, 268° Duration', type:'camshaft', material:'steel_4340',
      dims:{d:26,L:360,cylinders:engineSpec.cylinders,lift:10.5,jD:26}, position:layout.intakeCamCenter, color:'#5a6878', mass_kg:1.85,
        surface_finish:'Ra 0.4 journals and lobes',
        notes:'Billet 4340. Hardened and ground lobes HRC 58–62. Lift 10.5mm. Duration 268°@1mm. Journals Ø26 k5. Cam-to-cam phasing via VVT actuator.' });
    p({ name:'Exhaust Camshaft — Billet 4340, 256° Duration', type:'camshaft', material:'steel_4340',
      dims:{d:26,L:360,cylinders:engineSpec.cylinders,lift:9.8,jD:26}, position:layout.exhaustCamCenter, color:'#5a6878', mass_kg:1.75,
        surface_finish:'Ra 0.4',
        notes:'Exhaust cam. Lift 9.8mm. Duration 256°@1mm. VVT phaser range ±28° CCA.' });
    p({ name:'Intake Cam Sprocket (VVT Phaser)', type:'sprocket', material:'aluminum_7075_t6',
        dims:{d:120,h:28}, position:[-12,390,80], color:'#8898a8', mass_kg:0.62,
        notes:'VVT oil-pressure actuated phaser. ±28° CCA range. Lock pin at default (0° advance) for start.' });
    p({ name:'Exhaust Cam Sprocket (VVT Phaser)', type:'sprocket', material:'aluminum_7075_t6',
        dims:{d:120,h:28}, position:[-12,390,140], color:'#8898a8', mass_kg:0.58,
        notes:'VVT phaser. Retard-only on exhaust for NOx. Lock pin at full retard.' });
    p({ name:'Timing Chain — Duplex #08B-2, 140-Link', type:'timing_chain', material:'steel',
      dims:{w:10,h:340,d:3,links:140,pitch:12.7}, position:[-12,195,110], color:'#5a5a6a', mass_kg:0.38,
        notes:'Iwis duplex roller chain #08B-2. 12.7mm pitch, 140 links. Min tensile 35 kN. Replace at 150,000 km.' });
    p({ name:'Timing Chain Guide — Upper (Tensioner Side)', type:'bracket', material:'nylon_pa66',
        dims:{w:8,h:180,d:20}, position:[-8,290,88], color:'#1a1a1a', mass_kg:0.045,
        notes:'PA66-GF30 guide rail. Replace with chain. Wear limit: 1mm per rail face.' });
    p({ name:'Timing Chain Guide — Lower (Fixed)', type:'bracket', material:'nylon_pa66',
        dims:{w:8,h:160,d:20}, position:[-8,100,132], color:'#1a1a1a', mass_kg:0.038, notes:'Fixed lower guide.' });
    p({ name:'Timing Chain Tensioner — Hydraulic, Ratchet', type:'spring', material:'aluminum',
        dims:{w:30,h:70,d:30}, position:[-30,250,85], color:'#8898a8', mass_kg:0.12,
        notes:'Oil-pressure hydraulic + ratchet anti-drainback. Prime before start after oil change. Install with piston retracted.' });
    p({ name:'Chain Tensioner Bolt M8×1.25×30 — ISO 4762 (×2)', type:'bolt_hex', material:'steel',
        dims:{d:8,L:30}, position:[-30,255,75], color:'#4a4a4a', mass_kg:0.015,
        standard:'ISO 4762', torque_nm:25, notes:'M8×1.25. 25 N·m.' });

    // Valves — 16 total with matched retainers, collets, seals, and HLAs
    BORES.forEach((bx, ci) => {
      const valveDefs = [
      { kind: 'intake', z: layout.valveZsMm[0], valveY: 295, springY: 340, retainerY: 348, colletY: 352, sealY: 363, hlaY: 375 },
      { kind: 'exhaust', z: layout.valveZsMm[1], valveY: 295, springY: 340, retainerY: 348, colletY: 352, sealY: 363, hlaY: 375 },
      { kind: 'intake', z: layout.valveZsMm[2], valveY: 295, springY: 340, retainerY: 348, colletY: 352, sealY: 363, hlaY: 375 },
      { kind: 'exhaust', z: layout.valveZsMm[3], valveY: 295, springY: 340, retainerY: 348, colletY: 352, sealY: 363, hlaY: 375 },
      ];
      valveDefs.forEach((valve, valveIndex) => {
      const globalIndex = ci * 4 + valveIndex + 1;
      const isIntake = valve.kind === 'intake';
      p({
        name: `${isIntake ? 'Intake' : 'Exhaust'} Valve #${globalIndex} — ${isIntake ? 'Stainless 21-4N, Ø33mm' : 'Inconel 751, Ø28mm'}`,
        type: isIntake ? 'valve_intake' : 'valve_exhaust',
        material: isIntake ? 'stainless_304' : 'inconel_718',
        dims: { d: 5.5, L: isIntake ? 105 : 103, headD: isIntake ? engineSpec.intakeValveHeadMm : engineSpec.exhaustValveHeadMm },
        position: [bx, valve.valveY, valve.z],
        color: isIntake ? '#c8d0d8' : '#a0a8b0',
        mass_kg: isIntake ? 0.062 : 0.055,
        surface_finish: isIntake ? 'Ra 0.4 stem, Ra 0.2 seating face' : 'Ra 0.4 stem',
        notes: isIntake
        ? '21-4N stainless. Head Ø33mm, 45° seat, 30° back-cut. Stem Ø5.5 h6. Seat width 1.5mm. Chromium nitride DLC coating on stem.'
        : 'Inconel 751 head (sodium-cooled hollow stem option). Ø28mm head, 45° seat. Stellite-faced valve seat for lead-free fuel.',
      });
      p({ name:`Valve Spring #${globalIndex} — Single Beehive, PAC Racing`, type:'valve_spring', material:'spring_steel',
        dims:{d:30,L:45}, position:[bx, valve.springY, valve.z], color:'#8090a0', mass_kg:0.065,
        notes:'High-strength alloy wire. Seat load 200N at installed height 38mm. Open load 450N at lift 10.5mm. Natural freq > 2× max cam lobe freq.' });
      p({ name:`Valve Spring Retainer #${globalIndex} — Titanium Grade 5`, type:'valve_spring_retainer', material:'titanium_6al4v',
        dims:{innerD:6,outerD:28,h:7}, position:[bx, valve.retainerY, valve.z], color:'#9aa8b8', mass_kg:0.018,
        notes:'Ti-6Al-4V retainer reduces valvetrain mass 40%. Inner groove for 2-piece collet. Match-grade with spring top coil OD.' });
      p({ name:`Valve Collet #${globalIndex}A — ISO 5356 Ø5.5`, type:'valve_collet', material:'steel',
        dims:{innerD:5.5,outerR:8,h:5}, position:[bx, valve.colletY, valve.z - 2], color:'#5a5a6a', mass_kg:0.006,
        notes:'2-piece split collet. 3-groove stem engagement. Install with assembly lube. Re-use if undamaged.' });
      p({ name:`Valve Collet #${globalIndex}B — ISO 5356 Ø5.5`, type:'valve_collet', material:'steel',
        dims:{innerD:5.5,outerR:8,h:5}, position:[bx, valve.colletY, valve.z + 2], color:'#5a5a6a', mass_kg:0.006,
        notes:'Partner to collet A. Stagger gap 180°.' });
      p({ name:`Valve Stem Seal #${globalIndex} — Viton PTFE-Lip`, type:'lip_seal', material:'viton',
        dims:{innerD:5.5,outerD:12,h:9}, position:[bx, valve.sealY, valve.z], color:'#202020', mass_kg:0.004,
        notes:'Viton with PTFE-coated inner lip. Spring-loaded. Max stem seal oil consumption: 0.1 g/h. Replace every valve job.' });
      p({ name:`Hydraulic Lash Adjuster (HLA) #${globalIndex}`, type:'lash_adjuster', material:'steel',
        dims:{d:23,h:30}, position:[bx, valve.hlaY, valve.z], color:'#6a7080', mass_kg:0.055,
        notes:'Full-hydraulic zero-lash adjuster. Oil-fed through cylinder head gallery. Bleed-down time 60s min after installation. If noisy >15 min, replace.' });
      });
    });

    // ══════════════════════════════════════════════
    // §6  OIL SYSTEM
    // ══════════════════════════════════════════════
    p({ name:'Oil Pan — Stamped Steel 0.8mm, 5.5L Capacity', type:'oil_pan', material:'steel_1018',
      dims:{w:440,h:75,d:220}, position:layout.oilPanCenter, color:'#505060', mass_kg:2.1,
        notes:'Stamped 1.0mm steel. Baffled sump. Drain plug M14×1.5 with sealing washer. Capacity 5.5L with filter. RTV sealant on flange (no gasket).' });
    p({ name:'Oil Pan Gasket — Silicone RTV (in lieu of separate gasket)', type:'gasket', material:'silicone',
        dims:{w:440,h:2,d:220}, position:[150,-100.5,110], color:'#303030', mass_kg:0.01,
        notes:'Loctite 587 Blue RTV. 4mm bead, 3mm from bolt holes. Allow 2h cure before fill. No reuse.' });
    // Oil pan bolts 14× M8×25
    for(let i=0;i<14;i++){
      const bx = -10 + i * 34;
      p({ name:`Oil Pan Bolt #${i+1} — ISO 4762 M8×1.25×25`, type:'bolt_hex', material:'steel',
          dims:{d:8,L:25}, position:[bx<440?bx:440,-100,i%2===0?20:200], color:'#4a4a4a', mass_kg:0.012,
          standard:'ISO 4762', torque_nm:25, notes:'M8×1.25. 25 N·m. Zinc-plated.' });
    }
    p({ name:'Oil Pump — Gerotor, Integral Balance Shafts', type:'oil_pump', material:'aluminum',
        dims:{w:120,h:60,d:80}, position:[-20,-50,110], color:'#8898a8', mass_kg:1.4,
        notes:'Chain-driven gerotor pump. Max flow 50 L/min @2000 RPM. Relief valve set 4.5 bar. Integrated balance shaft eliminates first-order vibration.' });
    p({ name:'Oil Pickup Tube', type:'pipe_straight', material:'steel',
        dims:{d:20,L:120}, position:[60,-80,110], color:'#606878', mass_kg:0.08,
        notes:'Banjo-to-tube welded. Screen mesh 0.8mm. Keep >10mm from pan bottom. Silicone O-ring at pump junction.' });
    p({ name:'Oil Pickup O-ring — AS568-120 Viton', type:'o_ring', material:'viton',
        dims:{innerD:20,tubeR:2.5}, position:[0,-50,110], color:'#181818', mass_kg:0.003,
        standard:'AS568-120', notes:'Viton V70. Replace each removal.' });
    p({ name:'Oil Filter — Mann W 7015 (Spin-On)', type:'oil_filter', material:'steel',
        dims:{d:68,L:76}, position:[400,-60,200], color:'#383838', mass_kg:0.35,
        notes:'Mann W7015. Anti-drainback valve. Bypass valve 1.2 bar. Tighten 3/4 turn after gasket contact. Replace every 10,000 km.' });
    p({ name:'Oil Pressure Sender — VDO 360-081-029', type:'oil_pressure_sensor', material:'steel',
        dims:{d:20,L:35}, position:[380,-30,200], color:'#605a50', mass_kg:0.04,
        notes:'1/8" NPT. 0–7 bar. Resistance 10Ω (pressure) – 180Ω (no pressure). M12×1.5 fitting. 25 N·m.' });
    p({ name:'Engine Oil Dipstick', type:'shaft', material:'steel',
        dims:{d:6,L:480}, position:[350,-30,30], color:'#c0b080', mass_kg:0.04,
        notes:'Min/Max marks 6mm apart = ~1L. Check warm on level surface after 5 min off.' });

    // ══════════════════════════════════════════════
    // §7  COOLING SYSTEM
    // ══════════════════════════════════════════════
    p({ name:'Water Pump — Mechanical, Cast Iron Housing', type:'water_pump', material:'cast_iron',
        dims:{w:120,h:100,d:80}, position:[-30,120,20], color:'#646464', mass_kg:1.8,
        notes:'V-belt or serpentine driven. 60 L/min @3000 RPM. Ceramic seal. Bearing: 6206-2RS. Replace at 120,000 km or on coolant leak.' });
    p({ name:'Water Pump Gasket — Copper 1mm', type:'gasket', material:'copper',
        dims:{w:120,h:2,d:80}, position:[-30,120,56], color:'#b87333', mass_kg:0.04,
        notes:'Anneal copper gasket before install (heat to cherry red, quench). No sealant.' });
    // WP bolts M8×30 ×6
    for(let i=0;i<6;i++){
      p({ name:`Water Pump Bolt #${i+1} — M8×1.25×30`, type:'bolt_hex', material:'steel',
          dims:{d:8,L:30}, position:[-50+i*20,120+30*Math.sin(i),56], color:'#4a4a4a', mass_kg:0.014,
          standard:'ISO 4762', torque_nm:25, notes:'M8. 25 N·m. Anti-seize on threads into aluminum.' });
    }
    p({ name:'Thermostat — Wax-Element 87°C Opening', type:'thermostat_valve', material:'brass',
        dims:{d:44,h:25}, position:[50,240,20], color:'#c89040', mass_kg:0.06,
        notes:'OEM spec 87°C. Full open 102°C. Lift 8mm. Thermostat housing seals with O-ring 44×3mm. Replace every coolant service.' });
    p({ name:'Thermostat Housing — Plastic Fiber-Reinforced', type:'thermostat_housing', material:'nylon_pa66',
        dims:{w:70,h:55,d:55}, position:[50,255,20], color:'#383838', mass_kg:0.12,
        notes:'PA66-GF35. Integrated coolant bleed nipple. O-ring seat molded-in. Inspect for cracks every service.' });
    for(let i=0;i<3;i++){
      p({ name:`T-stat Housing Bolt #${i+1} — M8×25`, type:'bolt_hex', material:'steel',
          dims:{d:8,L:25}, position:[30+i*20,260,30], color:'#4a4a4a', mass_kg:0.011,
          standard:'ISO 4762', torque_nm:10, notes:'10 N·m. Do not overtighten PA housing.' });
    }
    // Freeze plugs ×6 (core plugs)
    [[0,80,0],[0,80,220],[0,0,0],[0,0,220],[0,160,0],[0,160,220]].forEach(([x,y,zp],i)=>{
      p({ name:`Freeze Plug #${i+1} — Steel Ø38 Expansion`, type:'disk', material:'steel_1018',
          dims:{d:38,h:8}, position:[x+50,y,zp], color:'#808890', mass_kg:0.02,
          notes:'Drive in 0.5mm below flush. RTV on OD. Do not use hammered-in plugs for hot-side locations — use threaded.' });
    });

    // ══════════════════════════════════════════════
    // §8  INTAKE MANIFOLD & FUEL
    // ══════════════════════════════════════════════
    p({ name:'Intake Manifold — Cast Aluminum, Variable Runner', type:'intake_manifold', material:'aluminum_cast_a380',
      dims:{w:360,h:120,d:160,cylinders:engineSpec.cylinders,pitch:engineSpec.borePitchMm,runnerD:42,runnerL:engineSpec.intakeRunnerMm,throttleD:64}, position:layout.intakeManifoldCenter, color:'#a8b8c8', mass_kg:4.2,
        notes:'Cast A380 with plastic composite runners above. Tumble valves for low-load efficiency. Internal EGR passages. Torque: 22 N·m on head studs.' });
    BORES.forEach((bx,ci)=>{
      p({ name:`Intake Port Gasket #${ci+1} — MLS Fiber 1mm`, type:'gasket', material:'stainless_304',
          dims:{w:50,h:2,d:45}, position:[bx,320,65], color:'#b8b0a0', mass_kg:0.01, notes:'Replace every manifold removal.' });
    });
    for(let i=0;i<8;i++){
      p({ name:`Intake Manifold Bolt #${i+1} — M8×1.25×30`, type:'bolt_hex', material:'steel',
          dims:{d:8,L:30}, position:[30+i*45,340,65], color:'#4a4a4a', mass_kg:0.014,
          standard:'ISO 4762', torque_nm:22, notes:'22 N·m. Aluminum head — do not reuse locktite.' });
    }
    p({ name:'Throttle Body — 64mm Bore, Drive-by-Wire', type:'housing', material:'aluminum',
        dims:{w:80,h:80,d:90}, position:[150,400,55], color:'#8898a8', mass_kg:0.55,
        notes:'64mm bore electronic throttle. Throttle position sensor dual-redundant. Idle air bypass stepper. Clean bore with non-chlorinated cleaner only.' });
    p({ name:'Throttle Body Gasket', type:'gasket', material:'viton',
        dims:{w:80,h:2,d:80}, position:[150,360,55], color:'#202020', mass_kg:0.008, notes:'Viton 2mm. Replace on removal.' });
    for(let i=0;i<4;i++){
      p({ name:`TB Bolt #${i+1} — M6×20`, type:'bolt_hex', material:'steel',
          dims:{d:6,L:20}, position:[130+i*12,365,55], color:'#4a4a4a', mass_kg:0.006,
          standard:'ISO 4762', torque_nm:10, notes:'10 N·m.' });
    }
    p({ name:'Fuel Rail — Steel 16×2mm Wall Tube', type:'pipe_straight', material:'stainless_316',
        dims:{d:16,L:340}, position:[150,380,185], color:'#9a9a9a', mass_kg:0.32,
        notes:'Stainless 316. Max pressure 350 bar (direct injection). Fuel pressure regulator port at end. Injector cups Ø14.4 H7.' });
    BORES.forEach((bx,ci)=>{
        p({ name:`Fuel Injector #${ci+1} — Bosch EV14 280cc/min`, type:'fuel_injector', material:'steel',
          dims:{d:14,L:68}, position:[bx,380,185], color:'#3a4050', mass_kg:0.038,
          notes:'Bosch EV14 connector. Static flow 280 cc/min @3bar. 12V solenoid. O-ring top and bottom. Fuel rail: 3bar operating / 7bar static test.' });
      p({ name:`Injector O-ring Top #${ci+1} — AS568-009 Viton`, type:'o_ring', material:'viton',
          dims:{innerD:12,tubeR:1.5}, position:[bx,408,185], color:'#181818', mass_kg:0.002,
          standard:'AS568-009', notes:'Viton V70. Fuel-resistant. Lube with clean fuel only.' });
      p({ name:`Injector O-ring Bottom #${ci+1} — AS568-008 Viton`, type:'o_ring', material:'viton',
          dims:{innerD:12,tubeR:1.5}, position:[bx,355,185], color:'#181818', mass_kg:0.002,
          standard:'AS568-008', notes:'Seat in intake manifold boss. Lube with clean fuel.' });
    });
    for(let i=0;i<4;i++){
      p({ name:`Fuel Rail Bracket Bolt #${i+1} — M6×20`, type:'bolt_hex', material:'steel',
          dims:{d:6,L:20}, position:[40+i*100,385,180], color:'#4a4a4a', mass_kg:0.006,
          standard:'ISO 4762', torque_nm:10, notes:'10 N·m.' });
    }
    p({ name:'MAP Sensor — 3-bar Absolute', type:'map_sensor', material:'abs',
        dims:{d:22,h:35}, position:[150,395,190], color:'#303038', mass_kg:0.025, notes:'3-bar MAP. 0.5–4.5V output. Ported to intake manifold via 5mm rubber hose.' });
    p({ name:'IAT Sensor — NTC 2kΩ@25°C', type:'iat_sensor', material:'nylon_pa66',
        dims:{d:12,h:28}, position:[50,365,195], color:'#282830', mass_kg:0.015, notes:'Mounted in intake elbow. NTC thermistor. Pull-up 5V. Replace if response time >2s.' });

    // ══════════════════════════════════════════════
    // §9  EXHAUST MANIFOLD
    // ══════════════════════════════════════════════
    p({ name:'Exhaust Manifold — Ductile Cast Iron, 4-2-1 Merge', type:'exhaust_manifold', material:'cast_iron_ductile',
      dims:{w:360,h:80,d:80,cylinders:engineSpec.cylinders,pitch:engineSpec.borePitchMm,portD:38,runnerL:engineSpec.exhaustRunnerMm,collectorD:60}, position:layout.exhaustManifoldCenter, color:'#5a6060', mass_kg:6.8,
        notes:'Ductile iron GGG-40. 4-2-1 merge for low-mid torque. Wall thickness 5mm. Thermal expansion slot between mid pairs. Coat with ceramic thermal barrier (optional).' });
    BORES.forEach((bx,ci)=>{
      p({ name:`Exhaust Gasket #${ci+1} — Embossed Steel`, type:'gasket', material:'stainless_304',
          dims:{w:55,h:2,d:40}, position:[bx,300,160], color:'#b0a890', mass_kg:0.014, notes:'Replace every manifold removal. Never reuse.' });
      p({ name:`Exhaust Stud #${ci*2+1} — M8×1.25×40 Stainless`, type:'stud', material:'stainless_316',
          dims:{d:8,L:40}, position:[bx-8,295,160], color:'#9090a0', mass_kg:0.012,
          notes:'Stainless to prevent galling in cast iron. Anti-seize on iron threads. Replace if threads are damaged.' });
      p({ name:`Exhaust Stud #${ci*2+2} — M8×1.25×40 Stainless`, type:'stud', material:'stainless_316',
          dims:{d:8,L:40}, position:[bx+8,295,160], color:'#9090a0', mass_kg:0.012, notes:'Same as above.' });
      p({ name:`Exhaust Stud Nut #${ci*2+1} — M8 Stainless`, type:'nut_hex', material:'stainless_316',
          dims:{d:8,h:7}, position:[bx-8,315,160], color:'#9090a0', mass_kg:0.008, torque_nm:30, notes:'30 N·m. Anti-seize. Replace if corroded.' });
      p({ name:`Exhaust Stud Nut #${ci*2+2} — M8 Stainless`, type:'nut_hex', material:'stainless_316',
          dims:{d:8,h:7}, position:[bx+8,315,160], color:'#9090a0', mass_kg:0.008, torque_nm:30, notes:'Same.' });
    });
    // O2 sensors
    p({ name:'O2 Sensor #1 — Wideband LSU 4.9 (Pre-Cat)', type:'o2_sensor', material:'stainless_316',
        dims:{d:22,L:70}, position:[60,290,175], color:'#8080a0', mass_kg:0.08,
        notes:'Bosch LSU 4.9. 5-wire wideband. Lambda 0.7–1.3. Hex 22mm, 45 N·m. Heater 12W. Connector: Bosch EV1.' });
    p({ name:'O2 Sensor #2 — Narrowband NTK (Post-Cat)', type:'o2_sensor', material:'stainless_316',
        dims:{d:22,L:65}, position:[200,285,175], color:'#8080a0', mass_kg:0.06,
        notes:'NTK OZA678. 4-wire. 0–1V. Post-catalyst OBD2 monitoring. 45 N·m.' });

    // ══════════════════════════════════════════════
    // §10  IGNITION & SENSORS
    // ══════════════════════════════════════════════
    BORES.forEach((bx,ci)=>{
      p({ name:`Spark Plug #${ci+1} — NGK IRIDIUM LKR8AI-8`, type:'cylinder', material:'stainless_316',
          dims:{d:14,L:58}, position:[bx,270,110], color:'#a09888', mass_kg:0.028,
          standard:'M14×1.25', torque_nm:25, notes:'Iridium center electrode 0.6mm. Gap 0.7mm. 25 N·m. Replace every 100,000 km.' });
        p({ name:`Ignition Coil #${ci+1} — COP, Energy 110mJ`, type:'ignition_coil', material:'abs',
          dims:{w:42,h:108,d:42}, position:[bx,330,110], color:'#1a1a28', mass_kg:0.19,
          notes:'Coil-on-plug. Primary 0.5Ω, secondary 12kΩ. 12V supply. Connector 3-pin EV1. Dwell time 3.0ms @ 800 RPM.' });
      p({ name:`COP Coil Bolt #${ci+1} — M6×20`, type:'bolt_hex', material:'steel',
          dims:{d:6,L:20}, position:[bx,332,110], color:'#4a4a4a', mass_kg:0.005,
          standard:'ISO 4762', torque_nm:10, notes:'10 N·m.' });
    });
    p({ name:'Crank Position Sensor (CKP) — Hall Effect 60-2 Tooth', type:'crank_sensor', material:'abs',
        dims:{d:19,L:40}, position:[-20,-5,110], color:'#202028', mass_kg:0.04,
        notes:'60-2 tooth wheel on crankshaft. 0.5–1.5mm air gap. 3-wire: 5V, GND, signal. CAN-triggered crank sync.' });
    p({ name:'Cam Position Sensor Front (CMP) — Hall Effect', type:'cam_sensor', material:'abs',
        dims:{d:19,L:35}, position:[-8,390,60], color:'#202028', mass_kg:0.03,
        notes:'Intake cam 3-lobe trigger wheel. 3-wire sensor. 1.0±0.5mm gap.' });
    p({ name:'Cam Position Sensor Rear (CMP) — Hall Effect', type:'cam_sensor', material:'abs',
        dims:{d:19,L:35}, position:[-8,390,160], color:'#202028', mass_kg:0.03,
        notes:'Exhaust cam sensor. Identical to front CMP.' });
    p({ name:'Knock Sensor #1 — Bosch 0261231006', type:'knock_sensor', material:'stainless_304',
        dims:{d:24,L:28}, position:[80,60,200], color:'#707080', mass_kg:0.05,
        standard:'M8×1.25', torque_nm:20, notes:'Broadband piezoelectric. 4–18 kHz. Flat-mount on block. 20 N·m. 2-wire shielded cable.' });
    p({ name:'Knock Sensor #2 — Bosch 0261231006', type:'knock_sensor', material:'stainless_304',
        dims:{d:24,L:28}, position:[220,60,200], color:'#707080', mass_kg:0.05, torque_nm:20, notes:'Identical to KS#1.' });
    p({ name:'Coolant Temperature Sensor — NTC 2kΩ@25°C', type:'coolant_temp_sensor', material:'brass',
        dims:{d:16,L:28}, position:[30,250,200], color:'#c89040', mass_kg:0.03,
        standard:'M12×1.5', torque_nm:20, notes:'Engine temp signal to ECU and gauge. 20 N·m PTFE tape.' });

    // ══════════════════════════════════════════════
    // §11  VALVE COVER & ACCESSORIES
    // ══════════════════════════════════════════════
    p({ name:'Valve Cover — Stamped Steel Powder-Coated', type:'plate', material:'steel_1018',
        dims:{w:380,h:40,d:220}, position:[150,415,110], color:'#2a2a38', mass_kg:1.8,
        notes:'Stamped steel with integral baffles. PCV valve port. Grommet-sealed COP holes. Powder coat wrinkle black 60–80μm.' });
    p({ name:'Valve Cover Gasket — Molded Rubber on Steel Carrier', type:'gasket', material:'nbr_rubber',
        dims:{w:380,h:3,d:220}, position:[150,398,110], color:'#1a1a1a', mass_kg:0.065,
        notes:'NBR over stamped steel carrier. Integral spark plug tube seals (×4). Can be reused if not cracked. Replace at 60,000 km.' });
    for(let i=0;i<12;i++){
      p({ name:`Valve Cover Bolt #${i+1} — M6×1.0×25`, type:'bolt_hex', material:'steel',
          dims:{d:6,L:25}, position:[10+i*33,400,i%2===0?20:200], color:'#4a4a4a', mass_kg:0.007,
          standard:'ISO 4762', torque_nm:10, notes:'10 N·m. Rubber washer each bolt. Tighten center-out.' });
    }

    // ══════════════════════════════════════════════
    // §12  ACCESSORY DRIVE
    // ══════════════════════════════════════════════
    p({ name:'Alternator — Bosch NCB1 150A 14.4V', type:'alternator', material:'aluminum',
        dims:{w:130,h:110,d:80}, position:[-60,120,50], color:'#8898a8', mass_kg:3.8,
        notes:'150A max. Integral voltage regulator. Serpentine 6PK groove. Connector: 4-pin excitation + main B+ M10 stud. Replace brush pack every 100,000 km.' });
    p({ name:'Starter Motor — 12V Planetary Reduction', type:'starter_motor', material:'steel_1018',
      dims:{w:160,h:90,d:85}, position:[360,-20,175], color:'#575d66', mass_kg:3.4,
      notes:'1.7 kW reduction starter. Engages flywheel ring gear via overrunning clutch. Solenoid mounted integral. Peak current 180 A.' });
    p({ name:'Alternator Mounting Bracket', type:'bracket', material:'aluminum_6061_t6',
        dims:{w:80,h:60,d:20}, position:[-50,90,50], color:'#9ab0c0', mass_kg:0.38,
        notes:'T6 aluminium. Clamping slot allows belt tension adjustment ±15mm.' });
    for(let i=0;i<3;i++){
      p({ name:`Alternator Bolt #${i+1} — M10×1.25×65`, type:'bolt_hex', material:'steel',
          dims:{d:10,L:65}, position:[-45+i*20,95,50], color:'#4a4a4a', mass_kg:0.04,
          standard:'ISO 4762', torque_nm:50, notes:'50 N·m. Check belt tension after tighten.' });
    }
    p({ name:'Drive Belt Tensioner — Spring-Loaded, Auto', type:'housing', material:'cast_iron',
        dims:{w:60,h:60,d:50}, position:[-60,60,50], color:'#5a5a60', mass_kg:0.55,
        notes:'Automatic tensioner. Torsion spring 30 N·m arm load. Bearing: 6203-2RS. Mark initial position — if arm at stop, replace tensioner.' });
    p({ name:'Idler Pulley — 65mm Smooth', type:'pulley', material:'steel',
        dims:{d:65,h:22}, position:[-25,55,50], color:'#7a7a80', mass_kg:0.12, notes:'Deep groove bearing. 6203-2RS. Replace with tensioner.' });
    p({ name:'Serpentine Belt — Gates K060705, 6PK, 1790mm', type:'spring', material:'nylon',
        dims:{w:22,h:3,d:1790}, position:[60,90,50], color:'#1a1a1a', mass_kg:0.32,
        notes:'Gates Micro-V K060705. 6 ribs, 1790mm long. Max deflection 10mm. Replace at 150,000 km or visible cracking.' });

    // ══════════════════════════════════════════════
    // §13  WELD BEADS — Block/sump rail
    // ══════════════════════════════════════════════
    p({ name:'Weld Bead — Oil Pan Rail Front GMAW', type:'weld_fillet', material:'steel',
        dims:{w:5,h:4,d:220}, position:[0,-98,110], color:'#8a7040', mass_kg:0.015,
        notes:'GMAW ER70S-6. 5mm fillet × 220mm. 1F. Interpass ≤250°C. MT inspect.' });
    p({ name:'Weld Bead — Oil Pan Rail Rear GMAW', type:'weld_fillet', material:'steel',
        dims:{w:5,h:4,d:220}, position:[300,-98,110], color:'#8a7040', mass_kg:0.015,
        notes:'Same spec.' });

    mates.push(..._buildInline4MateGraph(parts, engineSpec));
    _applyMateGraph(parts, mates);

    return {
      assembly: true,
      name: '2.0L DOHC 16V Inline-4 Engine — Complete Digital Twin',
      description: 'Hyper-accurate digital twin: 2.0L DOHC 16-valve inline-4. Bore 86mm × Stroke 86mm = 1998cc. Compression 10.5:1. Peak power 147kW @6500 RPM. Peak torque 200 N·m @4500 RPM. Mass 142 kg complete. Individual entries for every fastener, bearing, seal, sensor, and weld bead.',
      revision: 'A',
      standard: 'ISO 9001:2015',
      total_mass_kg: 142,
      engine_spec: engineSpec,
      mates,
      parts,
      bom_notes: 'Includes: block/head fasteners, bearings, seals, full valvetrain, fuel/ignition/sensors, accessory drive, flywheel, clutch hardware, and starter motor. Excludes: ECU/wiring harness, gearbox/bellhousing, exhaust system downstream of manifold, air filter/intake pipe. Cam belt/chain covers not modeled (transparent). All torques in N·m on clean dry threads unless noted.'
    };
  }

function _buildGearAssembly(text) {
  return {
    assembly: true,
    name: '2-Stage Helical Gearbox — 400 N·m / i=20:1',
    description: '2-stage helical gear reducer. Input 1450 RPM, output 72.5 RPM. Rated torque 400 N·m. Centre distance 160/250 mm. ISO 6336 Class 6 gears. Horizontally split cast iron housing, taper roller bearings.',
    total_mass_kg: 58.0,
    parts: [
      { id:'cs001', name:'Gearbox Casing — Grey Iron EN-GJL-250', type:'housing', material:'cast_iron',
        dims:{w:450,h:320,d:280}, position:[0,0,0], color:'#6a7070', mass_kg:22.0,
        surface_finish:'Ra 1.6 μm bearing bores, Ra 3.2 μm split face',
        tolerance:'Bearing bores H7, split face flatness 0.05 mm',
        process:'casting', coating:'Internal: oil-resistant epoxy. External: RAL 7035',
        notes:'Horizontally split. Oil level indicator. Breather plug top. Drain plug M20 bottom.' },
      { id:'g1p001', name:'Input Pinion — 18T Helical 4340', type:'gear', material:'steel',
        dims:{module:3, num_teeth:18, face_width:55, helix_angle:15, pitch_diameter:54},
        position:[-120,0,0], color:'#7a8a9a', mass_kg:1.2,
        surface_finish:'Ra 0.4 μm tooth flank (ground)', tolerance:'ISO 1328-1 Class 6',
        process:'grinding', heat_treatment:'Case carburize 1.0 mm, surface 58–62 HRC',
        notes:'Module 3, 18T, 15° helix LH. Ground after carburising.' },
      { id:'g1w001', name:'Stage-1 Wheel — 72T Helical 4340', type:'gear', material:'steel',
        dims:{module:3, num_teeth:72, face_width:50, helix_angle:15, pitch_diameter:216},
        position:[0,0,0], color:'#8a9aaa', mass_kg:6.8,
        surface_finish:'Ra 0.8 μm flank (hobbed+shaved)',
        heat_treatment:'Through-hardened 42–48 HRC',
        notes:'Integral with intermediate shaft. Stage 1 ratio 4:1.' },
      { id:'g2p001', name:'Stage-2 Pinion — 20T Helical 4340', type:'gear', material:'steel',
        dims:{module:5, num_teeth:20, face_width:75, helix_angle:12, pitch_diameter:100},
        position:[0,0,0], color:'#7a8a9a', mass_kg:2.4,
        surface_finish:'Ra 0.4 μm flank (ground)',
        heat_treatment:'Case carburize + grind, surface 58–62 HRC',
        notes:'Module 5, 20T, 12° helix RH. Stage 2 ratio 5:1.' },
      { id:'g2w001', name:'Output Wheel — 100T Helical 4340', type:'gear', material:'steel',
        dims:{module:5, num_teeth:100, face_width:70, helix_angle:12, pitch_diameter:500},
        position:[80,0,0], color:'#8a9aaa', mass_kg:14.2,
        surface_finish:'Ra 0.8 μm (hobbed+shaved)',
        heat_treatment:'Normalised + Q&T 280–320 HB',
        notes:'Output wheel. Shrink-fit to output shaft. Key + keyway backup.' },
      { id:'sh1001', name:'Input Shaft — 4340 Steel', type:'shaft', material:'steel',
        dims:{diameter:40, length:200, keyway_width:10}, position:[-200,0,0], color:'#8a9aaa', mass_kg:1.6,
        surface_finish:'Ra 0.4 μm bearing seats', tolerance:'k5',
        heat_treatment:'Q&T 36–40 HRC', notes:'IEC B3 flange option.' },
      { id:'sh2001', name:'Intermediate Shaft — 4340 Steel', type:'shaft', material:'steel',
        dims:{diameter:60, length:300}, position:[0,0,0], color:'#8a9aaa', mass_kg:3.8,
        heat_treatment:'Q&T 36–40 HRC' },
      { id:'sh3001', name:'Output Shaft — 4340 Steel', type:'shaft', material:'steel',
        dims:{diameter:80, length:350, keyway_width:20}, position:[200,0,0], color:'#8a9aaa', mass_kg:6.2,
        heat_treatment:'Q&T 36–40 HRC', notes:'F115 flange optional.' },
      { id:'brg101', name:'Taper Roller Bearing SKF 32308', type:'bearing', material:'steel',
        dims:{innerD:40, outerD:90, width:33}, quantity:6, position:[-160,0,60], color:'#c8d8e0', mass_kg:0.82,
        standard:'ISO 355', notes:'SKF 32308 J2/Q. X-arrangement. Grease lubed. 6× (2 per shaft).' },
      { id:'seal001', name:'Radial Shaft Seal FKM DIN 3760', type:'lip_seal', material:'viton',
        dims:{innerD:40, outerD:62, width:7}, quantity:3, position:[-180,0,0], color:'#222222', mass_kg:0.025,
        standard:'DIN 3760 A', notes:'FKM lip + dust lip. 80°C oil rated. 3× (input, output, vent).' },
      { id:'gs001', name:'Housing Gasket — PTFE Sheet', type:'gasket', material:'ptfe',
        dims:{w:450, depth:280, thickness:1.0}, position:[0,160,0], color:'#eeeeee', mass_kg:0.08,
        notes:'Compressed PTFE. Cut to housing split profile.' },
    ],
    bom_notes: 'Total ratio 20:1. Oil bath ISO VG 220. Omitted: oil sight glass, breather, coupling guard.'
  };
}
function _buildDrone(text) {
  return {
    assembly: true,
    name: 'Quadcopter Drone — 5" FPV Racing Frame',
    description: '5" freestyle/racing FPV quadcopter. 220 mm wheelbase, CFRP frame, 2306 2400KV motors, 30×30 FC/ESC stack. AUW ≈700 g. 4S LiPo, ~7 min flight time.',
    total_mass_kg: 0.68,
    parts: [
      { id:'frm001', name:'Main Frame — CFRP 3mm H-geometry', type:'plate', material:'carbon_fiber',
        dims:{w:200,h:6,d:160}, position:[0,0,0], color:'#1a1a1a', mass_kg:0.082,
        notes:'T700/M30 CFRP 3 mm. CNC machined. 220 mm motor-to-motor diagonal.' },
      { id:'arm001', name:'Motor Arm FL — CFRP Tube', type:'beam', material:'carbon_fiber',
        dims:{w:16,h:6,d:100}, position:[-100,0,100], color:'#1a1a1a', mass_kg:0.014 },
      { id:'arm002', name:'Motor Arm FR — CFRP Tube', type:'beam', material:'carbon_fiber',
        dims:{w:16,h:6,d:100}, position:[100,0,100], color:'#1a1a1a', mass_kg:0.014 },
      { id:'arm003', name:'Motor Arm RL — CFRP Tube', type:'beam', material:'carbon_fiber',
        dims:{w:16,h:6,d:100}, position:[-100,0,-100], color:'#1a1a1a', mass_kg:0.014 },
      { id:'arm004', name:'Motor Arm RR — CFRP Tube', type:'beam', material:'carbon_fiber',
        dims:{w:16,h:6,d:100}, position:[100,0,-100], color:'#1a1a1a', mass_kg:0.014 },
      { id:'mot001', name:'Motor FL — 2306 2400KV PMSM', type:'custom', material:'aluminum',
        dims:{diameter:27.9,length:31.5}, position:[-100,10,100], color:'#3a3a4a', mass_kg:0.031,
        notes:'Outrunner PMSM. 2306 stator. 2400KV. Max 32A. 12N14P. Ti shaft ∅5mm.' },
      { id:'mot002', name:'Motor FR — 2306 2400KV PMSM', type:'custom', material:'aluminum',
        dims:{diameter:27.9,length:31.5}, position:[100,10,100], color:'#3a3a4a', mass_kg:0.031 },
      { id:'mot003', name:'Motor RL — 2306 2400KV PMSM', type:'custom', material:'aluminum',
        dims:{diameter:27.9,length:31.5}, position:[-100,10,-100], color:'#3a3a4a', mass_kg:0.031 },
      { id:'mot004', name:'Motor RR — 2306 2400KV PMSM', type:'custom', material:'aluminum',
        dims:{diameter:27.9,length:31.5}, position:[100,10,-100], color:'#3a3a4a', mass_kg:0.031 },
      { id:'prp001', name:'Propeller FL — HQProp 5148 Tri-blade CW', type:'rotor_blade', material:'nylon',
        dims:{diameter:127,pitch:122,num_blades:3}, position:[-100,16,100], color:'#2233cc', mass_kg:0.0065,
        notes:'PC+GF tri-blade. CW rotation. Balanced <0.2g.' },
      { id:'prp002', name:'Propeller FR — HQProp 5148 CCW', type:'rotor_blade', material:'nylon',
        dims:{diameter:127,pitch:122,num_blades:3}, position:[100,16,100], color:'#cc3322', mass_kg:0.0065 },
      { id:'prp003', name:'Propeller RL — HQProp 5148 CCW', type:'rotor_blade', material:'nylon',
        dims:{diameter:127,pitch:122,num_blades:3}, position:[-100,16,-100], color:'#cc3322', mass_kg:0.0065 },
      { id:'prp004', name:'Propeller RR — HQProp 5148 CW', type:'rotor_blade', material:'nylon',
        dims:{diameter:127,pitch:122,num_blades:3}, position:[100,16,-100], color:'#2233cc', mass_kg:0.0065 },
      { id:'esc001', name:'4-in-1 ESC — 45A BLHeli32 30×30', type:'pcb', material:'ptfe',
        dims:{w:30,h:7,d:30}, position:[0,14,0], color:'#2a4030', mass_kg:0.024,
        notes:'45A/ch continuous. DSHOT 600. Current sensing. 3–6S. 30×30 stack.' },
      { id:'fc001', name:'Flight Controller — F7 STM32 30×30', type:'pcb', material:'ptfe',
        dims:{w:30,h:6,d:30}, position:[0,21,0], color:'#2a3040', mass_kg:0.018,
        notes:'STM32F7xx 170MHz. MPU-6000 IMU. AT7456E OSD. UART×6.' },
      { id:'bat001', name:'LiPo 4S 1500mAh 100C XT60', type:'housing', material:'ptfe',
        dims:{w:73,h:36,d:37}, position:[0,-22,0], color:'#33aa33', mass_kg:0.192,
        notes:'14.8V nominal. 100C discharge = 150A peak. XT60 connector.' },
      { id:'cam001', name:'FPV Camera — RunCam Phoenix 2 1/3" CMOS', type:'housing', material:'aluminum',
        dims:{w:19,h:19,d:22}, position:[0,20,90], color:'#4a4a4a', mass_kg:0.019,
        notes:'1200TVL. 140° FOV. OSD. 5–36V input.' },
    ],
    bom_notes: 'Omitted: video TX, RC receiver, buzzer, LED strips, battery strap, prop guards.'
  };
}
function _buildRoboticArm(text) {
  return {
    assembly: true,
    name: 'Robotic Arm — 6-DOF 5 kg Payload Industrial Manipulator',
    description: '6-axis serial robot arm. Payload 5 kg, reach 800 mm, repeatability ±0.02 mm. Servo PMSM + harmonic drive joints. 7075-T6 aluminium links. EtherCAT control.',
    total_mass_kg: 22.0,
    parts: [
      { id:'base001', name:'Base — 7075-T6 Anodised Aluminium', type:'housing', material:'aluminum',
        dims:{diameter:200,height:120}, position:[0,0,0], color:'#c8d8e0', mass_kg:4.2,
        surface_finish:'Hard anodize OD 25 μm',
        notes:'J1 waist rotation base. Through-hollow for cable management. 4× M10 mounting bolts.' },
      { id:'lnk1', name:'Link 1 — Shoulder 7075-T6', type:'beam', material:'aluminum',
        dims:{w:80,h:80,length:180}, position:[0,120,0], color:'#c8d8e0', mass_kg:2.1,
        notes:'J2 shoulder pitch. Hollow square for cable routing.' },
      { id:'lnk2', name:'Link 2 — Upper Arm 7075-T6', type:'beam', material:'aluminum',
        dims:{w:70,h:70,length:280}, position:[0,250,0], color:'#c8d8e0', mass_kg:1.8,
        notes:'J3 elbow pitch. Wall 6 mm. Lightening pockets machined.' },
      { id:'lnk3', name:'Link 3 — Forearm 7075-T6', type:'beam', material:'aluminum',
        dims:{w:60,h:60,length:240}, position:[0,380,0], color:'#c8d8e0', mass_kg:1.2,
        notes:'J4 forearm roll. 60 mm OD, 5 mm wall.' },
      { id:'lnk4', name:'Link 4 — Wrist Housing 7075-T6', type:'housing', material:'aluminum',
        dims:{diameter:80,height:80}, position:[0,480,0], color:'#c8d8e0', mass_kg:0.8,
        notes:'J5 wrist pitch. Integrated encoder mount.' },
      { id:'flng001', name:'Tool Flange — ISO 9283 Aluminium', type:'flange', material:'aluminum',
        dims:{diameter:100,height:20,bolt_circle:80,num_bolts:6},
        position:[0,560,0], color:'#c8d8e0', mass_kg:0.4,
        standard:'ISO 9283', notes:'63 mm PCD. M6 × 6 bolts.' },
      { id:'act001', name:'J1 Servo — 400W PMSM EtherCAT', type:'custom', material:'steel',
        dims:{diameter:80,length:120}, position:[0,30,80], color:'#3a3a4a', mass_kg:1.8,
        notes:'400W, 3000 RPM. EtherCAT integrated. Encoder 23-bit Endat 2.2.' },
      { id:'hd001', name:'Harmonic Drive — 100:1 Zero Backlash ×6', type:'worm_drive', material:'steel',
        dims:{outer_diameter:100,length:45,ratio:100}, quantity:6,
        position:[0,60,0], color:'#5a5a6a', mass_kg:0.9,
        standard:'Harmonic Drive HDS series',
        notes:'Flexspline / circular spline. Ratio 100:1. Rated torque 80 N·m each.' },
      { id:'brg001', name:'Cross-Roller Bearing INA CRBH10020 ×6', type:'bearing', material:'steel',
        dims:{innerD:100,outerD:140,height:20}, quantity:6,
        position:[0,100,0], color:'#c8d8e0', mass_kg:0.62,
        standard:'INA CRBH series',
        notes:'High moment capacity. Preloaded. 6× (one per joint).' },
      { id:'enc001', name:'Encoder — 23-bit Absolute Optical ×6', type:'custom', material:'aluminum',
        dims:{diameter:38,length:30}, quantity:6,
        position:[0,110,40], color:'#2a2a3a', mass_kg:0.12,
        standard:'Endat 2.2 / Heidenhain',
        notes:'Single-turn absolute, 23-bit. ±0.01° accuracy. 6× (one per axis).' },
      { id:'cab001', name:'Cable Harness — 24-core Signal + Power', type:'wire', material:'copper',
        dims:{diameter:10,length:2500}, position:[0,300,50], color:'#ff8800', mass_kg:0.85,
        notes:'24-core + 4-core power AWG14 + shielded encoder lines. Routed through hollow links.' },
    ],
    bom_notes: 'Omitted: controller, teach pendant, end effector, cable management track, safety enclosure.'
  };
}
function _buildPump(text) {
  return {
    assembly: true,
    name: 'Centrifugal Pump Assembly — 50 kW / 200 m³/h',
    description: 'Single-stage end-suction centrifugal pump. Q=200 m³/h, H=45 m, P=50 kW, N=1450 RPM. ISO 5199 Class II, back-pull-out. 316L impeller for chemical duty.',
    total_mass_kg: 112.0,
    parts: [
      { id:'imp001', name:'Impeller — 316L Investment Cast, 5-Blade', type:'impeller', material:'stainless',
        dims:{outer_diameter:320,inlet_diameter:180,width:52,num_blades:5},
        position:[0,0,0], color:'#9aaabb', mass_kg:8.4,
        surface_finish:'Ra 1.6 μm flow passages (electropolished)',
        tolerance:'OD ±0.3 mm, balance G2.5 at 1450 RPM',
        heat_treatment:'Solution anneal 1050°C WQ',
        notes:'Closed 5-vane backward-curved. Wear ring OD 185.00–185.03 mm.' },
      { id:'csg001', name:'Pump Casing — Volute, Cast Iron PN10', type:'housing', material:'cast_iron',
        dims:{w:480,h:420,d:340}, position:[0,0,0], color:'#5a6060', mass_kg:48.0,
        surface_finish:'Ra 6.3 μm flow passages, Ra 1.6 μm seal faces',
        tolerance:'Seal bore H7, impeller clearance 0.3–0.5 mm',
        coating:'Internal: Belzona 1111 epoxy 2 mm. External: 2-coat epoxy primer',
        pressure_max_bar:10,
        notes:'Spiral volute. Tangential discharge. Back-pull-out design.' },
      { id:'shf001', name:'Pump Shaft — 316L Stainless', type:'shaft', material:'stainless',
        dims:{diameter:55,length:420}, position:[0,0,0], color:'#9aaabb', mass_kg:5.6,
        surface_finish:'Ra 0.4 μm bearing seats (ground), Ra 0.8 μm seal area',
        tolerance:'Bearing seat: 55 k6, coupling: 50 h6',
        heat_treatment:'Stress relief 450°C 2h' },
      { id:'slp001', name:'Mechanical Seal — John Crane Arrangement 1', type:'lip_seal', material:'silicon_carbide',
        dims:{shaft_diameter:55,oc_diameter:95,length:68},
        position:[0,0,60], color:'#888888', mass_kg:0.48,
        standard:'API 682 Arrangement 1',
        surface_finish:'Ra 0.05 μm seal faces (lapped)',
        notes:'SiC mating ring + rotary face. API Plan 11 seal flush.' },
      { id:'brg001', name:'Inboard Bearing FAG 6312-2RS', type:'ball_bearing', material:'steel',
        dims:{innerD:60,outerD:130,width:31}, position:[0,0,80], color:'#c8d8e0', mass_kg:1.08,
        standard:'ISO 15 (6312)', notes:'Deep groove. C3 clearance. Grease Esso Unirex N3.' },
      { id:'brg002', name:'Outboard Bearing FAG 6309-2RS', type:'ball_bearing', material:'steel',
        dims:{innerD:45,outerD:100,width:25}, position:[0,0,200], color:'#c8d8e0', mass_kg:0.62,
        standard:'ISO 15 (6309)', notes:'Floating bearing — allows thermal expansion.' },
      { id:'brk001', name:'Bearing Housing — Cast Iron', type:'housing', material:'cast_iron',
        dims:{w:220,h:200,d:280}, position:[0,0,140], color:'#5a6060', mass_kg:14.0,
        notes:'Grease nipple both ends. Oil level sight glass.' },
      { id:'cpl001', name:'Flexible Coupling — Jaw Elastomeric DIN 740', type:'coupling', material:'aluminum',
        dims:{diameter:120,length:80,bore:50}, position:[0,0,330], color:'#9ab0c0', mass_kg:1.8,
        standard:'DIN 740',
        notes:'95 Shore A PU spider. 500 N·m rated. ±1° misalignment.' },
      { id:'bst001', name:'Baseplate — Welded Steel ISO 3069', type:'plate', material:'steel',
        dims:{w:900,h:50,d:600}, position:[0,-200,200], color:'#5a6a7a', mass_kg:28.0,
        standard:'ISO 3069 C-frame',
        notes:'Epoxy grouted to concrete plinth. 4 × M20 anchor bolts.' },
    ],
    bom_notes: 'Omitted: motor, coupling guard, pressure gauges, isolation valves, drain plugs.'
  };
}
function _buildBracket(text) {
  const m = text.match(/([0-9]+)s*mm/);
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

function _buildMotor(text) {
  return {
    assembly: true,
    name: 'IE3 Induction Motor — 11 kW 4-Pole B3 Frame IEC 160M',
    description: 'IE3 premium efficiency 3-phase induction motor. 11 kW, 1460 RPM (50 Hz), 400V Δ / 690V Y, Frame 160M, IP55, IC411 TEFC. SKF bearings.',
    total_mass_kg: 76.0,
    parts: [
      { id:'sttr001', name:'Stator Core — M400-65A Lamination Stack', type:'inductor', material:'silicon_steel',
        dims:{outer_diameter:260,inner_diameter:165,stack_length:160}, position:[0,0,0], color:'#4a5060', mass_kg:24.0,
        surface_finish:'Deburr, varnish impregnation VPI Class F',
        notes:'36 slots. 0.65 mm laminations stamped + stacked. Class F (155°C) insulation.' },
      { id:'rotcr001', name:'Rotor Core + Squirrel Cage — ADC12 Die-cast', type:'rotor_blade', material:'aluminum',
        dims:{outer_diameter:163,stack_length:160}, position:[0,0,0], color:'#c8c8b0', mass_kg:14.0,
        surface_finish:'Cage: die-cast ADC12 aluminium',
        notes:'28 rotor bars. Die-cast aluminium cage. Skewed 1 slot to reduce cogging.' },
      { id:'shft001', name:'Rotor Shaft — 42CrMo4 Q&T', type:'shaft', material:'steel',
        dims:{diameter:42,length:490}, position:[0,0,-245], color:'#8a9a9a', mass_kg:4.8,
        surface_finish:'Ra 0.4 μm bearing seats (ground)',
        tolerance:'Bearing seats: 42 k6; DE extension: 42 h6',
        heat_treatment:'Q&T 240–280 HB' },
      { id:'frde001', name:'DE End Shield — GD-AlSi10Mg', type:'housing', material:'aluminum',
        dims:{diameter:280,length:60}, position:[0,0,-220], color:'#9ab0c0', mass_kg:4.2,
        notes:'Bearing location: DE. Bearing preload shims. Grease nipple.' },
      { id:'frnde001', name:'NDE End Shield — GD-AlSi10Mg', type:'housing', material:'aluminum',
        dims:{diameter:280,length:50}, position:[0,0,220], color:'#9ab0c0', mass_kg:3.6,
        notes:'Bearing location: NDE. Float (axial freedom).' },
      { id:'frame001', name:'Motor Frame — GD-AlSi10Mg IP55', type:'housing', material:'aluminum',
        dims:{w:310,h:310,d:390}, position:[0,0,0], color:'#9ab0c0', mass_kg:14.0,
        surface_finish:'External: powder coat RAL 7032',
        notes:'Axial cooling fins. IEC Frame 160M. 4× M20 foot bolt holes.' },
      { id:'brgde001', name:'DE Bearing SKF 6309-2RS C3', type:'ball_bearing', material:'steel',
        dims:{innerD:45,outerD:100,width:25}, position:[0,0,-195], color:'#c8d8e0', mass_kg:0.58,
        standard:'ISO 15 (6309)', notes:'Greased for life. C3 clearance. Located bearing.' },
      { id:'brgnde001', name:'NDE Bearing SKF 6308-2RS C3', type:'ball_bearing', material:'steel',
        dims:{innerD:40,outerD:90,width:23}, position:[0,0,195], color:'#c8d8e0', mass_kg:0.42,
        standard:'ISO 15 (6308)', notes:'Float bearing — allows thermal elongation.' },
      { id:'fan001', name:'Cooling Fan — GF-PA66 Axial', type:'rotor_blade', material:'nylon',
        dims:{diameter:220,hub_diameter:42,num_blades:8}, position:[0,0,240], color:'#3a3a3a', mass_kg:0.38,
        notes:'Glass-filled PA66. Moulded one-piece. Keyed to shaft.' },
      { id:'tc001', name:'Terminal Box — IP55 Die-cast Aluminium', type:'housing', material:'aluminum',
        dims:{w:140,h:110,d:90}, position:[0,160,0], color:'#7a8898', mass_kg:1.4,
        notes:'6-terminal board (for star/delta). M25 cable gland entry.' },
    ],
    bom_notes: 'IE3 efficiency ≥91.4% at full load. Omitted: V-ring shaft seal, PE terminal, nameplate, motor protection relay.'
  };
}

function _buildHeatExchanger(text) {
  return {
    assembly: true,
    name: 'Shell-and-Tube Heat Exchanger — TEMA R, AEL 1-Pass',
    description: 'Fixed-tubesheet TEMA R shell-and-tube HX. Q=500 kW. Shell: 600 mm ID, 25 × 2 mm Cu-Ni 90/10 tubes, tube pitch 31.25 mm, ASME VIII Div.1.',
    total_mass_kg: 580.0,
    parts: [
      { id:'shl001', name:'Shell — Carbon Steel SA-516 Gr.70', type:'tube', material:'steel',
        dims:{inner_diameter:600,wall:10,length:3600}, position:[0,0,0], color:'#7a8070', mass_kg:230.0,
        surface_finish:'Internal: shot blast Sa 2.5. NDT: 100% UT butt welds',
        pressure_max_bar:15, temperature_max_c:250,
        standard:'ASME B31.3 + TEMA R',
        notes:'2 ×DN80 nozzle shell-side inlet/outlet. PN16 flanges. Hydro test 22.5 bar.' },
      { id:'tbs001', name:'Tube Bundle — 127× 25×2 mm Cu-Ni 90/10', type:'tube', material:'copper',
        dims:{outer_diameter:25,wall:2,length:3600,quantity:127,pitch:31.25}, position:[0,0,0], color:'#d48840', mass_kg:98.0,
        surface_finish:'Internally bright-rolled at tubesheet',
        standard:'ASTM B111 C70600',
        notes:'127 tubes, 25×2 mm, triangular pitch 31.25 mm. Condenser-grade Cu-Ni 90/10.' },
      { id:'tsh001', name:'Front Tubesheet — SA-516 Gr.70 + Cu-Ni Overlay', type:'plate', material:'steel',
        dims:{diameter:640,thickness:50}, position:[0,0,-1800], color:'#5a6060', mass_kg:48.0,
        notes:'Rolled + seal-welded tube joints. Integral design with shell (fixed).' },
      { id:'tsh002', name:'Rear Tubesheet — SA-516 Gr.70 + Cu-Ni Overlay', type:'plate', material:'steel',
        dims:{diameter:640,thickness:50}, position:[0,0,1800], color:'#5a6060', mass_kg:48.0 },
      { id:'bfl001', name:'Baffle Set — 25% Cut, 20× SS304 2mm', type:'plate', material:'stainless',
        dims:{diameter:596,thickness:2,cut_percent:25, quantity:20, spacing:165}, position:[0,0,0], color:'#9aaabb', mass_kg:24.0,
        notes:'Single-segmental 25% cut. Tie rods + spacers. Orientation 180° alternating.' },
      { id:'fch001', name:'Front Channel Head — Carbon Steel SA-516 Gr.70', type:'housing', material:'steel',
        dims:{inner_diameter:600,wall:10,length:250}, position:[0,0,-2000], color:'#7a8070', mass_kg:38.0,
        notes:'AEL type — removable channel cover. 2×DN80 PN16 tube-side nozzles.' },
      { id:'fcc001', name:'Front Channel Cover — SA-516 Gr.70', type:'plate', material:'steel',
        dims:{diameter:720,thickness:28}, position:[0,0,-2130], color:'#7a8070', mass_kg:22.0,
        notes:'Bolted to channel head. Stud bolt M30 ×20.' },
      { id:'gs001', name:'Spiral Wound Gasket — 316L + Flex Graphite', type:'gasket', material:'steel',
        dims:{outer_diameter:675,inner_diameter:600,thickness:4.5}, quantity:4,
        position:[0,0,-1850], color:'#3a3a3a', mass_kg:0.95,
        standard:'ASME B16.20', notes:'4 × SWG. Temperature range -196 to 650°C.' },
      { id:'sad001', name:'Saddle Supports — 2× Carbon Steel', type:'plate', material:'steel',
        dims:{w:700,h:250,d:120}, quantity:2, position:[0,-350,900], color:'#5a6070', mass_kg:38.0,
        standard:'Zick analysis to ASCE 7', notes:'Fixed saddle (hot end) + sliding saddle. Grout to base.' },
    ],
    bom_notes: 'Design P=15 bar / T=250°C shell side. Tube-side 10 bar / 150°C. Omitted: insulation jacket, bypass valve, pressure relief.'
  };
}

function _buildSuspension(text) {
  return {
    assembly: true,
    name: 'Front Suspension Assembly — Double Wishbone Coilover',
    description: 'Racing-grade front double-wishbone suspension. 4130 CrMo fabricated wishbones, Öhlins TTX damper, Eibach spring, Ø330 mm brake rotor, Brembo 4-pot radial-mount caliper.',
    total_mass_kg: 28.5,
    parts: [
      { id:'uwb001', name:'Upper Wishbone — 4130 CrMo Fabricated', type:'bracket', material:'steel',
        dims:{length:380,width:120,tube_od:28,tube_wt:2}, position:[0,200,0], color:'#4a5060', mass_kg:1.4,
        heat_treatment:'Normalise 880°C AC, stress relieve 600°C after weld',
        surface_finish:'Zinc phosphate + epoxy primer',
        notes:'Twin tube 28×2 mm 4130 CrMo. TIG welded. Heim joints M12 both ends.' },
      { id:'lwb001', name:'Lower Wishbone — 4130 CrMo Fabricated', type:'bracket', material:'steel',
        dims:{length:480,width:160,tube_od:32,tube_wt:2.5}, position:[0,80,0], color:'#4a5060', mass_kg:2.1,
        heat_treatment:'Normalise 880°C AC',
        notes:'Twin tube 32×2.5 mm. Front pivot accepts inboard push-rod load.' },
      { id:'kcl001', name:'Knuckle — 7075-T6 Billet CNC', type:'housing', material:'aluminum',
        dims:{w:160,h:220,d:100}, position:[320,140,0], color:'#9ab0c0', mass_kg:2.8,
        surface_finish:'Hard anodize 25 μm all over',
        tolerance:'Bearing bores H6. Taper-lock: ISO 7176',
        notes:'Integrated upright. Caliper mount radial. Heim joint mounts upper/lower.' },
      { id:'hub001', name:'Wheel Hub — 7075-T6 Billet', type:'flange', material:'aluminum',
        dims:{flange_diameter:160,bore:30,stud_pcd:112,num_studs:5},
        position:[330,140,0], color:'#9ab0c0', mass_kg:1.6,
        notes:'5×112 mm PCD. M12×1.5 wheel studs. Integrated ABS tone ring.' },
      { id:'wbr001', name:'Wheel Bearing — FAG 7518 Hub Unit DBLB', type:'ball_bearing', material:'steel',
        dims:{innerD:30,outerD:80,width:46}, position:[326,140,0], color:'#c8d8e0', mass_kg:0.88,
        standard:'ISO 15',
        notes:'Double-row angular contact. Integrated ABS encoder ring. Grease for life.' },
      { id:'coa001', name:'Coilover — Öhlins TTX36 Racing', type:'coil_over', material:'aluminum',
        dims:{extended_length:380,compressed_length:260,bore:36,spring_rate_Nmm:45},
        position:[100,180,0], color:'#f0c010', mass_kg:3.2,
        notes:'Piggyback reservoir. 30-click compression + 2-way rebound adj. Spring: Eibach 65 mm ID 200 mm 45 N/mm.' },
      { id:'bkrt001', name:'Brake Rotor — Two-Piece Ø330×28 mm', type:'brake_rotor', material:'cast_iron',
        dims:{outer_diameter:330,thickness:28,vane_height:12,num_vanes:36}, position:[330,140,0], color:'#5a5a5a', mass_kg:6.2,
        surface_finish:'Hat: anodise. Rotor: Brembo directional slot pattern',
        notes:'Directional vaned. Aluminium bell hat. Thermal isolator bushes.' },
      { id:'cal001', name:'Caliper — Brembo GP4-RX 4-Pot Radial', type:'housing', material:'aluminum',
        dims:{w:200,h:100,d:60,piston_diameter:34}, position:[310,100,0], color:'#d00000', mass_kg:1.42,
        notes:'4-piston monoblock. Radial mount. Sintered pads included.' },
      { id:'bjup001', name:'Upper Ball Joint — Heim M12 Grade 8', type:'ball_joint', material:'steel',
        dims:{shank_diameter:12,body_diameter:28,shank_length:28}, quantity:2,
        position:[300,200,0], color:'#8899aa', mass_kg:0.12,
        standard:'DIN 71802',
        notes:'PTFE-lined rod end. 12 mm M12×1.75 shank. MS14103 grade.' },
      { id:'bjlo001', name:'Lower Ball Joint — Press-in 4× Total', type:'ball_joint', material:'steel',
        dims:{shank_diameter:16,body_diameter:40}, quantity:2,
        position:[300,80,0], color:'#8899aa', mass_kg:0.22,
        notes:'Press-fit to lower wishbone. Grease nipple.' },
      { id:'tie001', name:'Tie Rod — 4130 CrMo + Heim Ends', type:'shaft', material:'steel',
        dims:{diameter:16,length:320}, position:[180,80,120], color:'#7a8a9a', mass_kg:0.48,
        notes:'Heim joints both ends for camber/toe adjustment.' },
    ],
    bom_notes: 'One corner assembly. Omitted: ARB link, steering rack mount, subframe, tyre.'
  };
}

function _buildWindTurbine(text) {
  return {
    assembly: true,
    name: 'Horizontal Axis Wind Turbine — 2 MW Class IIA',
    description: '2 MW HAWT. Rotor diameter 90 m, hub height 80 m, rated wind 13 m/s, 3-blade pitch-regulated. Doubly-fed induction generator. IEC 61400-1 Class IIA.',
    total_mass_kg: 290000,
    parts: [
      { id:'bl001', name:'Blade 1 — CFRP/GFRP 44 m Aerofoil', type:'rotor_blade', material:'carbon_fiber',
        dims:{length:44000,max_chord:3200,thickness:800}, position:[0,0,44000], color:'#eaeaea', mass_kg:7200,
        notes:'Root Ø2.0 m flanged. NACA 63-xxx profiles. Heating mat (de-ice). Individual pitch controlled.' },
      { id:'bl002', name:'Blade 2 — CFRP/GFRP 44 m', type:'rotor_blade', material:'carbon_fiber',
        dims:{length:44000,max_chord:3200,thickness:800}, position:[38000,-22000,0], color:'#eaeaea', mass_kg:7200 },
      { id:'bl003', name:'Blade 3 — CFRP/GFRP 44 m', type:'rotor_blade', material:'carbon_fiber',
        dims:{length:44000,max_chord:3200,thickness:800}, position:[-38000,-22000,0], color:'#eaeaea', mass_kg:7200 },
      { id:'hub001', name:'Hub Assembly — Spheroidal Iron GJS-400-15', type:'housing', material:'cast_iron',
        dims:{diameter:3200,length:3800}, position:[0,0,0], color:'#6a7070', mass_kg:18000,
        notes:'3-arm spherical hub. Pitch bearing 3× Ø2 m 4-point contact. Cast GJS-400-15.' },
      { id:'gb001', name:'Main Gearbox — 3-Stage Epicyclic 97:1', type:'gear', material:'steel',
        dims:{w:3800,h:2800,d:2600}, position:[0,0,-2000], color:'#5a6060', mass_kg:48000,
        notes:'1 planetary + 2 helical stages. Input: 12–22 RPM. Output: 1500 RPM. Oil bath forced lubrication.' },
      { id:'gen001', name:'Generator — 2 MW DFIG 4-Pole 690V', type:'housing', material:'steel',
        dims:{diameter:2200,length:2600}, position:[0,0,-5000], color:'#4a5060', mass_kg:38000,
        notes:'Doubly-fed asynchronous. 2 MW. Rotor slip rings. IGBT converter 690V. Efficiency 97%.' },
      { id:'mbs001', name:'Main Bearing — Double-Row Tapered Roller', type:'bearing', material:'steel',
        dims:{innerD:800,outerD:1120,width:400}, position:[0,0,-800], color:'#c8d8e0', mass_kg:3200,
        standard:'ISO 355',
        notes:'SKF CARB or FAG TAROL double-row spherical. Continuous grease feed.' },
      { id:'mfr001', name:'Machine Frame — Welded S355 Steel Fabrication', type:'beam', material:'steel',
        dims:{length:10000,width:4000,height:3000}, position:[0,0,-3000], color:'#5a6a7a', mass_kg:58000,
        notes:'Bedplate + mainframe. FEA to IEC 61400-1 fatigue DEL 20-year life.' },
      { id:'yaw001', name:'Yaw System — 4× Yaw Drive + Slewing Ring', type:'gear', material:'steel',
        dims:{diameter:4200,height:400}, position:[0,-1800,0], color:'#6a7070', mass_kg:12000,
        notes:'4× 5 kW yaw motors. Slewing ring Ø4.2 m 8-point contact. Brake caliper array.' },
      { id:'twr001', name:'Tower — Conical Steel Shell 80 m', type:'tube', material:'steel',
        dims:{base_diameter:4200,top_diameter:2800,height:80000,wall:22}, position:[0,-80000,0], color:'#8a9aaa', mass_kg:130000,
        notes:'3-section bolted flanges. Internal ladder, lift. IEC 61400-6. Galvanised inside.' },
      { id:'fnd001', name:'Foundation — Gravity Spread Footing', type:'plate', material:'concrete',
        dims:{diameter:16000,depth:3000}, position:[0,-83000,0], color:'#9a9a88', mass_kg:850000,
        notes:'C35/45 reinforced concrete. Post-tensioned anchor bolts. Refer civil engineer.' },
    ],
    bom_notes: 'Omitted: power converter, transformer, SCADA, MV cable, lightning protection, blade erosion tape.'
  };
}

function _buildBridge(text) {
  return {
    assembly: true,
    name: 'Steel Through-Truss Railway Bridge — 60 m Span',
    description: 'Warren through-truss railway bridge, 60 m span, 5 m gauge, designed for 250 kN axle load (HS20-44). Primary steel S355. HPS70W weathering steel for bottom chord.',
    total_mass_kg: 185000,
    parts: [
      { id:'btchd001', name:'Bottom Chord — 2× HPS70W Box Section', type:'ibeam', material:'steel',
        dims:{w:500,h:500,flange_t:30,web_t:20,length:60000}, quantity:2,
        position:[0,-500,0], color:'#a87040', mass_kg:28000,
        standard:'ASTM A709 HPS70W',
        notes:'Weathering steel. Primary tension chord. Camber 75 mm L/800.' },
      { id:'tpchd001', name:'Top Chord — 2× S355 Box Section', type:'ibeam', material:'steel',
        dims:{w:400,h:400,flange_t:25,web_t:18,length:60000}, quantity:2,
        position:[0,5500,0], color:'#6a7a8a', mass_kg:18000,
        standard:'EN 10025-2 S355',
        notes:'Compression chord. Section modulus per LTB calculation.' },
      { id:'vrtt001', name:'Vertical Posts — 10× S355 H-Section', type:'ibeam', material:'steel',
        dims:{flange_width:300,depth:500,flange_t:22,web_t:14,height:6000}, quantity:10,
        position:[0,0,0], color:'#6a7a8a', mass_kg:22000,
        standard:'EN 10025-2 S355 HEB 500',
        notes:'6 m height. Portal bracing between pairs at top.' },
      { id:'diag001', name:'Diagonal Members — 20× 300×200 RHS S355', type:'beam', material:'steel',
        dims:{w:300,h:200,wall_t:12,length:7000}, quantity:20,
        position:[0,2500,0], color:'#7a8a9a', mass_kg:30000,
        standard:'EN 10219 S355J2H',
        notes:'Warren diagonals alternating tension/compression. Bolted gusset connections.' },
      { id:'fstg001', name:'Deck Stringers — 12× IPE550 S355 @5m span', type:'ibeam', material:'steel',
        dims:{flange_width:210,depth:550,flange_t:17,web_t:11,length:6000}, quantity:12,
        position:[0,-400,0], color:'#7a8a9a', mass_kg:18000,
        standard:'EN 10025 IPE550', notes:'Stringers connect floor beams. ULS checked per EN 1993-1.' },
      { id:'flbm001', name:'Floor Beams — 6× HEB600 S355 Cross-Girders', type:'ibeam', material:'steel',
        dims:{flange_width:300,depth:600,flange_t:24,web_t:15,length:5000}, quantity:6,
        position:[0,-450,0], color:'#6a7a8a', mass_kg:14000,
        standard:'EN 10025 HEB600', notes:'Composite connection to deck slab. Shear studs ∅22@200.' },
      { id:'dck001', name:'Deck Slab — C35/45 Reinforced 220 mm', type:'plate', material:'concrete',
        dims:{w:5000,h:220,d:60000}, position:[0,-650,0], color:'#b0b0a0', mass_kg:16000,
        standard:'EN 1992-1',
        notes:'220 mm composite deck on profiled steel decking. B500B rebar. Expansion joints @30 m.' },
      { id:'grd001', name:'Railings — 2× BS7818 GRP + Steel Posts', type:'beam', material:'steel',
        dims:{h:1100,post_spacing:1800,length:60000}, quantity:2,
        position:[0,0,-2500], color:'#3a5a3a', mass_kg:3200,
        standard:'BS 7818',
        notes:'1.1 m high. Hot-dip galvanised posts M16 stud bolted.' },
      { id:'bng001', name:'Bearing — 2× POT Bearing 3000 kN (Fixed)', type:'bearing', material:'steel',
        dims:{length:600,width:500,height:120}, quantity:2,
        position:[0,-800,-29500], color:'#5a6a7a', mass_kg:960,
        standard:'EN 1337-5',
        notes:'Fixed pot bearing south abutment. Anchored to plinth.' },
      { id:'bng002', name:'Bearing — 2× POT Bearing 3000 kN (Guided Exp)', type:'bearing', material:'steel',
        dims:{length:700,width:500,height:130}, quantity:2,
        position:[0,-800,29500], color:'#5a6a7a', mass_kg:980,
        standard:'EN 1337-5',
        notes:'Guided expansion POT bearing north abutment. Allows 100 mm longitudinal movement.' },
    ],
    bom_notes: 'Design standard: BS EN 1993-2. Omitted: substructure, waterproofing, drains, ballast, rail fastenings, protective coatings system.'
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
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^[-\*]\s+(.+)$/gm, '• $1')
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>');
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
  '"What we know is a drop, what we don\'t know is an ocean." — Newton',
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
  loadExecution: _loadExecutionInUnifiedShell,
  cacheFeaResult: _cacheFeaResult,
  _onPartPick: (partId, partDefOverride) => {
    const part = _assembly && _assembly.parts && _assembly.parts.find(p => p.id === partId);
    if (part) _showPartProps(part, partDefOverride);
  },
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

})(typeof window !== 'undefined' ? window : global);
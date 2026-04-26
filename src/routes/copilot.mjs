
import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { getEnhancedSystemPrompt } from '../enki/enhancedPrompt.mjs';

// ─── Ollama LLM integration ──────────────────────────────────
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const DEFAULT_OLLAMA_MODELS = ['llama3.1:8b', 'llama3.1:70b', 'qwen2.5-coder:14b', 'llama3'];
const OLLAMA_MODELS = String(process.env.OLLAMA_MODELS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const OLLAMA_MODEL_CHAIN = OLLAMA_MODELS.length ? OLLAMA_MODELS : DEFAULT_OLLAMA_MODELS;
let ollamaStartupLogged = false;

function logOllamaStartupConfigOnce() {
  if (ollamaStartupLogged) return;
  ollamaStartupLogged = true;
  console.info(
    `[copilot] Ollama route configured: url=${OLLAMA_URL} default_model=${OLLAMA_MODEL} model_chain=${OLLAMA_MODEL_CHAIN.join(',')}`,
  );
}

// ─── Enki's full canonical system prompt ─────────────────────
// This is THE brain. Client can override per-request via req.body.system_prompt.
const ENKI_SYSTEM_DEFAULT = `You are Enki — UARE's hyper-precision autonomous engineering AI. You embody the combined mastery of a senior mechanical engineer, electrical engineer, manufacturing engineer, materials scientist, aerospace engineer, propulsion engineer, and systems integrator.

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

// ─── Design-request detector ─────────────────────────────────
const DESIGN_VERBS = /\b(design|build|create|generate|model|make|draw|show me|give me|construct|assemble|render|produce|fabricate|engineer)\b/i;
const DESIGN_NOUNS = /\b(rocket|spacecraft|engine|motor|arm|drone|pump|bracket|gear|shaft|assembly|vehicle|satellite|station|lander|capsule|booster|stage|nozzle|turbine|compressor|turbopump|manifold|valve|heat|robot|car|bridge|frame|structure|truss|beam|tower|wing|fuselage|turbo|turbocharger|hydraulic|actuator|cylinder|gearbox|suspension|chassis|spring|bearing|impeller|housing|enclosure|connector|pcb|board|circuit|heat exchanger|condenser|evaporator|radiator|cooler|intercooler|induction motor|pmsm|bldc|brushless motor|ac motor|dc motor|coilover|shock absorber|strut|damper|wishbone|control arm|mcpherson|double wishbone|quadcopter|quadrotor|multirotor|fpv|uav|robotic arm|manipulator|6.?dof|6.?axis|gearbox|transmission|reducer|differential|bevel gear|spur gear|helical gear|centrifugal pump|impeller pump|volute|4.?cylinder|v8|v6|inline|crankshaft|camshaft|piston engine|internal combustion|microcontroller|arduino|esp32|raspberry|motherboard|sbc|motor controller|wind turbine|windmill|hawt|offshore wind|onshore wind|turbine blade|truss bridge|warren truss|girder bridge|arch bridge|cable.stayed|aircraft|airplane|airfoil|aerofoil|spar|rib|airframe|fuselage|submarine|vessel|ship|hull|propeller shaft|rudder|ballast)\b/i;
function isDesignRequest(prompt) {
  return DESIGN_VERBS.test(prompt) || (DESIGN_NOUNS.test(prompt) && prompt.length > 15);
}

async function tryOllama(prompt, systemPrompt) {
  const sys = systemPrompt || getEnhancedSystemPrompt();

  // If this looks like a design request, append an explicit instruction
  let userContent = prompt;
  if (isDesignRequest(prompt)) {
    userContent = prompt + '\n\n[ENKI INSTRUCTION: Respond with engineering rationale AND a complete JSON assembly block as specified in your system prompt. Include every individual part, subsystem, sensor, fastener, and structural member you can. Aim for maximum part detail and realism.]';
  }

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   OLLAMA_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user',   content: userContent },
      ],
      stream:  false,
      options: {
        temperature:  0.82,
        top_p:        0.9,
        repeat_penalty: 1.2,
        seed: Date.now() % 2147483647,
        num_predict:  8192,
        num_ctx:      16384,
        stop:         ['<|im_end|>', '<|eot_id|>'],
      },
    }),
    signal: AbortSignal.timeout(120000),   // 2 min for large assemblies
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
  const data    = await resp.json();
  const content = (data.message?.content || data.response || '').trim();
  if (!content) throw new Error('Ollama returned empty content');

  // Extract inline suggestions/next-steps from the response
  const suggestions = [];
  const suggBlock = content.match(
    /(?:next steps?|suggested actions?|recommendations?|you can|try:?)\s*\n((?:\s*[-*•\d]+\.?\s+[^\n]+\n?)+)/i
  );
  if (suggBlock) {
    suggBlock[1].split('\n')
      .map(l => l.replace(/^\s*[-*•\d.]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .forEach(s => suggestions.push(s));
  }

  // Detect explicit warnings in the text
  const warnings = [];
  [...content.matchAll(/⚠[^\n]+|warning[:\s]+[^\n]+|caution[:\s]+[^\n]+/gi)]
    .slice(0, 3)
    .forEach(m => warnings.push(m[0].replace(/^⚠\s*/, '')));

  return { narrative: content, insights: [], warnings, suggestions };
}

function getOllamaModelCandidates(preferredModel = null) {
  const candidates = [];
  const pushUnique = (model) => {
    const next = String(model || '').trim();
    if (!next || candidates.includes(next)) return;
    candidates.push(next);
  };
  pushUnique(preferredModel);
  pushUnique(OLLAMA_MODEL);
  for (const model of OLLAMA_MODEL_CHAIN) pushUnique(model);
  if (!candidates.length) candidates.push('llama3');
  return candidates;
}

async function getOllamaHealth() {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: `Ollama tags HTTP ${resp.status}`,
        availableModels: [],
      };
    }
    const payload = await resp.json();
    const availableModels = Array.isArray(payload?.models)
      ? payload.models
          .map((entry) => String(entry?.name || '').trim())
          .filter(Boolean)
      : [];
    return { ok: true, error: null, availableModels };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Failed to contact Ollama',
      availableModels: [],
    };
  }
}

async function tryOllamaWithRetry(prompt, systemPrompt, preferredModel = null) {
  const health = await getOllamaHealth();
  if (!health.ok) {
    return {
      ok: false,
      reason: 'ollama_unreachable',
      detail: health.error,
      attempts: [],
      available_models: [],
      selected_model: null,
      health_ok: false,
    };
  }

  const requested = getOllamaModelCandidates(preferredModel);
  const availableSet = new Set(health.availableModels);
  const candidates = health.availableModels.length
    ? requested.filter((model) => availableSet.has(model))
    : requested;

  if (!candidates.length) {
    return {
      ok: false,
      reason: 'ollama_model_unavailable',
      detail: `Configured models not found in Ollama: ${requested.join(', ')}`,
      attempts: [],
      available_models: health.availableModels,
      selected_model: null,
      health_ok: true,
    };
  }

  const attempts = [];
  for (const model of candidates) {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt || getEnhancedSystemPrompt() },
            {
              role: 'user',
              content: isDesignRequest(prompt)
                ? `${prompt}\n\n[ENKI INSTRUCTION: Respond with engineering rationale AND a complete JSON assembly block as specified in your system prompt. Include every individual part, subsystem, sensor, fastener, and structural member you can. Aim for maximum part detail and realism.]`
                : prompt,
            },
          ],
          stream: false,
          options: {
            temperature: 0.82,
            top_p: 0.9,
            repeat_penalty: 1.2,
            seed: Date.now() % 2147483647,
            num_predict: 8192,
            num_ctx: 16384,
            stop: ['<|im_end|>', '<|eot_id|>'],
          },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        attempts.push({ model, ok: false, error: `HTTP ${response.status}` });
        continue;
      }

      const data = await response.json();
      const content = (data?.message?.content || data?.response || '').trim();
      if (!content) {
        attempts.push({ model, ok: false, error: 'empty response' });
        continue;
      }

      const suggestions = [];
      const suggBlock = content.match(
        /(?:next steps?|suggested actions?|recommendations?|you can|try:?)\s*\n((?:\s*[-*•\d]+\.?\s+[^\n]+\n?)+)/i,
      );
      if (suggBlock) {
        suggBlock[1].split('\n')
          .map((line) => line.replace(/^\s*[-*•\d.]+\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .forEach((entry) => suggestions.push(entry));
      }

      const warnings = [];
      [...content.matchAll(/⚠[^\n]+|warning[:\s]+[^\n]+|caution[:\s]+[^\n]+/gi)]
        .slice(0, 3)
        .forEach((match) => warnings.push(match[0].replace(/^⚠\s*/, '')));

      attempts.push({ model, ok: true, error: null });
      return {
        ok: true,
        enki: { narrative: content, insights: [], warnings, suggestions },
        reason: null,
        detail: null,
        attempts,
        available_models: health.availableModels,
        selected_model: model,
        health_ok: true,
      };
    } catch (error) {
      attempts.push({ model, ok: false, error: error?.message || 'request failed' });
    }
  }

  return {
    ok: false,
    reason: 'ollama_generation_failed',
    detail: attempts.length ? attempts[attempts.length - 1].error : 'No generation attempts made',
    attempts,
    available_models: health.availableModels,
    selected_model: null,
    health_ok: true,
  };
}

// ─── Material knowledge base ────────────────────────────────
const MATERIALS = {
  aluminium: { density: 2.7, youngs: 69, yield: 270, process: 'CNC machined or die-cast', note: 'excellent strength-to-weight ratio, good corrosion resistance, weldable' },
  aluminum:  { density: 2.7, youngs: 69, yield: 270, process: 'CNC machined or die-cast', note: 'excellent strength-to-weight ratio, good corrosion resistance, weldable' },
  steel:     { density: 7.85, youngs: 200, yield: 350, process: 'machined, stamped, or welded', note: 'high stiffness, magnetic, susceptible to corrosion without coating' },
  titanium:  { density: 4.5, youngs: 114, yield: 880, process: 'CNC machined — difficult to machine, high tooling cost', note: 'exceptional strength-to-weight, biocompatible, corrosion resistant' },
  carbon:    { density: 1.6, youngs: 70, yield: 600, process: 'layup or prepreg autoclave', note: 'anisotropic — strongest in fibre direction, brittle under impact' },
  peek:      { density: 1.32, youngs: 3.6, yield: 100, process: 'CNC or injection moulded', note: 'chemical resistant, lightweight, suitable for sterilisation' },
  nylon:     { density: 1.15, youngs: 3.0, yield: 70, process: 'injection moulded or SLS printed', note: 'moisture-absorbing, good fatigue resistance, low friction' },
  default:   { density: 2.7, youngs: 69, yield: 270, process: 'CNC machined', note: 'standard aerospace-grade aluminium alloy' },
};

function getMat(prompt) {
  const t = prompt.toLowerCase();
  for (const [k, v] of Object.entries(MATERIALS)) {
    if (k !== 'default' && t.includes(k)) return { name: k, ...v };
  }
  return { name: 'aluminium 6061', ...MATERIALS.default };
}

function extractDimensions(text) {
  const dims = [];
  const contextualPatterns = [
    { key: 'length', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:long|length)\b/gi },
    { key: 'width', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:wide|width)\b/gi },
    { key: 'height', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:tall|high|height)\b/gi },
    { key: 'wall_thickness', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:wall(?:s)?|wall thickness|thick(?:ness)?)\b/gi },
    { key: 'diameter', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:diameter|dia|od|i\.d\.|o\.d\.)\b/gi },
    { key: 'hole_diameter', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:hole(?:s)?|mounting holes?|bolt holes?)\b/gi },
    { key: 'bolt_circle', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:bolt circle|bcd|pcd|pitch circle(?: diameter)?)\b/gi },
    { key: 'hole_spacing', re: /(\d+(?:\.\d+)?)\s*mm\s*(?:hole spacing|spacing|pitch)\b/gi },
  ];

  for (const pattern of contextualPatterns) {
    for (const match of text.matchAll(pattern.re)) {
      dims.push({ key: pattern.key, value: parseFloat(match[1]), unit: 'mm' });
    }
  }

  if (dims.length) return dims;

  // match patterns like 120x40x25, 120×40×25, 120mm, 40 mm
  const cross = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:[x×]\s*(\d+(?:\.\d+)?))?/i);
  if (cross) {
    dims.push(
      { key: 'length', value: parseFloat(cross[1]), unit: 'mm' },
      { key: 'width',  value: parseFloat(cross[2]), unit: 'mm' },
    );
    if (cross[3]) dims.push({ key: 'height', value: parseFloat(cross[3]), unit: 'mm' });
  }
  const standalone = [...text.matchAll(/(\d+(?:\.\d+)?)\s*mm/gi)];
  if (!dims.length && standalone.length) {
    const keys = ['length', 'width', 'height', 'diameter'];
    standalone.slice(0, 4).forEach((m, i) => dims.push({ key: keys[i] || 'dim', value: parseFloat(m[1]), unit: 'mm' }));
  }
  return dims;
}

function featureFromWindow(windowText = '') {
  const cleaned = String(windowText || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const featureMatch = cleaned.match(/(?:for|on|at)\s+([a-z0-9 _\-/]{3,40})$/i);
  return featureMatch ? featureMatch[1].trim() : null;
}

function inferFitType(designation = '', windowText = '') {
  const text = `${designation} ${windowText}`.toLowerCase();
  if (/press|interference|shrink/.test(text)) return 'interference';
  if (/transition/.test(text)) return 'transition';
  if (/clearance|slip|running/.test(text)) return 'clearance';
  if (/[psru]\d/i.test(designation)) return 'interference';
  if (/[kmn]\d/i.test(designation)) return 'transition';
  return 'clearance';
}

function extractFits(text) {
  const fits = [];
  const designationRe = /\b([A-Z]\d\/[a-z]\d|[A-Z]\d\/[A-Z]\d|[a-z]\d\/[a-z]\d)\b/g;
  for (const match of text.matchAll(designationRe)) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, match.index + match[0].length + 40);
    const windowText = text.slice(start, end);
    fits.push({
      designation: match[1],
      type: inferFitType(match[1], windowText),
      feature: featureFromWindow(windowText),
      source: 'prompt',
    });
  }

  const fitWordRe = /(clearance|transition|interference|press|slip|running)\s+fit(?:\s+(?:for|on|at)\s+([a-z0-9 _\-/]{3,40}))?/gi;
  for (const match of text.matchAll(fitWordRe)) {
    const kind = String(match[1] || '').toLowerCase();
    fits.push({
      designation: null,
      type: kind === 'press' ? 'interference' : kind,
      feature: match[2] ? match[2].trim() : null,
      source: 'prompt',
    });
  }

  return fits;
}

function normalizeToleranceUnit(unit = '') {
  const raw = String(unit || '').toLowerCase();
  if (raw === 'um' || raw === 'μm' || raw === 'micron' || raw === 'microns') return { unit: 'μm', mm: 0.001 };
  return { unit: 'mm', mm: 1 };
}

function extractTolerances(text) {
  const tolerances = [];
  const plusMinusRe = /(±|\+\/-)\s*(\d+(?:\.\d+)?)\s*(mm|μm|um|micron(?:s)?)\b/gi;
  for (const match of text.matchAll(plusMinusRe)) {
    const unitInfo = normalizeToleranceUnit(match[3]);
    tolerances.push({
      kind: 'plus_minus',
      feature: null,
      value: Number(match[2]),
      unit: unitInfo.unit,
      value_mm: Number((Number(match[2]) * unitInfo.mm).toFixed(4)),
      source: 'prompt',
    });
  }

  const gdntRe = /(flatness|parallelism|perpendicularity|runout|concentricity|position|profile)\s*(?:of|to)?\s*(\d+(?:\.\d+)?)\s*(mm|μm|um|micron(?:s)?)\b/gi;
  for (const match of text.matchAll(gdntRe)) {
    const unitInfo = normalizeToleranceUnit(match[3]);
    tolerances.push({
      kind: String(match[1]).toLowerCase(),
      feature: null,
      value: Number(match[2]),
      unit: unitInfo.unit,
      value_mm: Number((Number(match[2]) * unitInfo.mm).toFixed(4)),
      source: 'prompt',
    });
  }

  const namedTolRe = /([a-z0-9 _\-/]{3,40})\s+tolerance\s*(?:of|to)?\s*(\d+(?:\.\d+)?)\s*(mm|μm|um|micron(?:s)?)\b/gi;
  for (const match of text.matchAll(namedTolRe)) {
    const unitInfo = normalizeToleranceUnit(match[3]);
    tolerances.push({
      kind: 'feature_tolerance',
      feature: match[1].trim(),
      value: Number(match[2]),
      unit: unitInfo.unit,
      value_mm: Number((Number(match[2]) * unitInfo.mm).toFixed(4)),
      source: 'prompt',
    });
  }

  return tolerances;
}

function extractHolePatterns(text) {
  const holePatterns = [];
  const boltCircleRe = /(\d+)\s*[x×]\s*(M?\d+(?:\.\d+)?)\s*(?:holes?|bolt holes?|mounting holes?)?\s*(?:on|@)\s*(\d+(?:\.\d+)?)\s*mm\s*(?:bolt circle|bcd|pcd|pitch circle(?: diameter)?)/gi;
  for (const match of text.matchAll(boltCircleRe)) {
    const nominal = String(match[2]);
    holePatterns.push({
      pattern: 'bolt_circle',
      hole_count: Number(match[1]),
      hole_diameter_mm: Number(nominal.replace(/^M/i, '')),
      thread_spec: nominal.startsWith('M') ? nominal : null,
      bolt_circle_mm: Number(match[3]),
      source: 'prompt',
    });
  }

  const simpleBoltCircleRe = /(\d+)\s*(?:holes?|bolts?)\s*(?:on|@)\s*(\d+(?:\.\d+)?)\s*mm\s*(?:bolt circle|bcd|pcd|pitch circle(?: diameter)?)/gi;
  for (const match of text.matchAll(simpleBoltCircleRe)) {
    if (match.index > 0 && /[A-Za-z]/.test(text[match.index - 1])) continue;
    holePatterns.push({
      pattern: 'bolt_circle',
      hole_count: Number(match[1]),
      hole_diameter_mm: null,
      thread_spec: null,
      bolt_circle_mm: Number(match[2]),
      source: 'prompt',
    });
  }

  const spacingRe = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\s*(?:holes?|mounting holes?)\s*(?:with|at)?\s*(\d+(?:\.\d+)?)\s*mm\s*(?:spacing|pitch)/gi;
  for (const match of text.matchAll(spacingRe)) {
    holePatterns.push({
      pattern: 'linear',
      hole_count: Number(match[1]),
      hole_diameter_mm: Number(match[2]),
      thread_spec: null,
      spacing_mm: Number(match[3]),
      source: 'prompt',
    });
  }

  return holePatterns;
}

function reduceDimensionList(dims = []) {
  return dims.reduce((acc, entry) => {
    if (!acc[entry.key]) acc[entry.key] = entry.value;
    return acc;
  }, {});
}

function unitScale(unit = 'mm') {
  const normalized = String(unit || 'mm').trim().toLowerCase();
  if (normalized === 'cm') return 10;
  if (normalized === 'm') return 1000;
  if (normalized === 'in' || normalized === 'inch' || normalized === 'inches') return 25.4;
  return 1;
}

function normalizePartDims(part = {}, defaultUnit = 'mm') {
  const source = Object.assign({}, part?.dims || {}, part?.dimensions_mm || {});
  const scale = unitScale(part?.unit || part?.units || defaultUnit);
  const toPositive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Number((n * scale).toFixed(4)) : fallback;
  };
  const x = toPositive(source.x ?? source.length ?? source.width ?? source.outer_diameter ?? source.diameter, 40);
  const y = toPositive(source.y ?? source.width ?? source.depth ?? source.outer_diameter ?? source.diameter, 30);
  const z = toPositive(source.z ?? source.height ?? source.thickness ?? source.length, 20);
  return { x, y, z };
}

function normalizePartPosition(part = {}, index = 0, defaultUnit = 'mm') {
  const scale = unitScale(part?.unit || part?.units || defaultUnit);
  if (Array.isArray(part?.position)) {
    return [
      Number((Number(part.position[0] || 0) * scale).toFixed(4)),
      Number((Number(part.position[1] || 0) * scale).toFixed(4)),
      Number((Number(part.position[2] || 0) * scale).toFixed(4)),
    ];
  }
  const tr = part?.transform_mm && typeof part.transform_mm === 'object' ? part.transform_mm : {};
  if (tr.x !== undefined || tr.y !== undefined || tr.z !== undefined) {
    return [
      Number((Number(tr.x || 0) * scale).toFixed(4)),
      Number((Number(tr.y || 0) * scale).toFixed(4)),
      Number((Number(tr.z || 0) * scale).toFixed(4)),
    ];
  }
  return [index * 70, 0, 0];
}

function enforceAssemblyPlanContract(plan = {}, prompt = '') {
  const input = plan && typeof plan === 'object' ? JSON.parse(JSON.stringify(plan)) : {};
  const warnings = [];
  const defaultUnit = input?.unit || input?.units || 'mm';
  const rawParts = Array.isArray(input.parts) ? input.parts : [];
  const seenIds = new Set();

  const parts = rawParts.map((part, index) => {
    const normalizedDims = normalizePartDims(part, defaultUnit);
    const idBase = String(part?.id || `${String(part?.type || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${index + 1}`);
    let id = idBase;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${idBase}_${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);
    return {
      ...part,
      id,
      type: String(part?.type || part?.shape || 'box').toLowerCase(),
      material: part?.material || getMat(prompt).name,
      dims: normalizedDims,
      dimensions_mm: normalizedDims,
      unit: 'mm',
      units: 'mm',
      position: normalizePartPosition(part, index, defaultUnit),
      quantity: Number.isFinite(Number(part?.quantity)) && Number(part.quantity) > 0 ? Number(part.quantity) : 1,
    };
  });

  if (!parts.length) {
    warnings.push('No parts found in generated plan. Injected a default primary body for CAD continuity.');
    parts.push({
      id: 'body_1',
      name: 'Primary body',
      type: 'housing',
      material: getMat(prompt).name,
      dims: { x: 120, y: 80, z: 50 },
      dimensions_mm: { x: 120, y: 80, z: 50 },
      position: [0, 0, 0],
      unit: 'mm',
      units: 'mm',
      quantity: 1,
    });
  }

  return {
    plan: {
      ...input,
      assembly: true,
      parts,
      unit: 'mm',
      units: 'mm',
    },
    warnings,
  };
}

const PROMPT_COMPONENT_LIBRARY = [
  { re: /shaft|axle|spindle/i, type: 'shaft', name: 'Drive Shaft', dims: { x: 28, y: 28, z: 180 }, material: 'steel_4340' },
  { re: /gear|pinion|sprocket/i, type: 'gear', name: 'Power Gear', dims: { x: 90, y: 90, z: 24 }, material: 'steel_4340' },
  { re: /bearing/i, type: 'bearing', name: 'Rolling Bearing', dims: { x: 52, y: 52, z: 16 }, material: 'steel' },
  { re: /housing|enclosure|case|shell/i, type: 'housing', name: 'Main Housing', dims: { x: 220, y: 140, z: 100 }, material: 'aluminum_6061_t6' },
  { re: /bracket|mount|clamp|fixture/i, type: 'bracket', name: 'Mount Bracket', dims: { x: 120, y: 70, z: 40 }, material: 'aluminum_6061_t6' },
  { re: /impeller|pump/i, type: 'impeller', name: 'Impeller Rotor', dims: { x: 110, y: 110, z: 30 }, material: 'stainless_316l' },
  { re: /valve|manifold|fluid|hydraulic|pneumatic/i, type: 'valve_body', name: 'Flow Control Body', dims: { x: 160, y: 90, z: 70 }, material: 'stainless_316l' },
  { re: /motor|actuator|servo/i, type: 'housing', name: 'Motor Can', dims: { x: 90, y: 90, z: 140 }, material: 'steel' },
  { re: /pcb|board|controller|sensor|electronics/i, type: 'pcb', name: 'Control PCB', dims: { x: 120, y: 80, z: 1.6 }, material: 'fr4' },
  { re: /heat|thermal|radiator|cooler|sink/i, type: 'heat_sink', name: 'Heat Sink Module', dims: { x: 140, y: 100, z: 55 }, material: 'aluminum_6061_t6' },
  { re: /wing|aircraft|airframe|aero/i, type: 'plate', name: 'Aero Skin Panel', dims: { x: 600, y: 220, z: 8 }, material: 'carbon_fiber' },
  { re: /bridge|truss|beam|tower/i, type: 'beam', name: 'Primary Beam', dims: { x: 800, y: 140, z: 120 }, material: 'steel' },
  { re: /rocket|nozzle|thruster|combustion/i, type: 'nozzle', name: 'Nozzle Body', dims: { x: 180, y: 180, z: 260 }, material: 'inconel_718' },
];

function generatePromptDrivenAssemblyPlan(prompt = '') {
  const t = String(prompt || '');
  if (!t.trim()) return null;

  const dims = reduceDimensionList(extractDimensions(t));
  const material = getMat(t).name;
  const selected = PROMPT_COMPONENT_LIBRARY.filter((entry) => entry.re.test(t));
  if (!selected.length) return null;

  const baseLength = Number(dims.length || dims.diameter || 220);
  const baseWidth = Number(dims.width || Math.max(60, baseLength * 0.55));
  const baseHeight = Number(dims.height || Math.max(40, baseLength * 0.4));

  const parts = [];
  parts.push({
    id: 'primary_body_1',
    name: 'Primary Body',
    type: 'housing',
    material,
    dims: { x: baseLength, y: baseWidth, z: baseHeight },
    position: [0, 0, baseHeight / 2],
    quantity: 1,
    notes: 'Prompt-derived envelope body.',
  });

  let offsetX = Math.max(80, baseLength * 0.7);
  selected.slice(0, 10).forEach((entry, index) => {
    parts.push({
      id: `${entry.type}_${index + 1}`,
      name: entry.name,
      type: entry.type,
      material: entry.material || material,
      dims: {
        x: Number((entry.dims.x * (baseLength / 220)).toFixed(3)),
        y: Number((entry.dims.y * (baseWidth / 120)).toFixed(3)),
        z: Number((entry.dims.z * (baseHeight / 80)).toFixed(3)),
      },
      position: [offsetX, index * 70, Number((entry.dims.z / 2).toFixed(3))],
      quantity: 1,
      notes: `Prompt-derived component matched by keyword: ${entry.type}.`,
    });
    offsetX += Math.max(70, entry.dims.x * 0.6);
  });

  for (let i = 0; i < 4; i += 1) {
    parts.push({
      id: `fastener_m8_${i + 1}`,
      name: `Fastener M8-${i + 1}`,
      type: 'bolt_hex',
      material: 'steel_4340',
      dims: { x: 8, y: 8, z: 30 },
      position: [Number((baseLength * 0.35).toFixed(3)), (i - 1.5) * (baseWidth * 0.22), Number((baseHeight * 0.5).toFixed(3))],
      quantity: 1,
      notes: 'Auto-generated mounting fastener for assembly completeness.',
    });
  }

  return {
    assembly: true,
    name: `${pickInventionTheme(t)} — prompt-derived assembly`,
    description: `Prompt-derived plan with ${parts.length} explicit components generated from request intent.`,
    total_mass_kg: Number((parts.length * 0.18).toFixed(3)),
    parts,
    bom_notes: `Generated from prompt intent: "${t.slice(0, 160)}"`,
  };
}

function inferPlanEnvelope(plan = {}) {
  const params = plan?.recipe?.parameters || {};
  if (params.bracket_length_mm || params.bracket_width_mm || params.bracket_height_mm) {
    return {
      length_mm: Number(params.bracket_length_mm || params.length_mm || 0) || null,
      width_mm: Number(params.bracket_width_mm || params.width_mm || 0) || null,
      height_mm: Number(params.bracket_height_mm || params.height_mm || 0) || null,
      wall_thickness_mm: Number(params.wall_thickness_mm || 0) || null,
      hole_diameter_mm: Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 0) || null,
      bolt_circle_mm: Number(params.bolt_circle_diameter_mm || 0) || null,
      hole_spacing_mm: Number(params.hole_spacing_mm || 0) || null,
    };
  }

  const parts = Array.isArray(plan?.parts) ? plan.parts : [];
  if (!parts.length) return {};
  const scored = parts.map((part) => {
    const dims = Object.assign({}, part?.dims || {}, part?.dimensions_mm || {});
    const x = Number(dims.x ?? dims.length ?? dims.width ?? dims.outer_diameter ?? dims.diameter ?? 0) || 0;
    const y = Number(dims.y ?? dims.width ?? dims.depth ?? dims.outer_diameter ?? dims.diameter ?? 0) || 0;
    const z = Number(dims.z ?? dims.height ?? dims.thickness ?? dims.length ?? 0) || 0;
    return { part, x, y, z, score: x * y * z };
  }).sort((a, b) => b.score - a.score);
  const primary = scored[0];
  if (!primary) return {};
  const partDims = Object.assign({}, primary.part?.dims || {}, primary.part?.dimensions_mm || {});
  return {
    length_mm: primary.x || null,
    width_mm: primary.y || null,
    height_mm: primary.z || null,
    wall_thickness_mm: Number(partDims.wall_thickness ?? partDims.wall_t ?? partDims.thickness ?? 0) || null,
    hole_diameter_mm: Number(partDims.hole_diameter_mm ?? partDims.hole_diameter ?? 0) || null,
    bolt_circle_mm: Number(partDims.bolt_circle ?? partDims.bcd ?? partDims.pcd ?? 0) || null,
    hole_spacing_mm: Number(partDims.hole_spacing ?? partDims.spacing ?? 0) || null,
  };
}

function buildDerivedCadSpec(prompt, plan = null) {
  const dimensions = reduceDimensionList(extractDimensions(prompt));
  const fits = extractFits(prompt);
  const tolerances = extractTolerances(prompt);
  const holePatterns = extractHolePatterns(prompt);
  const planEnvelope = inferPlanEnvelope(plan || {});
  const params = plan?.recipe?.parameters || {};
  const material = params.material_name || plan?.material_name || plan?.parts?.find?.((part) => part.material)?.material || getMat(prompt).name;
  const process = params.process || plan?.parts?.find?.((part) => part.process)?.process || null;
  const primaryHolePattern = holePatterns[0] || {};
  const primaryTolerance = tolerances.find((entry) => entry.kind === 'plus_minus') || tolerances[0] || null;
  const primaryFit = fits[0] || null;

  return {
    source: 'prompt_inference',
    material_name: material,
    process,
    dimensions: {
      length_mm: dimensions.length || planEnvelope.length_mm || null,
      width_mm: dimensions.width || planEnvelope.width_mm || null,
      height_mm: dimensions.height || planEnvelope.height_mm || null,
      wall_thickness_mm: dimensions.wall_thickness || planEnvelope.wall_thickness_mm || null,
      diameter_mm: dimensions.diameter || null,
      hole_diameter_mm: dimensions.hole_diameter || primaryHolePattern.hole_diameter_mm || planEnvelope.hole_diameter_mm || null,
      bolt_circle_mm: dimensions.bolt_circle || primaryHolePattern.bolt_circle_mm || planEnvelope.bolt_circle_mm || null,
      hole_spacing_mm: dimensions.hole_spacing || primaryHolePattern.spacing_mm || planEnvelope.hole_spacing_mm || null,
    },
    fits,
    tolerances,
    hole_patterns: holePatterns,
    normalized_parameters: {
      bracket_length_mm: dimensions.length || planEnvelope.length_mm || null,
      bracket_width_mm: dimensions.width || planEnvelope.width_mm || null,
      bracket_height_mm: dimensions.height || planEnvelope.height_mm || null,
      wall_thickness_mm: dimensions.wall_thickness || planEnvelope.wall_thickness_mm || null,
      bolt_hole_diameter_mm: dimensions.hole_diameter || primaryHolePattern.hole_diameter_mm || planEnvelope.hole_diameter_mm || null,
      bolt_circle_diameter_mm: dimensions.bolt_circle || primaryHolePattern.bolt_circle_mm || planEnvelope.bolt_circle_mm || null,
      hole_spacing_mm: dimensions.hole_spacing || primaryHolePattern.spacing_mm || planEnvelope.hole_spacing_mm || null,
      hole_count: primaryHolePattern.hole_count || null,
      hole_pattern_type: primaryHolePattern.pattern || null,
      fit_designation: primaryFit?.designation || null,
      fit_type: primaryFit?.type || null,
      tolerance_general_mm: primaryTolerance?.value_mm || null,
      material_name: material || null,
      process: process || null,
    },
  };
}

function applyDerivedCadSpecToPlan(plan = {}, derivedCadSpec = null) {
  if (!derivedCadSpec) return plan;
  const next = JSON.parse(JSON.stringify(plan || {}));
  const recipe = next.recipe && typeof next.recipe === 'object' ? next.recipe : {};
  const params = recipe.parameters && typeof recipe.parameters === 'object' ? recipe.parameters : {};
  const normalized = derivedCadSpec.normalized_parameters || {};
  next.recipe = {
    ...recipe,
    name: recipe.name || next.name || null,
    description: recipe.description || next.description || null,
    parameters: {
      ...params,
      ...Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null && value !== undefined)),
    },
  };
  next.derived_cad_spec = derivedCadSpec;
  return next;
}

function pickInventionTheme(text) {
  const t = text.toLowerCase();
  if (/bracket|mount|clamp|fixture|brace/.test(t)) return 'structural bracket / mounting hardware';
  if (/heat\s*sink|thermal|cooling|fin/.test(t)) return 'thermal management component';
  if (/gear|shaft|bearing|drivetrain/.test(t)) return 'drivetrain / power transmission component';
  if (/housing|enclosure|case|shell/.test(t)) return 'protective housing / enclosure';
  if (/satellite|aerospace|spacecraft|rocket/.test(t)) return 'aerospace structural component';
  if (/drone|uav|rotor|propeller/.test(t)) return 'unmanned aerial vehicle component';
  if (/sensor|pcb|module/.test(t)) return 'electronics mounting / sensor assembly';
  if (/valve|fluid|hydraulic|pneumatic/.test(t)) return 'fluid control component';
  return 'precision mechanical component';
}

function inferPromptIntent(prompt = '') {
  const t = String(prompt || '').toLowerCase();
  if (/^(hi|hello|hey|yo|greetings|sup|what'?s up)\b/.test(t)) return 'greeting';
  if (/^(how|what|why|explain|tell me|describe|can you|do you)\b/.test(t)) return 'explanation_request';
  if (isDesignRequest(prompt)) return 'design_request';
  if (/\b(export|download|save|get)\b/.test(t) && /\b(stl|step|obj|cad|model|file)\b/.test(t)) return 'export_request';
  if (/\b(stress|load|force|deflect|deform|factor|fea|fem|analyse|analyze|simulation)\b/.test(t)) return 'analysis_request';
  return 'general_request';
}

function buildConstraintHighlights(prompt = '') {
  const dimensions = extractDimensions(prompt);
  const fits = extractFits(prompt);
  const tolerances = extractTolerances(prompt);
  const holePatterns = extractHolePatterns(prompt);
  const highlights = [];
  if (dimensions.length) highlights.push(`${dimensions.length} dimensional constraint(s)`);
  if (fits.length) highlights.push(`${fits.length} fit requirement(s)`);
  if (tolerances.length) highlights.push(`${tolerances.length} tolerance requirement(s)`);
  if (holePatterns.length) highlights.push(`${holePatterns.length} hole pattern requirement(s)`);
  if (!highlights.length) highlights.push('No explicit fit/tolerance constraints detected');
  return { dimensions, fits, tolerances, holePatterns, highlights };
}

function buildFollowupQuestions(prompt = '', constraints = null) {
  const t = String(prompt || '').toLowerCase();
  const state = constraints || buildConstraintHighlights(prompt);
  const questions = [];
  if (!state.dimensions.length) questions.push('What envelope should I enforce (L x W x H in mm)?');
  if (!/\b(aluminum|aluminium|steel|stainless|titanium|inconel|peek|nylon|carbon|composite|cast iron)\b/.test(t)) {
    questions.push('Which material grade should be baseline?');
  }
  if (!state.tolerances.length) questions.push('Do you want a general tolerance class or explicit plus/minus values?');
  if (/\b(shaft|bearing|gear|journal|bore|fit|press)\b/.test(t) && !state.fits.length) {
    questions.push('Should shaft/bore interfaces be clearance, transition, or interference fits?');
  }
  return questions.slice(0, 3);
}

function uniqueList(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function safetyFactorNote(youngs, yield_, force = 120, area = 1000) {
  const stress = (force / area) * 1e3;  // MPa (rough)
  const sf = yield_ / stress;
  if (sf > 10) return `Safety factor is very high (≈${sf.toFixed(0)}×) — opportunity to reduce mass by up to 40% without compromising structural integrity.`;
  if (sf > 3)  return `Safety factor is comfortable (≈${sf.toFixed(1)}×) — design is conservative and suitable for production.`;
  return `Safety factor is tight (≈${sf.toFixed(1)}×) — recommend FEA validation before committing to tooling.`;
}

// ─── Fallback assembly plan generator (when Ollama not running) ────────────
function generateFallbackAssemblyPlan(prompt) {
  const t = prompt.toLowerCase();
  const promptDriven = generatePromptDrivenAssemblyPlan(prompt);
  if (promptDriven) return promptDriven;

  // ── Internal combustion engine / car engine ──────────────────────────────
  if (/\b(internal combustion|car engine|v8|v6|inline|four.?cylinder|piston engine|reciprocating)\b/.test(t) ||
      (/\b(engine)\b/.test(t) && /\b(car|auto|vehicle|combustion|petrol|gasoline|diesel)\b/.test(t))) {
    return {
      assembly: true,
      name: 'Inline-4 2.0L DOHC Petrol Engine — Short Block + Head Assembly',
      description: '2.0L DOHC 4-cylinder naturally-aspirated engine. Bore × stroke: 86 × 86 mm (square). CR 10.5:1. Max power ~120 kW @ 6500 RPM. Max torque 200 N·m @ 4500 RPM. Cast iron block, aluminium DOHC head.',
      total_mass_kg: 128.0,
      parts: [
        { id:'blk001', name:'Engine Block — Cast Iron', type:'engine_block', material:'cast_iron',
          dims:{width:340, height:260, depth:420, bore:86, stroke:86, num_cylinders:4},
          position:[0,0,0], color:'#5a6060', mass_kg:42.0,
          standard:'EN 1561 EN-GJL-250', revision:'C',
          surface_finish:'Ra 0.4 μm bore honed, Ra 1.6 μm deck face',
          tolerance:'Bore diameter ±0.008 mm (H7), deck flatness 0.05 mm',
          process:'casting', heat_treatment:'Stress relief 600°C 2h FC',
          coating:'Internal: manganese phosphate 5 μm. External: engine enamel',
          notes:'Grey iron EN-GJL-250. Siamesed bore design. Main bearing webs 5× (5-main). Crankshaft tunnel 57.000–57.019 mm (H7).' },
        { id:'crk001', name:'Crankshaft — Forged 4340 Steel', type:'crankshaft', material:'4340 steel',
          dims:{diameter:57, length:420, stroke:86, main_journal_dia:52, rod_journal_dia:48, num_throws:4},
          position:[0,-60,0], color:'#5a6a7a', mass_kg:12.5,
          standard:'SAE 4340 Q&T per AMS 6415', revision:'B',
          surface_finish:'Ra 0.2 μm journals (ground + superfinished)',
          tolerance:'Main journals: 52 k5 (52.002–52.013 mm)',
          process:'forging', heat_treatment:'Q&T to 42–48 HRC, induction hardened journals 58–62 HRC',
          coating:'None', ndt:'MPI 100% journals + fillets after grinding',
          notes:'Full counterbalanced. 8 counterweights. Shot peened fillets. Cross-drilled oil drillings.' },
        { id:'pst001', name:'Piston — Hypereutectic Aluminium', type:'piston', material:'2024-t3 aluminium',
          dims:{diameter:85.97, height:64, compression_height:32, ring_land_width:4.0},
          position:[0,80,0], color:'#9ab0c0', mass_kg:0.42, quantity:4,
          standard:'SAE J657', revision:'B',
          surface_finish:'Ra 0.8 μm skirt (diamond turned)',
          tolerance:'Piston-to-bore clearance 0.025–0.040 mm',
          process:'casting', heat_treatment:'T6 per AMS 2770',
          coating:'Skirt: Graphite-PTFE dry film 10 μm. Crown: hard anodize 20 μm',
          notes:'Hypereutectic Al-Si alloy. Offset pin bore +0.5 mm (anti-slap). Valve relief pockets.' },
        { id:'con001', name:'Connecting Rod — Forged H-Beam 4340', type:'con_rod', material:'4340 steel',
          dims:{length:145, big_end_bore:51.5, small_end_bore:22, beam_width:22},
          position:[0,40,0], color:'#6a7a8a', mass_kg:0.62, quantity:4,
          standard:'AMS 6415', revision:'B',
          surface_finish:'Ra 0.4 μm big-end bore',
          tolerance:'Big-end bore: 51.5 H6, small-end bore: 22 H7',
          process:'forging', heat_treatment:'Normalised + Q&T 38–42 HRC',
          ndt:'MPI 100% + dimensional check', notes:'H-beam forged. Fracture-split big end. ARP rod bolts (pre-applied moly lube).' },
        { id:'csh001', name:'Camshaft — Chilled Cast Iron (DOHC Intake)', type:'camshaft', material:'cast_iron',
          dims:{diameter:25, length:380, num_lobes:8, lobe_lift:9.2},
          position:[0,200,0], color:'#5a6060', mass_kg:2.8,
          standard:'EN 1561', revision:'A',
          surface_finish:'Ra 0.4 μm cam lobes (ground)',
          tolerance:'Journal ±0.010 mm, lobe profile ±0.025 mm',
          process:'casting', heat_treatment:'Chilled cast lobes, induction hardened 55–62 HRC',
          notes:'Intake cam. Duration 240° @ 1 mm lift. Max lift 9.2 mm. CNC cam lobe ground.' },
        { id:'csh002', name:'Camshaft — Exhaust', type:'camshaft', material:'cast_iron',
          dims:{diameter:25, length:380, num_lobes:8, lobe_lift:8.8},
          position:[0,220,0], color:'#5a6060', mass_kg:2.6,
          standard:'EN 1561', revision:'A',
          notes:'Exhaust cam. Duration 236° @ 1 mm lift. Max lift 8.8 mm.' },
        { id:'hd001', name:'Cylinder Head — Aluminium DOHC', type:'dohc_head', material:'6061-t6 aluminium',
          dims:{width:340, height:140, depth:420, num_valves:16, combustion_chamber_volume:42},
          position:[0,168,0], color:'#9ab0c0', mass_kg:18.0,
          standard:'ASTM B85 A356-T6', revision:'C',
          surface_finish:'Ra 0.8 μm combustion face, Ra 0.4 μm valve seats',
          tolerance:'Deck flatness 0.03 mm, valve guide bore 6 H7',
          process:'casting', heat_treatment:'T6 solution + ageing per AMS 2770',
          coating:'Hard anodize valve seats, bronze valve guides', temp_max_c:280,
          ndt:'Pressure test 3 bar air underwater, MPI deck face',
          notes:'Pent-roof combustion chambers. Integrated oil feed galleries. Variable valve timing cam tower.' },
        { id:'hg001', name:'Head Gasket — MLS 3-Layer Steel', type:'head_gasket', material:'316L stainless',
          dims:{width:340, depth:420, thickness:1.3, bore:87},
          position:[0,133,0], color:'#3a3a3a', mass_kg:0.18,
          standard:'OEM spec', revision:'A',
          surface_finish:'Embossed bead: Ra 0.4 μm',
          notes:'Multi-layer steel (MLS) 3-layer. 1.3 mm compressed. Fire ring stopper at each bore. Do not reuse.' },
        { id:'viv001', name:'Intake Valve — Inconel 751', type:'valve_intake', material:'inconel 718',
          dims:{head_diameter:33, stem_diameter:6, length:102},
          position:[0,180,60], color:'#9aaabb', mass_kg:0.068, quantity:8,
          standard:'SAE J1121', revision:'A',
          surface_finish:'Ra 0.4 μm stem, Ra 0.8 μm head',
          tolerance:'Stem 6 k5, guide clearance 0.020–0.042 mm',
          process:'forging', heat_treatment:'Solution treated + aged',
          notes:'Hollow sodium-filled valve optional for high output. Hard chrome stem.' },
        { id:'vex001', name:'Exhaust Valve — Nimonic 80A', type:'valve_exhaust', material:'inconel 718',
          dims:{head_diameter:28, stem_diameter:6, length:102},
          position:[0,180,-60], color:'#8a9aaa', mass_kg:0.062, quantity:8,
          standard:'SAE J1121', revision:'A', temp_max_c:870,
          notes:'Nimonic 80A for high exhaust temp. Stellite 6 face hardening. Sodium filled.' },
        { id:'sp001', name:'Spark Plug — NGK Iridium', type:'spark_plug', material:'304 stainless',
          dims:{diameter:14, length:26.5, thread_spec:'M14×1.25'},
          position:[0,200,0], color:'#aaaaaa', mass_kg:0.042, quantity:4,
          standard:'NGK ILZKR7B11', revision:'—',
          torque_nm:20, notes:'Iridium centre electrode 0.6 mm. Projected nose. Reach 26.5 mm. Gap 0.8 mm.' },
        { id:'oilp001', name:'Oil Pump — Gerotor', type:'gerotor_pump', material:'cast_iron',
          dims:{diameter:80, height:40, displacement_cc_rev:14},
          position:[-80,-120,0], color:'#5a6060', mass_kg:1.2,
          standard:'OEM', revision:'A',
          notes:'Gerotor type. Displacement 14 cc/rev. Relief valve set at 4.5 bar. Chain driven from crankshaft at 0.75:1.' },
        { id:'wtp001', name:'Water Pump — Centrifugal', type:'water_pump', material:'6061-t6 aluminium',
          dims:{diameter:120, height:80, impeller_diameter:80},
          position:[80,-80,0], color:'#9aaabb', mass_kg:1.8,
          notes:'Centrifugal. Belt driven. 80 mm die-cast impeller. Ceramic mechanical seal. Flow 80 L/min @ 3000 RPM.' },
      ],
      bom_notes: 'Inline-4 DOHC engine. Omitted: timing chain/belt, tensioners, alternator, A/C compressor, exhaust manifold, full wiring harness.'
    };
  }

  // ── Centrifugal pump ─────────────────────────────────────────────────────
  if (/\b(pump|centrifugal pump|impeller pump|volute|diffuser pump)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Centrifugal Pump Assembly — 50 kW / 200 m³/h',
      description: 'Single-stage end-suction centrifugal pump. Q=200 m³/h, H=45 m, P=50 kW, N=1450 RPM. Class ISO 5199, back-pull-out. 316L impeller for chemical duty.',
      total_mass_kg: 112.0,
      parts: [
        { id:'imp001', name:'Impeller — 316L Investment Cast', type:'impeller', material:'316L stainless',
          dims:{outer_diameter:320, inlet_diameter:180, width:52, num_blades:5},
          position:[0,0,0], color:'#9aaabb', mass_kg:8.4,
          standard:'ASTM A744 CF-8M', revision:'C',
          surface_finish:'Ra 1.6 μm flow passages (electropolished)',
          tolerance:'OD ±0.3 mm, balance G2.5 at 1450 RPM',
          process:'casting', heat_treatment:'Solution anneal 1050°C WQ',
          coating:'None — 316L CF-8M for corrosion resistance',
          notes:'Closed impeller. 5 backward-curved blades. Wear ring OD 185.00–185.03 mm.' },
        { id:'csg001', name:'Pump Casing — Volute, Cast Iron', type:'housing', material:'cast_iron',
          dims:{width:480, height:420, depth:340, discharge_nozzle_dn:150, suction_nozzle_dn:200},
          position:[0,0,0], color:'#5a6060', mass_kg:48.0,
          standard:'EN 1561 EN-GJL-250', revision:'B',
          surface_finish:'Ra 6.3 μm flow passages, Ra 1.6 μm seal faces',
          tolerance:'Seal bore H7, impeller clearance 0.3–0.5 mm',
          process:'casting', coating:'Internal: Belzona 1111 epoxy 2 mm. External: 2-coat epoxy primer',
          pressure_max_bar:10, fluid:'Process water / dilute acid',
          notes:'Spiral volute with tangential discharge. Back-pull-out design. Pressure rating PN10.' },
        { id:'shf001', name:'Pump Shaft — 316L Stainless', type:'shaft', material:'316L stainless',
          dims:{diameter:55, length:420, coupling_end_diameter:50, impeller_end_diameter:38},
          position:[0,0,0], color:'#9aaabb', mass_kg:5.6,
          standard:'ASTM A276 316L', revision:'A',
          surface_finish:'Ra 0.4 μm bearing seats (ground), Ra 0.8 μm seal area',
          tolerance:'Bearing seat: 55 k6, coupling: 50 h6',
          process:'turning', heat_treatment:'Stress relief 450°C 2h',
          ndt:'PT 100% + dimensional check' },
        { id:'slp001', name:'Mechanical Seal — John Crane Type 1', type:'lip_seal', material:'silicon carbide',
          dims:{shaft_diameter:55, oc_diameter:95, length:68},
          position:[0,0,60], color:'#888888', mass_kg:0.48,
          standard:'API 682 Arrangement 1', revision:'A',
          surface_finish:'Ra 0.05 μm seal faces (lapped)',
          tolerance:'Face flatness ≤2 helium light bands',
          notes:'Silicon carbide mating ring + rotary face. Double O-ring drive. API Plan 11 seal flush from discharge.' },
        { id:'brg001', name:'Inboard Bearing — 6312-2RS', type:'ball_bearing', material:'4340 steel',
          dims:{inner_diameter:60, outer_diameter:130, width:31},
          position:[0,0,80], color:'#c8d8e0', mass_kg:1.08,
          standard:'ISO 15 (6312)', revision:'—',
          tolerance:'Housing: H7 (Ø130 H7), shaft: k5 (Ø60 k5)',
          notes:'Deep groove. FAG 6312-2RS1/C3. Grease: Esso Unirex N3. Re-lube interval 2000 h.' },
        { id:'brg002', name:'Outboard Bearing — 6309-2RS', type:'ball_bearing', material:'4340 steel',
          dims:{inner_diameter:45, outer_diameter:100, width:25},
          position:[0,0,200], color:'#c8d8e0', mass_kg:0.62,
          standard:'ISO 15 (6309)', revision:'—',
          notes:'Angular contact optional for high thrust. Same grease as inboard.' },
        { id:'brk001', name:'Bearing Housing — Cast Iron', type:'housing', material:'cast_iron',
          dims:{width:220, height:200, depth:280},
          position:[0,0,140], color:'#5a6060', mass_kg:14.0,
          notes:'Grease nipple both ends. Oil level sight glass. Cast iron EN-GJL-200.' },
        { id:'cpl001', name:'Flexible Coupling — Jaw Type', type:'coupling', material:'7075-t6 aluminium',
          dims:{diameter:120, length:80, bore:50},
          position:[0,0,330], color:'#9ab0c0', mass_kg:1.8,
          standard:'DIN 740', revision:'A',
          notes:'Jaw type elastomeric. 95 Shore A polyurethane spider. Transmits 500 N·m. ±1° misalignment.' },
        { id:'bst001', name:'Baseplate — Welded Steel', type:'plate', material:'steel',
          dims:{width:900, height:50, depth:600},
          position:[0,-200,200], color:'#5a6a7a', mass_kg:28.0,
          standard:'ISO 3069 C-frame', revision:'A',
          notes:'Epoxy grouted to concrete plinth. Pump + motor common baseplate. 4 × M20 anchor bolts.' },
      ],
      bom_notes: 'Omitted: motor, coupling guard, pressure gauges, isolation valves, drain port plugs.'
    };
  }

  // ── Gearbox / transmission ───────────────────────────────────────────────
  if (/\b(gearbox|transmission|gear.*box|reducer|drive.*train|differential|bevel gear|spur gear)\b/.test(t)) {
    return {
      assembly: true,
      name: '2-Stage Helical Gearbox — Industrial Horizontal Split Case',
      description: 'Industrial 2-stage horizontal helical reducer. Input 1450 RPM, output 72.5 RPM, nominal 400 N·m, ratio 20:1. Explicit shafts, gear mesh layout, split housing halves, six bearings, three seals, and structural mounting feet.',
      total_mass_kg: 96.4,
      parts: [
        { id:'cs001', name:'Lower Housing — EN-GJL-250', type:'housing', material:'cast_iron',
          dims:{width:620, height:210, depth:500},
          position:[0,-95,75], color:'#646c72', mass_kg:34.0,
          standard:'EN 1561 EN-GJL-250', revision:'E',
          surface_finish:'Ra 1.6 μm bearing bores, Ra 3.2 μm split face',
          tolerance:'Bearing bores H7, split face flatness 0.04 mm',
          process:'casting', coating:'Internal: oil-resistant epoxy. External: primer + paint RAL 7035',
          notes:'Horizontal split lower case with oil sump, drain boss, and stiffening ribs.' },
        { id:'cs002', name:'Upper Housing Cover — EN-GJL-250', type:'housing', material:'cast_iron',
          dims:{width:620, height:170, depth:500},
          position:[0,95,75], color:'#707982', mass_kg:23.0,
          standard:'EN 1561 EN-GJL-250', revision:'E',
          process:'casting', coating:'Internal anti-foam coating',
          notes:'Upper clamshell cover with breather and inspection flange.' },
        { id:'gs001', name:'Split-Plane Gasket — PTFE', type:'gasket', material:'ptfe',
          dims:{width:620, depth:500, thickness:1.2},
          position:[0,0,75], color:'#efefef', mass_kg:0.14,
          standard:'ASME B16.21', notes:'Compressed PTFE sheet, laser cut to split profile.' },

        { id:'sh1001', name:'Input Shaft — 4340 Q&T', type:'shaft', material:'4340 steel',
          dims:{diameter:42, length:540},
          position:[0,0,-130], rotation:[0,0,90], color:'#8a96a8', mass_kg:4.8,
          standard:'ASTM A29 4340', surface_finish:'Ra 0.4 μm bearing seats', tolerance:'k5',
          notes:'Input coupling journal at LH side.' },
        { id:'sh2001', name:'Intermediate Shaft — 4340 Q&T', type:'shaft', material:'4340 steel',
          dims:{diameter:58, length:520},
          position:[0,0,30], rotation:[0,0,90], color:'#8794a6', mass_kg:6.4,
          standard:'ASTM A29 4340', notes:'Integral two-gear shaft for stage transfer.' },
        { id:'sh3001', name:'Output Shaft — 4340 Q&T', type:'shaft', material:'4340 steel',
          dims:{diameter:72, length:560},
          position:[0,0,280], rotation:[0,0,90], color:'#8390a0', mass_kg:9.1,
          standard:'ASTM A29 4340', notes:'Output flange side at RH side, keyed backup.' },

        { id:'g1p001', name:'Stage-1 Pinion — 18T Helical', type:'gear', material:'4340 steel',
          dims:{module:3, num_teeth:18, face_width:58, helix_angle:15, pitch_diameter:54, diameter:62, length:58},
          position:[-120,0,-130], color:'#77889a', mass_kg:1.4,
          standard:'ISO 1328-1 Class 6', revision:'C',
          surface_finish:'Ra 0.4 μm tooth flank (ground)',
          process:'grinding', heat_treatment:'Case carburized 58-62 HRC',
          notes:'LH helix, keyed fit on input shaft.' },
        { id:'g1w001', name:'Stage 1 Wheel — 72T Helical', type:'gear', material:'4340 steel',
          dims:{module:3, num_teeth:72, face_width:56, helix_angle:15, pitch_diameter:216, diameter:224, length:56},
          position:[-120,0,30], color:'#8395a8', mass_kg:8.7,
          standard:'ISO 1328-1 Class 6', revision:'C',
          surface_finish:'Ra 0.8 μm flank (hobbed+shaved)',
          heat_treatment:'Through-hardened 42-48 HRC', process:'milling',
          notes:'4:1 stage-1 mesh with input pinion.' },
        { id:'g2p001', name:'Stage 2 Pinion — 20T Helical', type:'gear', material:'4340 steel',
          dims:{module:5, num_teeth:20, face_width:76, helix_angle:12, pitch_diameter:100, diameter:108, length:76},
          position:[120,0,30], color:'#77889a', mass_kg:2.9,
          standard:'ISO 1328-1 Class 6', revision:'C',
          surface_finish:'Ra 0.4 μm flank (ground)',
          heat_treatment:'Case carburized 58-62 HRC', process:'grinding',
          notes:'5:1 stage-2 pinion on intermediate shaft.' },
        { id:'g2w001', name:'Output Wheel — 100T Helical', type:'gear', material:'4340 steel',
          dims:{module:5, num_teeth:100, face_width:70, helix_angle:12, pitch_diameter:500, diameter:512, length:70},
          position:[120,0,280], color:'#8fa2b6', mass_kg:16.8,
          standard:'ISO 1328-1 Class 6', revision:'C',
          surface_finish:'Ra 0.8 μm (hobbed+shaved)', heat_treatment:'Q&T 280-320 HB',
          notes:'Output wheel shrink-fit + key retention.' },

        { id:'brg_in_l', name:'Input Bearing LH — TRB 32308', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:40, outer_diameter:90, width:33},
          position:[-220,0,-130], color:'#c8d8e0', mass_kg:0.82, standard:'ISO 355' },
        { id:'brg_in_r', name:'Input Bearing RH — TRB 32308', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:40, outer_diameter:90, width:33},
          position:[220,0,-130], color:'#c8d8e0', mass_kg:0.82, standard:'ISO 355' },
        { id:'brg_mid_l', name:'Intermediate Bearing LH — TRB 32310', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:50, outer_diameter:110, width:42},
          position:[-220,0,30], color:'#c8d8e0', mass_kg:1.15, standard:'ISO 355' },
        { id:'brg_mid_r', name:'Intermediate Bearing RH — TRB 32310', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:50, outer_diameter:110, width:42},
          position:[220,0,30], color:'#c8d8e0', mass_kg:1.15, standard:'ISO 355' },
        { id:'brg_out_l', name:'Output Bearing LH — TRB 32314', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:70, outer_diameter:150, width:51},
          position:[-230,0,280], color:'#c8d8e0', mass_kg:2.4, standard:'ISO 355' },
        { id:'brg_out_r', name:'Output Bearing RH — TRB 32314', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:70, outer_diameter:150, width:51},
          position:[230,0,280], color:'#c8d8e0', mass_kg:2.4, standard:'ISO 355',
          notes:'Back-to-back arrangement with preload shim stack.' },

        { id:'seal_in', name:'Input Seal — DIN 3760 FKM 42x68x8', type:'lip_seal', material:'viton fkm',
          dims:{inner_diameter:42, outer_diameter:68, width:8},
          position:[-280,0,-130], color:'#1f1f1f', mass_kg:0.03, standard:'DIN 3760 A' },
        { id:'seal_mid', name:'Intermediate Seal — DIN 3760 FKM 58x82x8', type:'lip_seal', material:'viton fkm',
          dims:{inner_diameter:58, outer_diameter:82, width:8},
          position:[280,0,30], color:'#1f1f1f', mass_kg:0.04, standard:'DIN 3760 A' },
        { id:'seal_out', name:'Output Seal — DIN 3760 FKM 72x95x10', type:'lip_seal', material:'viton fkm',
          dims:{inner_diameter:72, outer_diameter:95, width:10},
          position:[280,0,280], color:'#1f1f1f', mass_kg:0.05, standard:'DIN 3760 A' },

        { id:'foot_fl', name:'Mounting Foot FL', type:'bracket', material:'cast_iron',
          dims:{width:70, height:45, depth:120}, position:[-220,-210,-130], color:'#616971', mass_kg:2.8 },
        { id:'foot_fr', name:'Mounting Foot FR', type:'bracket', material:'cast_iron',
          dims:{width:70, height:45, depth:120}, position:[220,-210,-130], color:'#616971', mass_kg:2.8 },
        { id:'foot_rl', name:'Mounting Foot RL', type:'bracket', material:'cast_iron',
          dims:{width:70, height:45, depth:120}, position:[-220,-210,280], color:'#616971', mass_kg:2.8 },
        { id:'foot_rr', name:'Mounting Foot RR', type:'bracket', material:'cast_iron',
          dims:{width:70, height:45, depth:120}, position:[220,-210,280], color:'#616971', mass_kg:2.8 },

        { id:'insp001', name:'Inspection Cover Plate', type:'plate', material:'steel',
          dims:{width:180, height:12, depth:140}, position:[0,190,75], color:'#8c949f', mass_kg:2.2,
          notes:'Top inspection/service access cover.' },
        { id:'vent001', name:'Breather Plug M20', type:'bolt_hex', material:'steel',
          dims:{diameter:20, length:30}, position:[120,210,230], color:'#4d4d4d', mass_kg:0.08 },
        { id:'drn001', name:'Drain Plug M20', type:'bolt_hex', material:'steel',
          dims:{diameter:20, length:26}, position:[180,-205,-30], color:'#4d4d4d', mass_kg:0.08 },
        { id:'lvl001', name:'Oil Level Plug M16', type:'bolt_hex', material:'steel',
          dims:{diameter:16, length:20}, position:[300,-40,30], color:'#5a5a5a', mass_kg:0.05 },

        { id:'hb001', name:'Housing Bolt M16×95', type:'bolt_hex', material:'4340 steel',
          dims:{diameter:16, length:95}, position:[-260,80,-120], color:'#444', mass_kg:0.12 },
        { id:'hb002', name:'Housing Bolt M16×95', type:'bolt_hex', material:'4340 steel',
          dims:{diameter:16, length:95}, position:[-260,80,270], color:'#444', mass_kg:0.12 },
        { id:'hb003', name:'Housing Bolt M16×95', type:'bolt_hex', material:'4340 steel',
          dims:{diameter:16, length:95}, position:[260,80,-120], color:'#444', mass_kg:0.12 },
        { id:'hb004', name:'Housing Bolt M16×95', type:'bolt_hex', material:'4340 steel',
          dims:{diameter:16, length:95}, position:[260,80,270], color:'#444', mass_kg:0.12 },
      ],
      bom_notes: 'Stage-1 center distance 160 mm, stage-2 center distance 250 mm. Oil bath ISO VG 220 with splash lubrication. Includes explicit bearings, seals, split housing halves, and service hardware. Omitted: motor adapter, coupling guard, external oil cooler loop.'
    };
  }

  // ── Robotic arm ──────────────────────────────────────────────────────────
  if (/\b(robot(ic)?\s*arm|manipulator|6.?dof|6.?axis|joint|servo.*arm|robot)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Robotic Arm — 6-DOF 5 kg Payload Industrial Manipulator',
      description: '6-axis serial robot arm. Payload 5 kg, reach 800 mm, repeatability ±0.02 mm. Servo-driven revolute joints with harmonic drive reducers. 7075-T6 aluminium links.',
      total_mass_kg: 22.0,
      parts: [
        { id:'base001', name:'Base — Anodised Aluminium', type:'housing', material:'7075-t6 aluminium',
          dims:{diameter:200, height:120},
          position:[0,0,0], color:'#c8d8e0', mass_kg:4.2,
          standard:'ISO 9283', revision:'B',
          surface_finish:'Ra 1.6 μm mating faces, hard anodize OD 25 μm',
          notes:'J1 (waist) rotation base. Through-hollow for cable management. 4× M10 mounting bolts.' },
        { id:'lnk1', name:'Link 1 — Shoulder', type:'beam', material:'7075-t6 aluminium',
          dims:{width:80, height:80, length:180},
          position:[0,120,0], color:'#c8d8e0', mass_kg:2.1,
          notes:'J2 shoulder pitch. Hollow square profile for cable routing. Hard anodize.' },
        { id:'lnk2', name:'Link 2 — Upper Arm', type:'beam', material:'7075-t6 aluminium',
          dims:{width:70, height:70, length:280},
          position:[0,240,0], color:'#c8d8e0', mass_kg:1.8,
          notes:'J3 elbow pitch. Wall thickness 6 mm. Lightening pockets machined.' },
        { id:'lnk3', name:'Link 3 — Forearm', type:'beam', material:'7075-t6 aluminium',
          dims:{width:60, height:60, length:240},
          position:[0,360,0], color:'#c8d8e0', mass_kg:1.2,
          notes:'J4 forearm roll. Circular section, 60 mm OD, 5 mm wall.' },
        { id:'lnk4', name:'Link 4 — Wrist Pitch', type:'housing', material:'7075-t6 aluminium',
          dims:{diameter:80, height:80},
          position:[0,460,0], color:'#c8d8e0', mass_kg:0.8,
          notes:'J5 wrist pitch. Integrated encoder mount.' },
        { id:'flng001', name:'Tool Flange — ISO 9283', type:'flange', material:'7075-t6 aluminium',
          dims:{diameter:100, height:20, bolt_circle:80, num_bolts:6},
          position:[0,540,0], color:'#c8d8e0', mass_kg:0.4,
          standard:'ISO 9283 end-effector flange', notes:'63 mm pitch circle diameter. M6 × 6 bolts.' },
        { id:'act001', name:'J1 Servo Drive — 400W PMSM', type:'custom', material:'4340 steel',
          dims:{diameter:80, length:120},
          position:[0,30,80], color:'#3a3a4a', mass_kg:1.8,
          notes:'Permanent magnet synchronous motor. 400W, 3000 RPM. EtherCAT servo amplifier integrated. Encoder 23-bit Endat 2.2.' },
        { id:'hd001', name:'Harmonic Drive Reducer — HD-20-100', type:'worm_drive', material:'4340 steel',
          dims:{outer_diameter:100, length:45, ratio:100},
          position:[0,60,0], color:'#5a5a6a', mass_kg:0.9,
          standard:'Harmonic Drive HDS series', quantity:6,
          notes:'Flexspline / circular spline / wave generator. Ratio 100:1. Zero backlash. Rated torque 80 N·m. 6× (one per joint).' },
        { id:'brg001', name:'Cross-Roller Bearing — INA CRBH10020', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:100, outer_diameter:140, height:20}, quantity:6,
          position:[0,100,0], color:'#c8d8e0', mass_kg:0.62,
          standard:'INA CRBH series', notes:'Cross-roller. High moment capacity. 6× (one per joint). Preloaded.' },
        { id:'enc001', name:'Encoder — 23-bit Absolute Optical', type:'custom', material:'aluminium',
          dims:{diameter:38, length:30}, quantity:6,
          position:[0,110,40], color:'#2a2a3a', mass_kg:0.12,
          standard:'Endat 2.2 / Heidenhain', notes:'Single-turn absolute, 23-bit resolution. ±0.01° accuracy. 6× (one per axis).' },
        { id:'cab001', name:'Signal + Power Cable Harness', type:'wire', material:'copper c110',
          dims:{diameter:10, length:2500},
          position:[0,300,50], color:'#ff8800', mass_kg:0.85,
          notes:'24-core + 4-core power (AWG 14) + shielded encoder lines. Routed through hollow links.' },
      ],
      bom_notes: 'Omitted: controller, teach pendant, end effector, cable management track, safety enclosure.'
    };
  }

  // ── Drone / UAV ──────────────────────────────────────────────────────────
  if (/\b(drone|uav|quadrotor|quadcopter|multirotor|unmanned|fpv|dji)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Quadcopter Drone Frame + Propulsion — 5" FPV Class',
      description: '5" freestyle/racing FPV quadcopter. 220 mm wheelbase, CFRP frame, 2306 motors, 30×30 FC/ESC stack. All-up weight ≈700 g. 4S LiPo, estimated 7 min flight time.',
      total_mass_kg: 0.68,
      parts: [
        { id:'frm001', name:'Main Frame — CFRP 3mm', type:'plate', material:'cfrp ud',
          dims:{width:200, height:6, depth:160},
          position:[0,0,0], color:'#1a1a1a', mass_kg:0.082,
          standard:'JHF HX220', revision:'A',
          surface_finish:'Machined CNC, edges deburred',
          notes:'T700/M30 CFRP 3 mm. H-frame geometry. Arm thickness 3 mm, body 3 mm.' },
        { id:'arm001', name:'Motor Arm FL — CFRP', type:'beam', material:'cfrp ud',
          dims:{width:16, height:6, length:100},
          position:[-100,0,100], color:'#1a1a1a', mass_kg:0.014, quantity:4,
          notes:'All 4 arms. Press-fit + M3 bolt attachment. CFRP arm tubes 16×10×100 mm.' },
        { id:'mot001', name:'Brushless Motor — 2306 2400KV', type:'custom', material:'7075-t6 aluminium',
          dims:{diameter:27.9, length:31.5},
          position:[-100,10,100], color:'#3a3a4a', mass_kg:0.031, quantity:4,
          standard:'T-Motor F60 Pro IV class', revision:'A',
          notes:'PMSM outrunner. 2306 stator. 2400KV. Max current 32A. 12N14P. Titanium shaft ∅5mm.' },
        { id:'prp001', name:'Propeller — 5148 Tri-Blade', type:'rotor_blade', material:'nylon',
          dims:{diameter:127, pitch:122, num_blades:3},
          position:[-100,15,100], color:'#222233', mass_kg:0.0065, quantity:4,
          standard:'HQProp 5148', notes:'PC+GF tri-blade. CW + CCW pairs. Balanced to <0.2g. Replace after any crash.' },
        { id:'esc001', name:'4-in-1 ESC — 45A BLHeli32', type:'pcb', material:'ptfe',
          dims:{width:30, height:7, depth:30},
          position:[0,15,0], color:'#2a4030', mass_kg:0.024,
          standard:'BLHeli_32 firmware', revision:'A',
          notes:'45A continuous per motor. DSHOT 600. Current sensing. 3–6S LiPo. 30×30 mm stack mount.' },
        { id:'fc001', name:'Flight Controller — F7 STM32', type:'pcb', material:'ptfe',
          dims:{width:30, height:6, depth:30},
          position:[0,22,0], color:'#2a3040', mass_kg:0.018,
          standard:'Betaflight F7 V3', revision:'A',
          notes:'STM32F7xx. IMU: MPU-6000. OSD: AT7456E. UART×6. I2C×2. SPI×3. 30×30 mm stack.' },
        { id:'bat001', name:'LiPo Battery — 4S 1500mAh', type:'housing', material:'ptfe',
          dims:{width:73, height:36, depth:37},
          position:[0,-20,0], color:'#33aa33', mass_kg:0.192,
          standard:'GNSS C-rating 100C', notes:'4S 14.8V nominal. 1500 mAh. 100C discharge = 150A peak. XT60 connector. ' },
        { id:'cam001', name:'FPV Camera — RunCam Phoenix 2', type:'housing', material:'aluminium',
          dims:{width:19, height:19, depth:22},
          position:[0,20,90], color:'#4a4a4a', mass_kg:0.019,
          notes:'1/3" CMOS sensor. 1200TVL. 140° FOV. OSD. FPV transmitter not included.' },
        { id:'vtx001', name:'Video Transmitter — 25–1000mW', type:'housing', material:'aluminium',
          dims:{width:25, height:10, depth:25},
          position:[0,25,-20], color:'#3a3a3a', mass_kg:0.008,
          notes:'5.8 GHz 40Ch. SmartAudio. Adjustable 25/200/600/1000 mW. TBS Unify Pro32 class.' },
        { id:'rx001', name:'RC Receiver — ExpressLRS 2.4GHz', type:'housing', material:'ptfe',
          dims:{width:12, height:5, depth:26},
          position:[0,18,-40], color:'#222233', mass_kg:0.006,
          notes:'ELRS 2.4 GHz. 500Hz link rate. <2 ms latency. Ceramic patch antenna.' },
      ],
      bom_notes: 'Omitted: GPS module, buzzer, LED strips, antenna tubes, prop guards, battery strap.'
    };
  }

  // ── Heat exchanger ───────────────────────────────────────────────────────
  if (/\b(heat exchanger|condenser|evaporator|radiator|cooler|intercooler|shell.*tube)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Shell-and-Tube Heat Exchanger — TEMA R Class / 500 kW',
      description: 'Fixed tube-sheet S&T heat exchanger. Shell side: cooling water 40 m³/h, 30→45°C. Tube side: process fluid 10 m³/h, 120→80°C. TEMA R class, ASME VIII Div.1.',
      total_mass_kg: 680.0,
      parts: [
        { id:'shl001', name:'Shell — CS Rolled & Welded', type:'cylinder', material:'304 stainless',
          dims:{diameter:500, length:2500, wall_thickness:8},
          position:[0,0,0], color:'#9aaabb', mass_kg:240.0,
          standard:'ASME VIII Div.1 + TEMA R', revision:'D',
          surface_finish:'Ra 3.2 μm ID, Ra 6.3 μm OD',
          tolerance:'Roundness ≤1.5 mm, straightness ≤2 mm/3 m',
          process:'machining', heat_treatment:'PWHT 620°C 1h (CS) — N/A for 304SS',
          test_pressure_bar:18, pressure_max_bar:12,
          ndt:'100% RT long seam, PT all welds',
          notes:'304 SS rolled plate, longitudinal SAW seam. Shell nozzles 4× DN100.' },
        { id:'tub001', name:'Heat Transfer Tubes — Cu-Ni 90/10', type:'tube', material:'cupronickel 90/10',
          dims:{outer_diameter:19.05, wall_thickness:1.65, length:2400},
          position:[0,0,0], color:'#d4a020', mass_kg:180.0, quantity:256,
          standard:'ASTM B111 C70600', revision:'A',
          surface_finish:'Ra 1.6 μm ID (drawn)',
          tolerance:'OD ±0.05 mm, wall ±8%',
          process:'extrusion', heat_treatment:'Annealed O61',
          notes:'256 tubes × 19.05×1.65 mm × 2400 mm. BWG 14. Triangular pitch 25.4 mm. Rolled into tube sheets.' },
        { id:'ts001', name:'Tube Sheet — Naval Brass C464', type:'plate', material:'copper c110',
          dims:{diameter:520, thickness:48},
          position:[0,0,0], color:'#d4a020', mass_kg:88.0, quantity:2,
          standard:'ASME II Part B SB-171', revision:'B',
          surface_finish:'Ra 1.6 μm tube bore faces',
          tolerance:'Tube hole ±0.025 mm, pitch ±0.1 mm',
          process:'machining', notes:'Naval brass UNS C46400. Fixed tube sheet, rolled joints. 256 holes on triangular 25.4 mm pitch.' },
        { id:'bfl001', name:'Baffle — Segmental 75% Cut', type:'plate', material:'304 stainless',
          dims:{diameter:494, thickness:6},
          position:[0,0,600], color:'#8899aa', mass_kg:8.4, quantity:6,
          notes:'Single segmental, 75% cut. Spacing 400 mm. Tie rods 6× ∅12 mm. Sealing strips at shell.' },
        { id:'flt001', name:'Front Head — Bonneted Type B', type:'dome', material:'304 stainless',
          dims:{diameter:500, height:300, wall_thickness:10},
          position:[0,0,-100], color:'#9aaabb', mass_kg:42.0,
          standard:'TEMA AES', notes:'TEMA Type B bonneted front head. DN150 pass partition baffle.' },
        { id:'flt002', name:'Rear Head — Fixed Type M', type:'dome', material:'304 stainless',
          dims:{diameter:500, height:250, wall_thickness:10},
          position:[0,0,2700], color:'#9aaabb', mass_kg:38.0,
          standard:'TEMA AES', notes:'Fixed rear head, U-tube option available.' },
        { id:'nz001', name:'Shell Nozzle DN100 PN16', type:'flange', material:'304 stainless',
          dims:{diameter:114.3, height:150, bolt_circle:180, num_bolts:8},
          position:[0,260,500], color:'#9aaabb', mass_kg:4.2, quantity:4,
          standard:'EN 1092-1 PN16', torque_nm:120, notes:'4× shell nozzles: 2× cooling water in/out, 2× vent/drain.' },
        { id:'ins001', name:'Thermal Insulation — Mineral Wool', type:'housing', material:'ptfe',
          dims:{diameter:580, length:2600, wall_thickness:50},
          position:[0,0,1200], color:'#ddccaa', mass_kg:18.0,
          notes:'50 mm mineral wool blanket on shell OD. Aluminium cladding 0.7 mm. k=0.035 W/mK.' },
      ],
      bom_notes: 'Omitted: saddle supports, tie rods, expansion joint (if needed), thermowell nozzles, pressure relief valve.'
    };
  }

  // ── Electric motor ───────────────────────────────────────────────────────
  if (/\b(electric motor|induction motor|pmsm|bldc|brushless|servo motor|ac motor|dc motor)\b/.test(t) ||
      (/\b(motor)\b/.test(t) && /\b(electric|induction|synchronous|asynchronous)\b/.test(t))) {
    return {
      assembly: true,
      name: 'IE3 Premium Efficiency Induction Motor — 22 kW 4-Pole 1480 RPM',
      description: 'IE3 cast iron 3-phase induction motor. 22 kW, 1480 RPM, 400V Δ / 690V Y, 50 Hz. Frame IEC 180L. IP55 / TEFC. Class F insulation. SKF bearings.',
      total_mass_kg: 148.0,
      parts: [
        { id:'frm001', name:'Frame — Cast Iron IEC 180L', type:'housing', material:'cast_iron',
          dims:{width:420, height:380, depth:560},
          position:[0,0,0], color:'#6a7070', mass_kg:62.0,
          standard:'IEC 60034-1 / IEC 60072-1', revision:'C',
          surface_finish:'Ra 1.6 μm bearing fits, Ra 3.2 μm foot faces',
          tolerance:'Bearing bore H6, foot flatness 0.1 mm',
          process:'casting', coating:'Primer + 2-coat epoxy RAL 7035, IP55',
          notes:'IEC 180L cast iron. Fins for TEFC cooling. 2 × M20 lifting eyes. CE marked. ATEX optional.' },
        { id:'rot001', name:'Rotor — Squirrel Cage, Silicon Steel', type:'custom', material:'a286 superalloy',
          dims:{diameter:255, length:320, num_bars:36, skew_angle:1},
          position:[0,0,0], color:'#c8d8e0', mass_kg:28.0,
          standard:'IEC 60034-1', revision:'A',
          surface_finish:'Ra 0.8 μm shaft seats (ground)',
          tolerance:'Dynamic balance G2.5 at 1800 RPM',
          process:'stamping', heat_treatment:'None (laminations)',
          notes:'0.5 mm silicon steel laminations, M800-50A. Die-cast aluminium cage. 1° skew for cogging reduction.' },
        { id:'sta001', name:'Stator — 36-Slot Winding', type:'custom', material:'copper c110',
          dims:{outer_diameter:310, inner_diameter:258, length:310, num_slots:36},
          position:[0,0,0], color:'#d4a020', mass_kg:38.0,
          standard:'IEC 60034-1', revision:'A',
          surface_finish:'VPI impregnated (vacuum pressure impregnation)',
          notes:'Class F (155°C). 2-layer lap winding. AWG 10 copper magnet wire, 0.15 mm enamel (Grade 2). VPI Class F resin.' },
        { id:'shf001', name:'Shaft — 4340 Alloy Steel', type:'shaft', material:'4340 steel',
          dims:{diameter:55, length:580, shaft_extension:110, keyway_width:16},
          position:[0,0,0], color:'#7a8a9a', mass_kg:8.4,
          standard:'IEC 60072-1 (D-end dimensions)', revision:'A',
          surface_finish:'Ra 0.4 μm bearing seats, Ra 1.6 μm keyway',
          tolerance:'D-end: 55 k6, N-end: 55 k6, key: 16 N9',
          process:'grinding', heat_treatment:'Q&T 32–38 HRC',
          ndt:'MPI 100% bearing fillets' },
        { id:'brg001', name:'Drive-End Bearing — SKF 6314-2RS', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:70, outer_diameter:150, width:35},
          position:[0,0,250], color:'#c8d8e0', mass_kg:2.1,
          standard:'ISO 15 (6314)', notes:'SKF 6314-2RS1/C3. Grease: SKF LGHT2. Pre-filled. Sealed both sides.' },
        { id:'brg002', name:'Non-Drive-End Bearing — SKF 6213-2RS', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:65, outer_diameter:120, width:23},
          position:[0,0,-250], color:'#c8d8e0', mass_kg:0.92,
          standard:'ISO 15 (6213)', notes:'Floating NDE bearing. Allows axial thermal expansion.' },
        { id:'fan001', name:'Cooling Fan — Glass-Filled PA', type:'custom', material:'nylon',
          dims:{diameter:280, height:60, num_blades:8},
          position:[0,0,-300], color:'#dddddd', mass_kg:0.8,
          notes:'TEFC external fan. GFN (30% glass-filled nylon). Keyed to shaft NDE. Flow 1.2 m³/s.' },
        { id:'cov001', name:'Fan Cover — Pressed Steel', type:'housing', material:'steel',
          dims:{diameter:320, height:120},
          position:[0,0,-360], color:'#aaaaaa', mass_kg:1.8,
          notes:'Sheet steel 1.5 mm. Powder coated. IP55 louvers.' },
        { id:'tb001', name:'Terminal Box — IP55 Die-Cast Al', type:'housing', material:'6061-t6 aluminium',
          dims:{width:140, height:100, depth:120},
          position:[0,200,100], color:'#9ab0c0', mass_kg:1.6,
          standard:'IEC 60034-1', notes:'IP55. 6-terminal board (U1 V1 W1 / U2 V2 W2). M20 cable gland. PE stud.' },
      ],
      bom_notes: 'Omitted: encoder/resolver, brake, PTC thermistors, foot-mount hardware, cable gland.'
    };
  }

  // ── PCB / electronics ────────────────────────────────────────────────────
  if (/\b(pcb|circuit board|electronics|microcontroller|arduino|esp32|raspberry|motherboard|sbc)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Motor Controller PCB — 3-Phase BLDC 48V / 30A',
      description: 'BLDC motor controller PCB for 48V / 30A application. STM32G4 MCU, 6× gate drivers, 3× half-bridge MOSFET stages, current sensing, CAN bus, USB-C. 100×80 mm FR4.',
      total_mass_kg: 0.085,
      parts: [
        { id:'pcb001', name:'PCB Substrate — FR4 4-Layer', type:'pcb', material:'ptfe',
          dims:{width:100, height:2.0, depth:80},
          position:[0,0,0], color:'#2a4a20', mass_kg:0.028,
          standard:'IPC Class 2 / IPC-A-600H', revision:'B',
          surface_finish:'ENIG (Ni 3–5 μm, Au 0.05–0.12 μm)',
          tolerance:'Trace width ±10 μm CNC, drill ±0.05 mm',
          notes:'FR4 Tg 150°C. 4 layers: sig/pwr/gnd/sig. 1 oz outer, 2 oz inner copper. IPC-2221A.' },
        { id:'mcu001', name:'STM32G474 MCU — LQFP64', type:'ic_smd', material:'silicon carbide',
          dims:{width:10, height:1.4, depth:10},
          position:[50,2,40], color:'#2a2a2a', mass_kg:0.0005,
          standard:'JEDEC LQFP64', revision:'A',
          notes:'ARM Cortex-M4F 170 MHz. 128KB SRAM, 512KB Flash. HRTIM for 3-phase FOC. 12-bit ADC 5 MSPS.' },
        { id:'drv001', name:'Gate Driver — DRV8353RS ×3', type:'ic_smd', material:'silicon carbide',
          dims:{width:6, height:1.2, depth:4},
          position:[20,2,60], color:'#2a2a2a', mass_kg:0.0003, quantity:3,
          standard:'JEDEC SOP-24', notes:'Texas Instruments DRV8353RS. 100V gate driver. 3.3A source/sink. SPI fault reporting. 3×.' },
        { id:'mos001', name:'MOSFET — IPT007N10N5 (Half-Bridge) ×6', type:'transistor', material:'silicon carbide',
          dims:{width:8, height:1.8, depth:8},
          position:[10,2,10], color:'#3a3a3a', mass_kg:0.004, quantity:6,
          standard:'Infineon TDSON-8', notes:'Infineon IPT007N10N5. 100V, 7 mΩ, 199A cont. Rth(j-c)=0.35°C/W. 6× for 3-phase bridge.' },
        { id:'cap001', name:'Bulk Cap — 470μF 100V Electrolytic', type:'capacitor', material:'aluminium',
          dims:{diameter:18, height:35.5},
          position:[80,2,20], color:'#4466aa', mass_kg:0.012, quantity:4,
          standard:'AEC-Q200', notes:'470 μF / 100V. Nichicon UHW series. 105°C. ESR 28 mΩ. 4× in parallel = 1880 μF bus cap.' },
        { id:'ind001', name:'Common-Mode Choke — 3-Phase', type:'inductor', material:'silicon carbide',
          dims:{width:20, height:16, depth:20},
          position:[10,2,70], color:'#5a5a6a', mass_kg:0.018,
          notes:'Common-mode choke. 3-phase 30A. Ferrite core Mn-Zn. Reduces EMI per CISPR 25.' },
        { id:'can001', name:'CAN Bus Transceiver — TJA1051', type:'ic_smd', material:'silicon carbide',
          dims:{width:4, height:1.2, depth:5},
          position:[90,2,60], color:'#2a2a2a', mass_kg:0.0001,
          standard:'ISO 11898-2', notes:'NXP TJA1051T. CAN FD capable, 5 Mbps. Split termination.' },
        { id:'con001', name:'XT60 Power Connector — 48V In', type:'connector', material:'nylon',
          dims:{width:24, height:16, depth:17},
          position:[0,2,80], color:'#ffaa00', mass_kg:0.014,
          standard:'XT60 / Amass', notes:'XT60H male. 60A continuous. Gold-plated contacts.' },
        { id:'con002', name:'Motor Connector — 3-Phase Output', type:'connector', material:'nylon',
          dims:{width:20, height:12, depth:20},
          position:[95,2,40], color:'#ff4400', mass_kg:0.006, quantity:3,
          notes:'Anderson SB50. 3× phase output. 50A rated per contact.' },
        { id:'usb001', name:'USB-C Connector — Programming Port', type:'connector_header', material:'4340 steel',
          dims:{width:9, height:3, depth:7},
          position:[0,2,0], color:'#888888', mass_kg:0.001,
          standard:'USB 3.2 Gen 1', notes:'USB-C receptacle. DFU bootloader access. Also 5V supply in.' },
      ],
      bom_notes: 'Omitted: decoupling capacitors, ferrite beads, signal LEDs, crystals, ESD protection diodes, programming header.'
    };
  }

  // ── Suspension assembly ──────────────────────────────────────────────────
  if (/\b(suspension|coilover|shock|strut|damper|wishbone|control arm|mcpherson|double wishbone)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Double Wishbone Suspension Corner — Front Left',
      description: 'Double wishbone front suspension corner. Race-tuned coilover, aluminium wishbones, 5° static camber, 2° caster, 0 mm scrub radius. Compatible with ISO 4130 subframe.',
      total_mass_kg: 18.4,
      parts: [
        { id:'uwb001', name:'Upper Wishbone — 7075-T6 Fabricated', type:'bracket', material:'7075-t6 aluminium',
          dims:{width:280, height:40, depth:80},
          position:[0,120,0], color:'#c8d8e0', mass_kg:0.88,
          standard:'FIA regulation TP030', revision:'C',
          surface_finish:'Ra 1.6 μm pivot bores, hard anodize 25 μm',
          tolerance:'Pivot bore ±0.01 mm, camber adjust ±0.5°',
          process:'machining', ndt:'PT 100% after machining',
          notes:'Forged 7075-T6. A-arm geometry. Ball joint cup threaded for camber shim adjustment.' },
        { id:'lwb001', name:'Lower Wishbone — 7075-T6 Forged', type:'bracket', material:'7075-t6 aluminium',
          dims:{width:380, height:50, depth:100},
          position:[0,30,0], color:'#c8d8e0', mass_kg:1.42,
          surface_finish:'Ra 1.6 μm pivot bores', tolerance:'±0.01 mm pivot bores',
          process:'forging', heat_treatment:'T6 per AMS 2770',
          notes:'Lower control arm, wider track. Front pivot anti-dive geometry 3°.' },
        { id:'col001', name:'Coilover — 3-Way Adjustable', type:'coil_over', material:'7075-t6 aluminium',
          dims:{diameter:60, length:350, spring_id:65, spring_rate:180},
          position:[50,100,0], color:'#9ab0c0', mass_kg:2.8,
          standard:'JRZ Suspension RS-series class', revision:'A',
          surface_finish:'Hard anodize reservoir, ground piston rod Ra 0.2 μm',
          tolerance:'Piston rod straightness 0.02 mm TIR',
          notes:'Monotube 3-way: low-speed compression, high-speed compression, rebound independent. 14 clicks each. MoTeC logging compatible.' },
        { id:'spr001', name:'Spring — Hyperco 7 kg/mm 65mm ID', type:'spring', material:'4340 steel',
          dims:{inner_diameter:65, wire_diameter:11, free_length:200, num_coils:7},
          position:[50,160,0], color:'#5a6a7a', mass_kg:0.62,
          standard:'SAE HS-795', notes:'Hyperco linear rate 7 kg/mm (686 N/mm). Chrome-silicon wire. Shot peened. Pre-set.' },
        { id:'hub001', name:'Upright / Hub Carrier — 7075-T6', type:'housing', material:'7075-t6 aluminium',
          dims:{width:160, height:200, depth:120},
          position:[0,80,0], color:'#c8d8e0', mass_kg:2.4,
          surface_finish:'Ra 0.8 μm bearing bore', tolerance:'Bearing bore: H6',
          process:'machining', heat_treatment:'T73 (stress-corrosion resistant)',
          ndt:'PT + dimensional check all bores',
          notes:'Integrated brake caliper mount. Wheel bearing bore 72 H6. Steering arm in-built.' },
        { id:'wb001', name:'Wheel Bearing — 72mm 4-Row Angular Contact', type:'bearing', material:'4340 steel',
          dims:{inner_diameter:38, outer_diameter:72, width:37},
          position:[0,80,60], color:'#c8d8e0', mass_kg:0.58,
          standard:'FAG 522720', notes:'4-row angular contact unit. 38 kN radial, 22 kN axial. Pre-loaded, sealed. Press-fit outer into upright.' },
        { id:'bj001', name:'Ball Joint — Upper Spherical', type:'ball_joint', material:'4340 steel',
          dims:{diameter:40, height:55, thread_spec:'M22×1.5'},
          position:[80,120,0], color:'#7a8a9a', mass_kg:0.22,
          standard:'DIN 71803', notes:'Heim joint (rod end) M22×1.5. RH thread. Aurora Bearing AM-M22. ±12° misalignment angle.' },
        { id:'bj002', name:'Ball Joint — Lower Spherical', type:'ball_joint', material:'4340 steel',
          dims:{diameter:50, height:65, thread_spec:'M24×1.5'},
          position:[80,30,0], color:'#7a8a9a', mass_kg:0.32,
          notes:'Heim joint M24×1.5. Higher load lower joint. Aurora Bearing AM-M24T.' },
        { id:'ab001', name:'Anti-Roll Bar Link', type:'rod_cap', material:'4340 steel',
          dims:{diameter:12, length:180},
          position:[100,80,0], color:'#7a8a9a', mass_kg:0.18,
          notes:'Drop link. Rose joints both ends M12. Adjustable length ±20 mm.' },
        { id:'brk001', name:'Brake Caliper — 4-Piston Monoblock', type:'housing', material:'7075-t6 aluminium',
          dims:{width:120, height:100, depth:80},
          position:[0,80,90], color:'#cc2222', mass_kg:1.8,
          notes:'AP Racing CP5200 class. 4-piston. 330 mm disc. Titanium caliper bolts M10×35.' },
        { id:'bkd001', name:'Brake Disc — 2-Piece Floating', type:'brake_rotor', material:'silicon carbide',
          dims:{outer_diameter:330, inner_diameter:160, height:28},
          position:[0,80,100], color:'#4a4a4a', mass_kg:2.8,
          standard:'Bell casting: A356-T6 Al. Ring: grey iron EN-GJL-250',
          notes:'330 mm floating. Grooved ring. 48 radial vanes. Aluminium bell carrier.' },
      ],
      bom_notes: 'Omitted: brake pads, brake lines, steering rack, tie rod, subframe, wheel, tyre.'
    };
  }

  // ── Rocket / propulsion ──────────────────────────────────────────────────
  if (/\b(rocket|spacecraft|satellite|stage|booster|lander|capsule|thruster|propulsion)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Liquid-Propellant Rocket Engine — 10 kN Thrust Class',
      description: 'LOX/LCH4 pressure-fed rocket engine. Thrust: 10 kN, Isp_vac: 320s, Isp_sl: 280s, Pc: 20 bar, Pe: 0.8 bar, nozzle AR 25:1. Chamber O/F ratio 3.4:1. Film-cooled, metallic chamber wall with copper liner.',
      total_mass_kg: 18.5,
      parts: [
        {
          id:'cc001', name:'Combustion Chamber — Inconel 718', type:'dome', material:'inconel 718',
          dims:{diameter:120, height:200, wall_thickness:4.2, liner_thickness:2.0, throat_diameter:38},
          position:[0,200,0], color:'#8899aa', mass_kg:2.8,
          standard:'AMS 5663 (IN718)', revision:'C',
          surface_finish:'Ra 1.6 μm ID (machined), Ra 3.2 μm OD', tolerance:'ID ±0.025 mm, OD ±0.05 mm',
          process:'machining', heat_treatment:'AMS 2770 H/T at 720°C 8h + 620°C 8h, aged',
          coating:'Internal: Cu liner EB-brazed. External: Nickel flash 8 μm',
          temp_max_c:1050, temp_min_c:-196, pressure_max_bar:24,
          ndt:'RT + FPI (ASTM E1417) 100% on all surfaces',
          material_cert:'EN 10204 3.1 MTR, DFAR material source traceability',
          fluid:'LOX + LCH4 combustion products',
          test_pressure_bar:36,
          notes:'Inconel 718, AMS 5663. Copper cold-wall liner EB-brazed at 820°C. Film cooling holes 0.8 mm dia × 240 off on 3 rows. Roughness measurements mandatory per drawing.',
          bom_notes:'Flight-critical. Proof test 1.5× MEOP before acceptance.'
        },
        {
          id:'nz001', name:'Nozzle — Inconel 718 Bell Contour', type:'nozzle', material:'inconel 718',
          dims:{exit_diameter:220, height:380, throat_diameter:38, wall_thickness:2.5, entry_half_angle:30, exit_half_angle:10},
          position:[0,0,0], color:'#7a8a9a', mass_kg:3.2,
          standard:'AMS 5663 (IN718)', revision:'B',
          surface_finish:'Ra 0.8 μm ID (lapped), Ra 3.2 μm OD',
          tolerance:'Throat ±0.01 mm, contour profile ±0.1 mm',
          process:'machining', heat_treatment:'AMS 2770, aged same as CC',
          coating:'Oxidation barrier TBC 0.1 mm YSZ optional for extended use',
          temp_max_c:900, pressure_max_bar:22,
          ndt:'100% UT for wall thickness, FPI all welds',
          test_pressure_bar:30,
          notes:'Rao 80% bell contour. AR 25:1. Throat 38 mm dia. Regen cooling channels 1.5×2 mm, 120 off, closed by electroformed outer jacket.',
          bom_notes:'Integral with chamber weld. Weld class A per AWS D17.1.'
        },
        {
          id:'inj001', name:'Injector Plate — OFO Triplet Pattern', type:'plate', material:'inconel 625',
          dims:{diameter:110, height:15, num_elements:72, lox_port_diameter:1.2, fuel_port_diameter:0.9},
          position:[0,410,0], color:'#9aaabb', mass_kg:0.85,
          standard:'AMS 5666 (IN625)', revision:'D',
          surface_finish:'Ra 0.4 μm face (lapped to seal)', tolerance:'Port dia ±0.005 mm, pitch ±0.05 mm',
          process:'edm', heat_treatment:'Stress relief 870°C 1h AC',
          coating:'None — LOX compatibility checked',
          temp_max_c:400, pressure_max_bar:25,
          ndt:'Flow-check each element ±2% vs nominal, FPI 100%',
          notes:'72 element OFO triplet injector. LOX ports 1.2 mm, fuel ports 0.9 mm. Face drilled EDM. Manifold passages 4 mm dia. Designed for Cd=0.82 discharge coefficient.',
          torque_nm:45, tighten_seq:'Star pattern 25%→50%→75%→100% in 4 passes'
        },
        {
          id:'vv001', name:'LOX Main Valve — Ball Type', type:'valve_body', material:'316L stainless',
          dims:{diameter:25, height:80, bore:25, cv:18},
          position:[-60,380,0], color:'#aabbcc', mass_kg:0.35,
          standard:'ISO 17292 (ball valve)', revision:'A',
          surface_finish:'Ra 0.8 μm bore', tolerance:'Bore ±0.025 mm',
          process:'machining', coating:'Passivated per ASTM A967',
          temp_min_c:-196, temp_max_c:120, pressure_max_bar:30,
          fluid:'LOX', seal_type:'PTFE seat', leak_test:'Helium 1×10⁻⁸ mbar·l/s',
          notes:'Cryogenic-rated. PTFE seat and stem seal. 90° quarter-turn. Fire-tested per API 607.',
          torque_nm:8
        },
        {
          id:'vv002', name:'Fuel Main Valve — Ball Type', type:'valve_body', material:'316L stainless',
          dims:{diameter:20, height:70, bore:20, cv:14},
          position:[60,380,0], color:'#aabbcc', mass_kg:0.28,
          standard:'ISO 17292', revision:'A',
          surface_finish:'Ra 0.8 μm bore', process:'machining',
          temp_min_c:-80, temp_max_c:120, pressure_max_bar:30,
          fluid:'LCH4', seal_type:'PTFE seat', torque_nm:6,
          notes:'LCH4 (LNG) rated. Same design as LOX valve but sized for lower flow.'
        },
        {
          id:'ig001', name:'Igniter — TEA/TEB Spark Torch', type:'housing', material:'304 stainless',
          dims:{diameter:22, height:60, orifice_diameter:2.0},
          position:[0,360,40], color:'#cc8833', mass_kg:0.12,
          standard:'MIL-I-8500', revision:'A',
          process:'machining', coating:'Passivated',
          temp_max_c:400, pressure_max_bar:22,
          notes:'Single-use pyrotechnic igniter option or reusable TEA/TEB pilot. Spark gap 1.5 mm. GPM spec requires minimum 3 ignition attempts successful.',
          ndt:'Hydro test 36 bar'
        },
        {
          id:'th001', name:'Gimbal Ring — Ti-6Al-4V ELI', type:'flange', material:'titanium gr5',
          dims:{diameter:180, height:25, bolt_circle:160, num_bolts:12},
          position:[0,200,0], color:'#9ab0c8', mass_kg:0.65,
          standard:'AMS 4928 (Ti-6Al-4V ELI)', revision:'B',
          surface_finish:'Ra 1.6 μm mating faces',
          tolerance:'Flatness 0.05 mm, bore ±0.05 mm',
          process:'machining', heat_treatment:'SR 540°C 4h',
          notes:'3-axis gimbal pivot ring. ±7° travel. Actuated by 2 linear servos. Yoke interface on ±X axis.',
          torque_nm:42, tighten_seq:'Cross-pattern, 3 passes'
        },
        {
          id:'b001', name:'Flange Bolt M10×40 A4-80', type:'bolt_hex', material:'316L stainless',
          dims:{diameter:10, length:40, thread_pitch:1.5, head_size:16},
          position:[90,200,0], color:'#cccccc', mass_kg:0.028,
          standard:'ISO 4762 / DIN 912', quantity:8, revision:'—',
          surface_finish:'Passivated', torque_nm:42,
          tighten_seq:'Star pattern, 30%→60%→100% in 3 passes, re-torque after first thermal cycle',
          notes:'Class A4-80. Torque per VDI 2230. MoS₂ lubricant factor k=0.17.',
          thread_spec:'M10×1.5 — 6H/6g', loctite:'None — thermal cycling prevents'
        },
        {
          id:'b002', name:'Flange Bolt M10×40 A4-80', type:'bolt_hex', material:'316L stainless',
          dims:{diameter:10, length:40, thread_pitch:1.5}, position:[-90,200,0], color:'#cccccc',
          mass_kg:0.028, standard:'ISO 4762', quantity:8, torque_nm:42
        },
        {
          id:'b003', name:'Flange Bolt M10×40 A4-80', type:'bolt_hex', material:'316L stainless',
          dims:{diameter:10, length:40}, position:[0,200,90], color:'#cccccc',
          mass_kg:0.028, standard:'ISO 4762', quantity:8, torque_nm:42
        },
        {
          id:'b004', name:'Flange Bolt M10×40 A4-80', type:'bolt_hex', material:'316L stainless',
          dims:{diameter:10, length:40}, position:[0,200,-90], color:'#cccccc',
          mass_kg:0.028, standard:'ISO 4762', quantity:8, torque_nm:42
        },
        {
          id:'tc001', name:'Thermocouple Boss — K-type', type:'housing', material:'inconel 625',
          dims:{diameter:8, height:30, port_thread:'M8×1'},
          position:[0,100,65], color:'#aaaaaa', mass_kg:0.02,
          standard:'IEC 60584 (K-type TC)', revision:'A',
          surface_finish:'Ra 1.6 μm', tolerance:'±0.5 mm position',
          notes:'Welded boss for 1/16" TC. 4 off. Measures wall temp at throat, mid-chamber, injector face, nozzle exit.',
          process:'turning', coating:'None'
        },
        {
          id:'pt001', name:'Pressure Transducer Port', type:'housing', material:'304 stainless',
          dims:{diameter:10, height:25, port_thread:'M10×1.5'},
          position:[0,300,65], color:'#999999', mass_kg:0.018,
          standard:'DIN 16086', revision:'A',
          notes:'3 off. Kistler 4043A or equivalent. 0–40 bar, 10 kHz response. Flush diaphragm for propellant compatibility.',
          process:'turning', temp_max_c:300
        },
      ],
      bom_notes: 'Simplified digital twin. Omitted: regenerative cooling manifolds, propellant lines, actuators, purge valves, flex lines, gimbal actuators, thrust frame.'
    };
  }

  // Turbocharger
  if (/\b(turbo|turbocharger|compressor wheel|turbine)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Turbocharger Assembly — GTX3076R Class',
      description: 'Centrifugal turbocharger, 60 mm turbine / 54 mm compressor wheel, journal bearings, max 200,000 RPM, max 1.2 bar boost, 600°C turbine inlet.',
      total_mass_kg: 4.2,
      parts: [
        {
          id:'cw001', name:'Compressor Wheel — 7075-T6 Billet', type:'impeller', material:'7075-t6 aluminium',
          dims:{diameter:54, height:50, inducer_diameter:36, exducer_diameter:54, num_blades:11, blade_angle_deg:35},
          position:[0,60,0], color:'#c8d8e0', mass_kg:0.12,
          standard:'SAE J1490', revision:'B',
          surface_finish:'Ra 0.8 μm all aerofoil surfaces',
          tolerance:'Tip diameter ±0.05 mm, balance grade G0.4',
          process:'milling', heat_treatment:'T6 per AMS 2770',
          coating:'Hard anodize 15 μm', temp_max_c:150,
          notes:'Billet machined on 5-axis CNC. Dynamic balance to G0.4 at 150,000 RPM. Each blade individually profiled.',
          ndt:'Visual + dye penetrant on all blades'
        },
        {
          id:'tw001', name:'Turbine Wheel — Inconel 713C Investment Cast', type:'turbine_blade', material:'inconel 718',
          dims:{diameter:60, height:44, num_blades:11, entry_angle_deg:70, exit_angle_deg:30},
          position:[0,-60,0], color:'#9aaab8', mass_kg:0.21,
          standard:'AMS 5391 (IN713C)', revision:'C',
          surface_finish:'Ra 1.6 μm aerofoil', tolerance:'Balance G0.4 at 200,000 RPM',
          process:'casting', heat_treatment:'2-stage ageing per spec',
          coating:'TBC optional for EGT >900°C', temp_max_c:1050,
          notes:'Investment cast, solution treated. Integral inducer. Friction-welded to shaft.',
          ndt:'100% FPI, 20% RT'
        },
        {
          id:'sh001', name:'Shaft — 16MnCr5 Case-Hardened', type:'shaft', material:'4340 steel',
          dims:{diameter:12, length:90, journal_diameter:11.994, thread_spec:'M12×1.25'},
          position:[0,0,0], color:'#7a8a9a', mass_kg:0.085,
          standard:'EN 10084', revision:'A',
          surface_finish:'Ra 0.2 μm journals (ground)',
          tolerance:'Journal OD: 11.994–11.988 mm (ISO k5)',
          process:'grinding', heat_treatment:'Case carburize 0.8–1.2 mm case, core 35–40 HRC',
          coating:'None', temp_max_c:300,
          notes:'Ground journals. Runout < 0.005 mm TIR. Friction-welded to turbine wheel.',
          ndt:'MPI journals after grinding'
        },
        {
          id:'ch001', name:'Center Bearing Housing — Compacted Graphite Iron', type:'housing', material:'cast_iron',
          dims:{width:120, height:80, depth:100, oil_bore_diameter:4.0},
          position:[0,0,0], color:'#6a7070', mass_kg:1.8,
          standard:'DIN EN 1561 EN-GJL-250', revision:'B',
          surface_finish:'Ra 1.6 μm bearing bores',
          tolerance:'Bearing bore ⌀18 H6', process:'casting',
          coating:'E-coat primer external', temp_max_c:300,
          notes:'Oil passages 4 mm dia. Drain outlet bottom. Two oil supply ports 3/8 NPT.',
          fluid:'SAE 5W-30 engine oil at 5–7 bar'
        },
        {
          id:'comp_hsg', name:'Compressor Housing — A380 Die-Cast', type:'housing', material:'6061-t6 aluminium',
          dims:{width:130, height:80, depth:80, scroll_diameter:110},
          position:[0,80,0], color:'#9aaabb', mass_kg:0.85,
          standard:'ASTM B85 A380', revision:'A',
          surface_finish:'Ra 3.2 μm scroll bore',
          tolerance:'Tip clearance 0.3–0.5 mm to wheel',
          process:'casting', coating:'Powder coat external',
          temp_max_c:200,
          notes:'Anti-surge port integrated. Discharge flange to intercooler.',
        },
        {
          id:'turb_hsg', name:'Turbine Housing — High-Si Cast Iron', type:'housing', material:'cast_iron',
          dims:{width:140, height:80, depth:90, a_r_ratio:0.72},
          position:[0,-80,0], color:'#6a7070', mass_kg:1.2,
          standard:'DIN EN 1561 EN-GJS-600', revision:'A',
          surface_finish:'Ra 3.2 μm scroll bore', process:'casting',
          temp_max_c:950, coating:'Ceramic TBC on hot-face surfaces',
          notes:'A/R ratio 0.72. T6 flange inlet V-band. V-band outlet to downpipe. Wastegate integral.'
        },
        {
          id:'brg001', name:'Journal Bearing #1 — Full-Floating', type:'bearing', material:'copper c110',
          dims:{inner_diameter:12, outer_diameter:18, width:14},
          position:[0,20,0], color:'#d4a020', mass_kg:0.012,
          standard:'SAE J460', revision:'A',
          surface_finish:'Ra 0.2 μm all surfaces', tolerance:'Inner: 12 H6, outer: 18 k5',
          process:'turning', coating:'Tin flash 3 μm',
          notes:'Full-floating design. Oil film at both ID and OD. Clearance ID 0.028–0.048 mm, OD 0.040–0.060 mm.',
          ndt:'100% dimensional check'
        },
        {
          id:'brg002', name:'Journal Bearing #2 — Full-Floating', type:'bearing', material:'copper c110',
          dims:{inner_diameter:12, outer_diameter:18, width:14},
          position:[0,-20,0], color:'#d4a020', mass_kg:0.012,
          standard:'SAE J460', revision:'A',
          surface_finish:'Ra 0.2 μm', tolerance:'Inner: 12 H6, outer: 18 k5',
          process:'turning', coating:'Tin flash 3 μm',
          notes:'Mirror image of brg001.'
        },
        {
          id:'seal001', name:'Piston Ring Seal — Compressor Side', type:'piston_ring', material:'4340 steel',
          dims:{inner_diameter:18, ring_width:2, ring_thickness:3},
          position:[0,50,0], color:'#888888', mass_kg:0.004,
          standard:'DIN 3760', revision:'A',
          notes:'Nitrided. 0.25 mm end gap in bore. Prevents oil entry to compressor.'
        },
        {
          id:'seal002', name:'Piston Ring Seal — Turbine Side', type:'piston_ring', material:'4340 steel',
          dims:{inner_diameter:18, ring_width:2, ring_thickness:3},
          position:[0,-50,0], color:'#888888', mass_kg:0.004,
          standard:'DIN 3760', revision:'A',
          notes:'Same as seal001. Carbon face seal optional for high-temp operation.'
        },
      ],
      bom_notes: 'Simplified model. Omitted: actuator, wastegate, oil supply/drain flanges, V-band clamps, boost controller.'
    };
  }

  // Hydraulic cylinder
  if (/\b(hydraulic|actuator|cylinder|pneumatic)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Hydraulic Cylinder — Double-Acting 80mm Bore × 500mm Stroke',
      description: '80 mm bore × 500 mm stroke double-acting hydraulic cylinder. 250 bar MEOP, 375 bar proof, -40 to +120°C, ISO 6020/6022 mounting.',
      total_mass_kg: 8.4,
      parts: [
        {
          id:'tube001', name:'Cylinder Tube — ST52-3 Honed Seamless', type:'housing', material:'4340 steel',
          dims:{outer_diameter:95, inner_diameter:80, length:560, wall_thickness:7.5},
          position:[0,280,0], color:'#6a7a8a', mass_kg:4.2,
          standard:'EN 10305-4 (honed tube)', revision:'B',
          surface_finish:'ID Ra 0.4 μm (plateau hone), OD Ra 3.2 μm',
          tolerance:'ID 80 H7 (+0/+0.030 mm), ovality < 0.015 mm',
          process:'turning', coating:'External: hard chrome 25 μm or nickel-ceramic',
          temp_min_c:-40, temp_max_c:120, pressure_max_bar:250,
          fluid:'HLP 46 mineral hydraulic oil',
          test_pressure_bar:375,
          notes:'DOM seamless tube. Bore honed to plateau finish Rpk 0.08 μm / Rvk 0.25 μm. Ports 3/8 BSP G1/2 threaded welded bosses.',
          ndt:'UT wall thickness scan, hydro test 375 bar 5 min'
        },
        {
          id:'rod001', name:'Piston Rod — Hard Chrome 45C8', type:'shaft', material:'4340 steel',
          dims:{diameter:45, length:650, chrome_thickness_um:25},
          position:[0,600,0], color:'#aab8c8', mass_kg:2.1,
          standard:'EN ISO 6020-1', revision:'A',
          surface_finish:'Chrome OD Ra 0.1 μm (centreless ground)',
          tolerance:'OD 45 f7 (-0.025/-0.050 mm), straightness < 0.1/1000 mm',
          process:'grinding', coating:'Hard chrome 25 μm, 800–1000 HV0.3',
          temp_min_c:-40, temp_max_c:120,
          notes:'45C8 ground to 45 f7, hard chrome plated, ground to final size. Micro-pore test required. Anti-corrosion: 1000h salt spray per ISO 9227.',
          ndt:'100% MT after chrome, hardness check every 10 parts'
        },
        {
          id:'ps001', name:'Piston — Steel Guide + Bronze Rider', type:'piston', material:'4340 steel',
          dims:{diameter:79.8, height:60, rod_bore:40},
          position:[0,280,0], color:'#8a9aaa', mass_kg:0.85,
          standard:'ISO 6020', revision:'A',
          surface_finish:'Ra 0.8 μm all faces',
          tolerance:'OD 79.8 (h8 to tube bore)',
          process:'turning', coating:'None',
          notes:'Two PTFE guide rings. Central seal groove for Uflex piston seal. Bronze wear band 8 mm wide either side.'
        },
        {
          id:'seal001', name:'Piston Seal — Uflex U-ring NBR', type:'o_ring', material:'viton fkm',
          dims:{inner_diameter:79.8, cross_section:8, tube_radius:5},
          position:[0,290,0], color:'#111111', mass_kg:0.02,
          standard:'ISO 3601', revision:'A',
          notes:'Energised lip seal. Bi-directional. -30 to +120°C. Pressure to 250 bar.',
          surface_finish:'Groove Ra 0.4 μm'
        },
        {
          id:'seal002', name:'Rod Seal — Hallite 506 PTFE', type:'lip_seal', material:'ptfe',
          dims:{inner_diameter:45, outer_diameter:58, height:8},
          position:[0,545,0], color:'#333333', mass_kg:0.012,
          standard:'ISO 6195', revision:'A',
          notes:'PTFE/POM lip seal with NBR energiser. Zero stick-slip. -40 to +200°C.',
          surface_finish:'Rod surface Ra 0.1–0.2 μm required'
        },
        {
          id:'hd001', name:'Gland Head — EN-GJS-400 Ductile Iron', type:'flange', material:'4340 steel',
          dims:{outer_diameter:95, height:35, rod_bore:45, thread_spec:'M95×2 LH'},
          position:[0,542,0], color:'#5a6a7a', mass_kg:0.68,
          standard:'ISO 6022', revision:'B',
          surface_finish:'Ra 0.8 μm bore for rod seal', tolerance:'Rod bore 45 H8',
          process:'turning', coating:'Zinc phosphate + paint',
          notes:'Screwed in with spanner flats. Locking wire groove. Wiper seal groove external.'
        },
        {
          id:'ec001', name:'End Cap — Welded Steel', type:'flange', material:'4340 steel',
          dims:{outer_diameter:95, height:25, pivot_bore:40},
          position:[0,10,0], color:'#5a6a7a', mass_kg:0.55,
          standard:'ISO 6020', revision:'A',
          process:'machining', coating:'Zinc phosphate + paint',
          notes:'Welded to tube. Clevis or trunnion mount weld preparation. Full penetration weld, class PB per EN 15614.',
          ndt:'UT weld inspection 100%'
        },
        {
          id:'pt001', name:'Port Boss A — G1/2 BSP', type:'housing', material:'4340 steel',
          dims:{diameter:12, height:16, port_thread:'G 1/2 BSP'},
          position:[47,100,0], color:'#4a5a6a', mass_kg:0.04,
          standard:'ISO 228-1', revision:'A', notes:'Welded boss. Hydraulic port for extension stroke.'
        },
        {
          id:'pt002', name:'Port Boss B — G1/2 BSP', type:'housing', material:'4340 steel',
          dims:{diameter:12, height:16, port_thread:'G 1/2 BSP'},
          position:[47,460,0], color:'#4a5a6a', mass_kg:0.04,
          standard:'ISO 228-1', revision:'A', notes:'Welded boss. Hydraulic port for retraction stroke.'
        },
      ],
      bom_notes: 'Includes tube, rod, piston, seals. Excludes mounting clevis/trunnion, hydraulic fittings, bleed screws, position sensor.'
    };
  }

  // ── Wind turbine ─────────────────────────────────────────────────────────
  if (/\b(wind turbine|windmill|hawt|offshore wind|onshore wind|turbine blade)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Horizontal Axis Wind Turbine — 2 MW IEC Class IIA',
      description: '2 MW HAWT. Rotor Ø90 m, hub height 80 m, rated wind 13 m/s. 3-blade pitch-regulated. DFIG generator. IEC 61400-1 Class IIA structural design.',
      total_mass_kg: 290000,
      parts: [
        { id:'bl001', name:'Blade 1 — CFRP/GFRP 44 m Aerofoil', type:'rotor_blade', material:'carbon fibre composite',
          dims:{length:44000, max_chord:3200, thickness:800}, position:[0,0,44000], color:'#eaeaea', mass_kg:7200,
          standard:'IEC 61400-23 / GL 2010', revision:'A',
          surface_finish:'Gelcoat finish Ra 1.6 μm outer skin', tolerance:'Chord ±5 mm, twist ±0.1°',
          process:'infusion', heat_treatment:'Post-cure 80°C 6h',
          notes:'Root Ø2.0 m flanged. NACA 63-xxx profiles. Internal lightning conductor. Individual pitch control. Heating mat for de-icing.' },
        { id:'bl002', name:'Blade 2 — CFRP/GFRP 44 m', type:'rotor_blade', material:'carbon fibre composite',
          dims:{length:44000, max_chord:3200, thickness:800}, position:[38000,-22000,0], color:'#eaeaea', mass_kg:7200 },
        { id:'bl003', name:'Blade 3 — CFRP/GFRP 44 m', type:'rotor_blade', material:'carbon fibre composite',
          dims:{length:44000, max_chord:3200, thickness:800}, position:[-38000,-22000,0], color:'#eaeaea', mass_kg:7200 },
        { id:'hub001', name:'Hub — Spheroidal Iron GJS-400-15', type:'housing', material:'cast iron ductile',
          dims:{diameter:3200, length:3800}, position:[0,0,0], color:'#6a7070', mass_kg:18000,
          standard:'EN 1563 GJS-400-15', revision:'B',
          surface_finish:'Bearing seats Ra 1.6 μm, general Ra 12.5 μm', tolerance:'Pitch bearing seats H7',
          process:'casting', ndt:'UT ASTM A609 Level C all sections',
          notes:'3-arm spherical. 3× pitch bearing 4-point contact Ø2 m. IPC actuator mounts.' },
        { id:'gb001', name:'Main Gearbox — 3-Stage Epicyclic 97:1', type:'gear', material:'steel',
          dims:{width:3800, height:2800, depth:2600}, position:[0,0,-2000], color:'#5a6060', mass_kg:48000,
          standard:'AGMA 6006-A03 / IEC 61400-4', notes:'1 planetary + 2 helical stages. Input 12–22 RPM → 1500 RPM output. ISO VG 320 synthetic gear oil. Forced lubrication with filter & heat exchanger.' },
        { id:'gen001', name:'Generator — 2 MW DFIG 4-Pole 690V', type:'housing', material:'steel',
          dims:{diameter:2200, length:2600}, position:[0,0,-5000], color:'#4a5060', mass_kg:38000,
          standard:'IEC 60034', notes:'Doubly-fed asynchronous. 690V stator. Rotor slip rings. IGBT converter. Efficiency 97% at rated.' },
        { id:'mbs001', name:'Main Shaft Bearing — Double-Row Spherical Roller', type:'bearing', material:'steel',
          dims:{innerD:800, outerD:1120, width:400}, position:[0,0,-800], color:'#c8d8e0', mass_kg:3200,
          standard:'ISO 355', notes:'SKF CARB or equivalent. Continuous grease feed. 20-year design life.' },
        { id:'yaw001', name:'Yaw System — 4× Drive + Slewing Ring Ø4.2 m', type:'gear', material:'steel',
          dims:{diameter:4200, height:400}, position:[0,-1800,0], color:'#6a7070', mass_kg:12000,
          notes:'4× 5 kW yaw motors. 8-point slewing ring. Brake caliper array.' },
        { id:'twr001', name:'Tower — Conical Steel Shell 80 m', type:'tube', material:'steel',
          dims:{base_diameter:4200, top_diameter:2800, height:80000, wall:22}, position:[0,-80000,0], color:'#8a9aaa', mass_kg:130000,
          standard:'EN 1993-1-6 / IEC 61400-6',
          notes:'3-section bolted flanges. Internal ladder + lift. External paint system ISO 12944 C5-M.' },
      ],
      bom_notes: 'Omitted: power converter, MV transformer, SCADA, cable, blade erosion tape, foundation.'
    };
  }

  // ── Truss bridge ─────────────────────────────────────────────────────────
  if (/\b(bridge|truss bridge|warren truss|girder bridge|arch bridge|suspension bridge|cable.stayed)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Steel Warren Through-Truss Bridge — 60 m Span',
      description: 'Warren through-truss highway bridge. Span 60 m, 4-lane deck. S355 primary steel, HPS70W weathering bottom chord. HL-93 live load per AASHTO LRFD.',
      total_mass_kg: 185000,
      parts: [
        { id:'btch001', name:'Bottom Chord — 2× HPS70W Box 500×500×30', type:'ibeam', material:'steel HPS70W',
          dims:{width:500, height:500, flange_t:30, web_t:20, length:60000}, quantity:2,
          position:[0,-500,0], color:'#a87040', mass_kg:28000,
          standard:'ASTM A709 HPS70W', notes:'Weathering steel. Primary tension chord. L/800 camber = 75 mm.' },
        { id:'tpch001', name:'Top Chord — 2× S355 Box 400×400×25', type:'ibeam', material:'steel S355',
          dims:{width:400, height:400, flange_t:25, web_t:18, length:60000}, quantity:2,
          position:[0,5500,0], color:'#6a7a8a', mass_kg:18000, standard:'EN 10025-2 S355' },
        { id:'vt001', name:'Vertical Posts — 10× HEB500 S355', type:'ibeam', material:'steel S355',
          dims:{flange_width:300, depth:500, flange_t:22, web_t:14, height:6000}, quantity:10,
          position:[0,0,0], color:'#6a7a8a', mass_kg:22000, standard:'EN 10025 HEB500' },
        { id:'dg001', name:'Diagonal Members — 20× 300×200 RHS S355', type:'beam', material:'steel S355',
          dims:{width:300, height:200, wall_t:12, length:7000}, quantity:20,
          position:[0,2500,0], color:'#7a8a9a', mass_kg:30000, standard:'EN 10219 S355J2H' },
        { id:'str001', name:'Deck Stringers — 12× IPE550 S355', type:'ibeam', material:'steel S355',
          dims:{flange_width:210, depth:550, flange_t:17, web_t:11, length:6000}, quantity:12,
          position:[0,-400,0], color:'#7a8a9a', mass_kg:18000, standard:'EN 10025 IPE550' },
        { id:'flb001', name:'Floor Beams — 6× HEB600 S355', type:'ibeam', material:'steel S355',
          dims:{flange_width:300, depth:600, flange_t:24, web_t:15, length:6000}, quantity:6,
          position:[0,-450,0], color:'#6a7a8a', mass_kg:14000, standard:'EN 10025 HEB600' },
        { id:'dck001', name:'Deck Slab — C35/45 RC 220 mm', type:'plate', material:'concrete',
          dims:{width:16000, height:220, depth:60000}, position:[0,-650,0], color:'#b0b0a0', mass_kg:42000,
          standard:'EN 1992-1', notes:'Composite on profiled steel deck. B500B rebar. Expansion joints @30 m.' },
        { id:'bng001', name:'Fixed Bearing — 2× POT 3000 kN', type:'bearing', material:'steel',
          dims:{length:600, width:500, height:120}, quantity:2,
          position:[0,-800,-29500], color:'#5a6a7a', mass_kg:960, standard:'EN 1337-5' },
        { id:'bng002', name:'Expansion Bearing — 2× POT Guided 3000 kN', type:'bearing', material:'steel',
          dims:{length:700, width:500, height:130}, quantity:2,
          position:[0,-800,29500], color:'#5a6a7a', mass_kg:980, standard:'EN 1337-5',
          notes:'100 mm longitudinal movement. Fixed transversely.' },
      ],
      bom_notes: 'Design standard BS EN 1993-2 / AASHTO LRFD. Omitted: substructure, waterproofing, drains, railing, coatings.'
    };
  }

  // ── Aircraft wing section ─────────────────────────────────────────────────
  if (/\b(aircraft|airplane|wing|airfoil|aerofoil|fuselage|spar|rib|airframe)\b/.test(t)) {
    return {
      assembly: true,
      name: 'Commercial Aircraft Wing Section — 3 m Bay',
      description: 'Single 3 m span bay of a transport aircraft composite wing. Carbon/epoxy skin-stringer panels, aluminium ribs, CFRP front/rear spars. FAR 25 / CS-25 design.',
      total_mass_kg: 620,
      parts: [
        { id:'fps001', name:'Front Spar — CFRP I-Section', type:'ibeam', material:'carbon fibre composite',
          dims:{height:400, flange_width:120, web_t:8, flange_t:15, length:3000}, position:[0,0,0], color:'#1a2a3a', mass_kg:48,
          standard:'ASTM D5766 open hole tension', notes:'T800/M21 prepreg. Quasi-isotropic ±45/0/90. AOH tolerance per BVID 6.7 J.' },
        { id:'rps001', name:'Rear Spar — CFRP I-Section', type:'ibeam', material:'carbon fibre composite',
          dims:{height:280, flange_width:100, web_t:6, flange_t:12, length:3000}, position:[2000,0,0], color:'#1a2a3a', mass_kg:32 },
        { id:'rib001', name:'Rib 1 — 7150-T7751 Aluminium CNC', type:'plate', material:'aluminum',
          dims:{width:2000, height:400, depth:3}, position:[0,0,0], color:'#9ab0c0', mass_kg:8.2,
          standard:'AMS 2770 T7751 per AMS 2422', notes:'Lightened. Joggled for skin stringer fit-up. CDT sealant faying surfaces.' },
        { id:'rib002', name:'Rib 2 — 7150-T7751 Aluminium', type:'plate', material:'aluminum',
          dims:{width:2000, height:380, depth:3}, position:[0,1500,0], color:'#9ab0c0', mass_kg:7.8 },
        { id:'upr001', name:'Upper Skin Panel — CFRP Stringer-Stiffened', type:'plate', material:'carbon fibre composite',
          dims:{width:2500, height:6, depth:3000}, position:[0,400,0], color:'#1a1a2a', mass_kg:120,
          notes:'T800 UD + ±45 fabric. Omega stringers co-cured. Compression-critical. BVID tolerance designed.' },
        { id:'lwr001', name:'Lower Skin Panel — CFRP Tension', type:'plate', material:'carbon fibre composite',
          dims:{width:2500, height:6, depth:3000}, position:[0,-20,0], color:'#1a1a2a', mass_kg:105,
          notes:'CFRP tension panel. Tapered in spanwise direction. Bolted to spars with Hi-Lok fasteners.' },
        { id:'flt001', name:'Flap Track Support — 7050-T7451 Machined', type:'bracket', material:'aluminum',
          dims:{width:120, height:200, depth:80}, position:[2100,0,1500], color:'#9ab0c0', mass_kg:4.6,
          standard:'AMS 2770 T7451', notes:'Critical fitting. Fracture-mechanics life calc per AC 25.571.' },
        { id:'fst001', name:'Hi-Lok Fastener A286 ×400', type:'bolt_hex', material:'stainless A286',
          dims:{diameter:6.35, length:18}, quantity:400,
          position:[0,0,0], color:'#4a4a4a', mass_kg:0.014,
          standard:'NAS 1097 / Hi-Lok HL10', torque_nm:5.6,
          notes:'Hi-Lok pin HL10V6-6, HL collar HC6. Install torque 50 in-lbf ±5.' },
        { id:'slnt001', name:'Faying Surface Sealant — PR-1422 B2', type:'gasket', material:'polysulfide',
          dims:{width:2500, height:0.2, depth:3000}, position:[0,400,-20], color:'#888888', mass_kg:2.1,
          standard:'MIL-PRF-81733', notes:'Class B2 faying surface sealant. 1 part. Applied wet assembly. 48h cure at 25°C.' },
      ],
      bom_notes: 'Omitted: control surface hinges, fuel system, lightning mesh, drain holes, edge sealant, inspection panels.'
    };
  }

  // Generic / catch-all
  const dims = extractDimensions(prompt);
  const mat = getMat(prompt);
  const theme = pickInventionTheme(prompt);
  const sz = dims.length ? dims[0].value : 100;

  return {
    assembly: true,
    name: theme.charAt(0).toUpperCase() + theme.slice(1),
    description: `Parametric ${theme} — generated from design brief.`,
    total_mass_kg: 2.4,
    parts: [
      {
        id:'body001', name:'Main Body', type:'housing', material:mat.name,
        dims:{width:sz, height:sz*0.6, depth:sz*0.5},
        position:[0,0,0], color:'#9aaabb', mass_kg:1.8,
        standard:'Customer drawing', revision:'A',
        surface_finish:'Ra 1.6 μm mating faces, Ra 3.2 μm general',
        tolerance:'General ±0.1 mm per ISO 2768-m', process:'machining',
        coating:'Anodize T5 clear 15 μm (if aluminium) or paint to RAL 7035',
        notes:`${mat.name}. Primary structural component. Customer to specify all interface dimensions.`
      },
      {
        id:'brk001', name:'Mounting Bracket', type:'bracket', material:'6061-t6 aluminium',
        dims:{width:sz*0.5, height:sz*0.4, depth:sz*0.3},
        position:[sz*0.6,0,0], color:'#6a7a8a', mass_kg:0.35,
        standard:'Customer drawing', revision:'A',
        surface_finish:'Ra 3.2 μm', tolerance:'±0.1 mm',
        process:'machining', coating:'Anodize clear 15 μm'
      },
      {
        id:'bolt001', name:'Socket Head Cap Screw M8×30 ISO 4762', type:'bolt_hex', material:'316L stainless',
        dims:{diameter:8, length:30, thread_pitch:1.25, head_diameter:13},
        position:[sz*0.6, sz*0.2, sz*0.15], color:'#4a4a4a', mass_kg:0.022,
        standard:'ISO 4762 — Class 12.9 (or A4-70)', quantity:4, revision:'—',
        torque_nm:25, tighten_seq:'Cross-pattern, 3 passes, lubricated μ=0.12',
        thread_spec:'M8×1.25 — 6H/6g', surface_finish:'Passivated',
        notes:'Torque to VDI 2230. Hardened washer under head.'
      },
      {
        id:'bolt002', name:'Socket Head Cap Screw M8×30 ISO 4762', type:'bolt_hex', material:'316L stainless',
        dims:{diameter:8, length:30}, position:[sz*0.6, sz*0.2, -sz*0.15],
        color:'#4a4a4a', mass_kg:0.022, standard:'ISO 4762', quantity:4, torque_nm:25
      },
      {
        id:'seal001', name:'O-Ring Seal AS568-XXX', type:'o_ring', material:'viton fkm',
        dims:{inner_diameter:sz*0.4, cross_section:3.5},
        position:[0, sz*0.3, 0], color:'#111111', mass_kg:0.005,
        standard:'AS568 / ISO 3601', revision:'A',
        surface_finish:'Groove Ra 0.8 μm, lead-in chamfer 15°',
        tolerance:'Groove width +0.05/-0 mm',
        notes:'25% squeeze ratio. Groove depth = CS × 0.75. PTFE backup ring for >50 bar.'
      },
      {
        id:'brg001', name:'Deep Groove Ball Bearing 6205-2RS', type:'bearing', material:'4340 steel',
        dims:{inner_diameter:25, outer_diameter:52, width:15},
        position:[0, sz*0.25, 0], color:'#c8d8e0', mass_kg:0.19,
        standard:'ISO 15:2017 (6205)', quantity:2, revision:'—',
        surface_finish:'Bore H7, shaft k5 (interference fit)',
        tolerance:'Radial clearance C3 for elevated temperature service',
        notes:'FAG / SKF 6205-2RS1. C3 clearance. Grease lubricated NLGI 2. Max 10,000 RPM. Static load rating 6.55 kN, dynamic 14.0 kN.',
        ndt:'Acceptance per ISO 1132'
      },
    ],
    bom_notes: `Auto-generated from brief: "${prompt.slice(0,120)}". Refine by asking Enki to add specific subsystems or materials.`
  };
}

function extractAssemblyPlanFromNarrative(text) {
  const source = String(text || '');
  if (!source) return null;
  const blockMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!blockMatch) return null;
  try {
    const parsed = JSON.parse(blockMatch[1].trim());
    if (parsed && parsed.assembly === true && Array.isArray(parsed.parts)) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ─── Core narrative generator ────────────────────────────────
function generateEnkiNarrative(prompt, ctx = {}) {
  const t = (prompt || '').toLowerCase().trim();
  const mat = getMat(prompt);
  const dims = extractDimensions(prompt);
  const theme = pickInventionTheme(prompt);
  const intent = inferPromptIntent(prompt);
  const constraintState = buildConstraintHighlights(prompt);
  const followupQuestions = buildFollowupQuestions(prompt, constraintState);

  // ── Greeting ──
  if (/^(hi|hello|hey|yo|greetings|sup|what'?s up)\b/.test(t)) {
    return {
      narrative: `Hello. I'm Enki — UARE's autonomous invention intelligence.\n\nI can take a plain English description of an invention and generate parametric CAD geometry, run structural and thermal FEA simulations, search patent databases for prior art, and produce a full set of patent claims — all without you touching a single tool.\n\nWhat are you building? Describe it and I'll start the engineering.`,
      insights: [],
      warnings: [],
      suggestions: ['Describe your invention in plain English', 'Ask me to run a full pipeline', 'Ask about a specific material or design constraint'],
    };
  }

  // ── Material question ──
  if (/\b(material|alumin|steel|titanium|carbon|peek|nylon|composite)\b/.test(t) && !/generate|cad|model|bracket/.test(t)) {
    return {
      narrative: `For this application I'd recommend **${mat.name}**. Here's my engineering assessment:\n\n• **Density**: ${mat.density} g/cm³\n• **Young's modulus**: ${mat.youngs} GPa\n• **Yield strength**: ${mat.yield} MPa\n• **Preferred process**: ${mat.process}\n\n${mat.note.charAt(0).toUpperCase() + mat.note.slice(1)}.\n\n${safetyFactorNote(mat.youngs, mat.yield)}\n\nWant me to generate a parametric CAD model with these properties and run a structural analysis?`,
      insights: [`Material identified: ${mat.name}`, `Process: ${mat.process}`],
      warnings: mat.name.includes('carbon') ? ['Carbon fibre is anisotropic — fibre orientation must be specified in the CAD recipe.'] : [],
      suggestions: [`Generate CAD using ${mat.name}`, 'Run structural static FEA', 'Compare against titanium for mass savings'],
    };
  }

  // ── General explanation / question ──
  if (/^(how|what|why|explain|tell me|describe|can you|do you)\b/.test(t)) {
    return {
      narrative: `Good question. Here is the engineering view for this ${theme}.\n\nCore mechanism: ${getExplanation(prompt)}.\n\nDetected constraints: ${constraintState.highlights.join(', ')}.\n\nRecommended sequence: lock interfaces and envelope, then lock material/process, then run first-pass simulation to find weak regions.\n\nIf you want, I can generate a first concept now with these assumptions.`,
      insights: ['Design space analysis ready', dims.length ? 'Prompt dimensions detected and prioritized' : 'No dimensions provided — defaults will be used', ...constraintState.highlights],
      warnings: [],
      suggestions: uniqueList(['Generate initial CAD concept', 'Define constraints and I\'ll optimise', 'Search patent landscape first', ...followupQuestions]),
    };
  }

  // ── Action / simulation command (run fea, run physics, export...) ──
  if ((/\b(run|start|execute|trigger|launch|begin|do|perform)\b/.test(t) &&
       /\b(fea|fem|stress|thermal|physics|sim|simulation|analysis|export|stl|step|obj)\b/.test(t)) ||
      (/\b(export|download|save|get)\b/.test(t) &&
       /\b(stl|step|obj|assembly|model|file|cad)\b/.test(t))) {
    const isExport = /\b(export|download|save|get)\b/.test(t);
    const isThermal = /thermal/.test(t);
    const isFEA = /\b(fea|fem|stress|structural)\b/.test(t);
    const isPhysics = /\b(physics|sim|dynamics|collision)\b/.test(t);
    if (isExport) {
      return {
        narrative: `**Export** — use the toolbar buttons at the top right:\n\n• **↓ STL** — Stereolithography mesh, compatible with slicers and most CAM tools\n• **↓ OBJ** — Wavefront OBJ with materials, good for rendering\n• **↓ STEP** — ISO 10303 solid model (simulated — downloads geometry as OBJ with STEP header)\n\nAll formats export the current assembly in scene units (1 scene unit = 0.1 mm scale).\n\nIf you need a true parametric STEP file, I recommend exporting OBJ and importing into FreeCAD or SOLIDWORKS for STEP conversion.`,
        insights: ['Export formats: STL, OBJ, STEP (simulated)'],
        warnings: [],
        suggestions: ['Export as STL', 'Export as OBJ', 'Export STEP for CAD import'],
      };
    }
    if (isThermal) {
      return {
        narrative: `**Thermal Analysis** — click **🔥 Thermal** in the simulation bar to run the heatmap.\n\nThe analysis uses steady-state conduction with convective boundary conditions. High-temperature parts (combustion chamber, nozzle throat) are coloured orange/white, low-temperature parts dark blue.\n\nFor ${mat.name}: thermal conductivity **${mat.thermal_k ?? '12'} W/m·K**, Cp **${mat.cp_j_kgk ?? '460'} J/kg·K**, max service temp checked against part specs.`,
        insights: [`Material k: ${mat.thermal_k ?? '—'} W/m·K`],
        warnings: [],
        suggestions: ['Run FEA stress after thermal', 'Compare materials for thermal conductivity', 'Export thermal results'],
      };
    }
    if (isFEA) {
      return {
        narrative: `**FEA Ready** — click **⚡ FEA** in the simulation bar to run stress analysis.\n\nThe solver uses beam theory (σ = M·c/I) with a **5g shock load** applied to each part. Results:\n• Stress heatmap: red = highest von Mises stress, blue = lowest\n• Safety factor = σ_yield / σ_max shown in metrics bar\n• Parts below SF 1.5 flagged with ⚠️\n\nFor ${mat.name}: σ_yield = ${mat.yield} MPa. Any part exceeding ${(mat.yield * 0.67).toFixed(0)} MPa will be highlighted.`,
        insights: [`Yield: ${mat.yield} MPa`, `Load: 5g shock (${(9.81 * 5).toFixed(1)} m/s²)`],
        warnings: [],
        suggestions: ['Run FEA now', 'Check safety factors', 'Identify high-stress parts'],
      };
    }
    if (isPhysics) {
      return {
        narrative: `**Physics Simulation** — click **▶ Run** in the simulation bar to launch the rigid-body physics engine (Cannon-ES).\n\nThe simulation applies:\n• **Gravity**: 9.81 m/s² downward\n• **Collision detection**: part-to-part convex hull\n• **Constraints**: joints maintained for assembly\n\nUse **⏸ Pause** to freeze and inspect, **↺ Reset** to restore assembly pose. Parts with low mass will respond faster to applied impulses.`,
        insights: ['Physics engine: Cannon-ES (rigid body)', 'Gravity: 9.81 m/s²'],
        warnings: [],
        suggestions: ['Run physics simulation', 'Pause and inspect', 'Reset to assembly pose'],
      };
    }
  }

  // ── Simulation / analysis question ──
  if (/\b(stress|load|force|deflect|deform|factor|fea|fem|analyse|analyze|simulation)\b/.test(t)) {
    return {
      narrative: `For structural analysis of a ${theme}:\n\nThe critical load case is typically the worst-case combination of applied force, thermal gradient, and dynamic loading. For ${mat.name} with your configuration:\n\n• **Max Von Mises stress** will peak at geometric discontinuities (holes, fillets, step changes)\n• **Deflection** under nominal load can be estimated from beam theory before full FEA\n• **${safetyFactorNote(mat.youngs, mat.yield)}**\n\nI can set up a structural static job with realistic boundary conditions in about 10 seconds. The solver runs in-process and returns principal stress, displacement, and a pass/fail summary.\n\nReady to run?`,
      insights: [`Material: ${mat.name}`, `E = ${mat.youngs} GPa, σ_y = ${mat.yield} MPa`],
      warnings: [],
      suggestions: ['Run structural static FEA', 'Add thermal load case', 'Export results to patent filing'],
    };
  }

  // ── Design request — emit a JSON assembly plan ──
  if (isDesignRequest(prompt)) {
    const plan = generateFallbackAssemblyPlan(prompt);
    const dimStr = dims.length ? dims.map(d => `${d.key}: ${d.value} ${d.unit}`).join(', ') : 'standard proportions';
    const assumptions = followupQuestions.length
      ? `Pending confirmations: ${followupQuestions.join(' ')}`
      : 'Prompt includes enough constraints for immediate execution.';
    return {
      narrative: `Generating **${plan.name}**.\n\n${plan.description || ''}\n\nIntent classification: **${intent.replace(/_/g, ' ')}**. Material baseline: **${mat.name}** (E = ${mat.youngs} GPa, σ_y = ${mat.yield} MPa). ${dimStr}.\n\n${assumptions}\n\n${safetyFactorNote(mat.youngs, mat.yield)}\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``,
      insights: [`Parts: ${plan.parts.length}`, `Mass: ${plan.total_mass_kg} kg`, ...constraintState.highlights],
      warnings: [],
      suggestions: uniqueList([...followupQuestions, 'Run FEA stress analysis', 'Run physics simulation', 'Export as STEP file']),
      _source: 'builtin-design',
      _plan: plan,
      _response_profile: {
        intent,
        theme,
        has_dimensions: dims.length > 0,
        highlights: constraintState.highlights,
        pending_questions: followupQuestions,
      },
    };
  }

  // ── Invention description (catch-all for anything with substance) ──
  const hasDims = dims.length > 0;
  const dimStr = hasDims
    ? dims.map(d => `${d.key}: ${d.value} ${d.unit}`).join(', ')
    : 'standard proportions (120 × 40 × 25 mm)';

  return {
    narrative: `I've analyzed your request as a **${theme}** with intent **${intent.replace(/_/g, ' ')}**.\n\nDetected constraints: ${constraintState.highlights.join(', ')}.\n\nRecommended next move:\n1. Lock geometry envelope and interfaces (${dimStr}).\n2. Freeze material/process (${mat.name}; ${mat.process}).\n3. Run structural baseline with ${ctx.force || 120} N plus one thermal or dynamic load case.\n\n${safetyFactorNote(mat.youngs, mat.yield)}\n\nSay **"run CAD"**, **"run FEA"**, or **"run full pipeline"** and I will execute it.`,
    insights: [
      `Component type: ${theme}`,
      hasDims ? `Dimensions extracted: ${dimStr}` : 'Default dimensions will be applied',
      `Material: ${mat.name} (E = ${mat.youngs} GPa)`,
      ...constraintState.highlights,
    ],
    warnings: [],
    suggestions: uniqueList(['Run full pipeline now', 'Generate CAD first for review', `Search prior art for ${theme}`, ...followupQuestions]),
    _response_profile: {
      intent,
      theme,
      has_dimensions: hasDims,
      highlights: constraintState.highlights,
      pending_questions: followupQuestions,
    },
  };
}

function getExplanation(prompt) {
  const t = prompt.toLowerCase();
  if (/bracket|mount/.test(t))   return 'the transfer of point loads into a distributed reaction at the mounting face, managed through section modulus and bolt preload';
  if (/heat\s*sink|thermal/.test(t)) return 'the convection and conduction heat transfer path from the source component through the fin array to the ambient airflow';
  if (/gear|drivetrain/.test(t)) return 'the transfer of torque through involute tooth geometry, governed by contact ratio, bending stress at the root fillet, and surface fatigue life';
  if (/patent|claim|prior\s*art/.test(t)) return 'independent claims which define the broadest protectable scope, followed by dependent claims that capture specific embodiments';
  return 'the balance between structural performance, manufacturing cost, and geometric constraints — best resolved through iterative parametric modelling and FEA';
}

// ─── Legacy structured inference (kept for non-narrative callers) ─
function inferSuggestions({ selected_part, assembly, simulation, prompt }) {
  const suggestions = [];
  const warnings = [];
  const insights = [];
  const failures = Number(simulation?.summary?.fail_count || 0);
  const warningsCount = Number(simulation?.summary?.warning_count || 0);
  if (selected_part?.name || selected_part?.part_id) insights.push(`Focused on ${selected_part.name || selected_part.part_id}.`);
  if (failures > 0) warnings.push(`Simulation shows ${failures} failing checks — review highlighted subsystem before export.`);
  if (warningsCount > 0) insights.push(`${warningsCount} simulation warnings remain open.`);
  const material = selected_part?.material || selected_part?.material_name;
  if (material) suggestions.push(`Review manufacturability for ${material} under the current process assumptions.`);
  if ((selected_part?.category || '').includes('power') || /regulator|battery|motor/i.test(JSON.stringify(selected_part || {}))) {
    suggestions.push('Validate current draw and add thermal margin around the power path.');
  }
  if (/sensor|pcb|module|controller/i.test(prompt || '')) {
    suggestions.push('Cross-check connector placement and keep signal paths away from high-current traces.');
  }
  if (!suggestions.length) suggestions.push('Fork the mission and compare a lighter enclosure plus a higher efficiency power rail.');
  return { insights, warnings, suggestions };
}

export function buildCopilotRoutes(runtime, cadExecutionService = null) {
  const router = Router();
  logOllamaStartupConfigOnce();

  router.post('/contextual-analysis', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const prompt = String(req.body?.prompt || req.body?.message || '');
      const sourcePrompt = String(req.body?.current_prompt || req.body?.message || req.body?.prompt || '');
      const autoExecuteCad = req.body?.auto_execute_cad === true;
      // Client can send its own rich system prompt — use it if provided
      const systemPrompt = req.body?.system_prompt || null;
      const ctx = {
        force:         req.body?.force         || null,
        material:      req.body?.material      || null,
        selected_part: req.body?.selected_part || req.body?.selectedPart || null,
        simulation:    req.body?.simulation    || null,
      };

      // Try Ollama with health/model checks and retries; fall back to built-in narrative engine.
      const preferredOllamaModel = req.body?.ollama_model ? String(req.body.ollama_model) : null;
      const ollamaResult = await tryOllamaWithRetry(prompt, systemPrompt, preferredOllamaModel);
      let enki;
      let usedOllama = false;
      let fallbackReason = null;
      if (ollamaResult.ok) {
        enki = ollamaResult.enki;
        usedOllama = true;
      } else {
        enki = generateEnkiNarrative(sourcePrompt, ctx);
        fallbackReason = ollamaResult.reason || 'ollama_failed';
      }

      if (!enki._response_profile) {
        enki._response_profile = {
          intent: inferPromptIntent(sourcePrompt),
          theme: pickInventionTheme(sourcePrompt),
          has_dimensions: extractDimensions(sourcePrompt).length > 0,
          highlights: [],
          pending_questions: [],
        };
      }

      const attemptSummary = Array.isArray(ollamaResult.attempts)
        ? ollamaResult.attempts.map((attempt) => `${attempt.model}:${attempt.ok ? 'ok' : 'fail'}`).join('|')
        : '';
      console.info(
        `[copilot/contextual-analysis] provider=${usedOllama ? 'ollama' : 'builtin_fallback'} selected_model=${ollamaResult.selected_model || 'none'} preferred_model=${preferredOllamaModel || 'none'} fallback_reason=${fallbackReason || 'none'} attempts=${attemptSummary || 'none'}`,
      );

      // Preserve conversational Ollama narrative. If a design request lacks a
      // parsable assembly plan, synthesize only the plan with builtin logic.
      if (usedOllama && isDesignRequest(sourcePrompt)) {
        const parsedPlan = extractAssemblyPlanFromNarrative(enki.narrative);
        if (parsedPlan) {
          enki._plan = parsedPlan;
          enki._source = 'ollama-design';
        } else {
          const fallbackPlan = generateFallbackAssemblyPlan(sourcePrompt);
          enki._plan = fallbackPlan;
          enki._source = 'ollama-with-fallback-plan';
        }
      }

      const derivedCadSpec = buildDerivedCadSpec(sourcePrompt, enki._plan || null);
      let planValidationWarnings = [];
      if (enki._plan) {
        enki._plan = applyDerivedCadSpecToPlan(enki._plan, derivedCadSpec);
        const enforced = enforceAssemblyPlanContract(enki._plan, sourcePrompt);
        enki._plan = enforced.plan;
        planValidationWarnings = enforced.warnings;
      }

      // Legacy structured data
      const legacy = inferSuggestions({
        selected_part: ctx.selected_part,
        assembly:      req.body?.assembly || null,
        simulation:    ctx.simulation,
        prompt: sourcePrompt,
      });

      // ── Background CAD execution for design requests ───────────────────
      let cadExecutionId = null;
      if (autoExecuteCad && enki._plan && cadExecutionService) {
        const execPromise = cadExecutionService.execute(enki._plan, actor)
          .then((manifest) => manifest.execution_id)
          .catch(() => null);
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
        cadExecutionId = await Promise.race([execPromise, timeout]);
      }
      // ─────────────────────────────────────────────────────────────────────

      return res.json({
        ok:           true,
        actor:        { id: actor.id, role: actor.role },
        engine:       enki._source || (usedOllama ? 'ollama' : 'builtin'),
        generation_path: usedOllama ? 'ollama' : 'builtin_fallback',
        fallback_reason: usedOllama ? null : fallbackReason,
        fallback_detail: usedOllama ? null : (ollamaResult.detail || null),
        ollama: {
          health_ok: Boolean(ollamaResult.health_ok),
          preferred_model: preferredOllamaModel,
          selected_model: ollamaResult.selected_model || null,
          attempted_models: Array.isArray(ollamaResult.attempts)
            ? ollamaResult.attempts.map((attempt) => ({ model: attempt.model, ok: attempt.ok, error: attempt.error || null }))
            : [],
          available_models: Array.isArray(ollamaResult.available_models) ? ollamaResult.available_models : [],
        },
        narrative:    enki.narrative,
        response_profile: enki._response_profile || null,
        insights:     [...new Set([...(enki.insights  || []), ...legacy.insights])],
        warnings:     [...new Set([...(enki.warnings  || []), ...legacy.warnings])],
        assembly_plan_warnings: planValidationWarnings,
        suggestions:  [...new Set([...(enki.suggestions || []), ...legacy.suggestions])],
        cad_execution_id: cadExecutionId || null,
        assembly_plan:    enki._plan || null,
        derived_cad_spec: derivedCadSpec,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

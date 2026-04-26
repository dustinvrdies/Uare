# ENKI V5 — UARE's Precision Engineering AI

## Vision

**Enki is a precision engineering generator that creates complete, functionally accurate, manufacturably real mechanical assemblies.**

- **Precision**: Real geometry, tolerances, materials, manufacturing constraints—not approximations
- **Freedom**: Novel designs freely, not templated—reasoning from engineering science
- **Complete**: Full working products (pump, engine, motor) with all internal components functioning correctly
- **Testable**: Physics simulation validates the design—you see it actually work
- **Editable**: Single bolt to entire subsystem to full assembly—all levels equally supported

---

## Architecture Overview

```
┌─────────────────┐
│   User Input    │  "Design a 3-stage gearbox reducer"
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Enki LLM Generation (Claude)                   │
│  • Uses ENKI_ENHANCED_SYSTEM_PROMPT             │
│  • Generates 200+ parts (not 20 templated)      │
│  • Full fastener specs, bearing designations    │
│  • Manufacturing operations, tolerances         │
│  • All welds, seals, internals specified        │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Backend Enrichment Pipeline                    │
│  • enrichAssemblyWithManufacturingData()        │
│  • Fill material properties, infer operations   │
│  • Calculate tolerances, estimate mass          │
│  • Infer subsystems and edit dependencies       │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Validation Gate                                │
│  • validateAssemblyForManufacturability()       │
│  • Check tolerance stacks vs. design margin     │
│  • Verify surface finishes achievable           │
│  • Confirm processes feasible                   │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Frontend Rendering                             │
│  • 3D viewport with assembly tree               │
│  • BOM with part counts, materials, masses      │
│  • Hierarchical editing UI                      │
└────────┬────────────────────────────────────────┘
         │
    ┌────┴────┐
    │          │
    ▼          ▼
 EXPORT    USER EDIT
    │          │
    │          ▼
    │    ┌──────────────────────┐
    │    │ Edit Application      │
    │    │ • Part-level: bolt    │
    │    │ • Subsystem: bearing  │
    │    │ • Assembly: mass      │
    │    └────────┬─────────────┘
    │            │
    │            ▼
    │    ┌──────────────────────────┐
    │    │ Dependency Tracker        │
    │    │ Which parts recompute?    │
    │    └────────┬─────────────────┘
    │            │
    │            ▼
    │    Updated Assembly
    │
    ▼
 STEP/STL
    │
    ▼
SIMULATION (FEA)
    │
    ▼
┌──────────────────────┐
│ Enki Sim Analysis    │
│ • Stress vs. yield   │
│ • Thermal limits     │
│ • Gear mesh checks   │
│ • Fatigue calc       │
│ → Suggestions        │
└────────┬─────────────┘
         │
         ▼
    ITERATE
```

---

## Core Modules

### 1. **Enhanced Part Schema** (`src/cad/enkiEnhancedSchema.mjs`)

Comprehensive part definition including:

```javascript
{
  // Identity
  id: "bearing_001",
  name: "SKF 6205-2RS C3 — Deep Groove Ball Bearing",
  type: "bearing",
  material: "steel",

  // Geometry
  dims: { innerD: 25, outerD: 52, width: 15 },
  position: [0, 0, 110],
  rotation: [0, 0, 0],
  mass_kg: 0.19,

  // Engineering
  engineering: {
    function: "Support crankshaft with low friction",
    loads: { radial_force_n: 1200, operating_temperature_c: 85 },
    heat_treatment: "Q+T HRC 38-42",
    yield_strength_actual_mpa: 750,
  },

  // Manufacturing
  manufacturing: {
    primary_process: "precision_bearing_manufacturing",
    operations: [
      { sequence: 1, operation: "Ring forging", equipment: "Forging press" },
      { sequence: 2, operation: "Grinding races", equipment: "Grinding machine" },
    ],
    surface_treatments: [
      { process: "chromium plating", thickness_um: 5 },
    ],
  },

  // Tolerances
  tolerances: {
    bore_diameter_mm: "25 H7",
    surface_finish_ra_um: 0.4,
    tolerance_stack: {
      total_stack_worst_case_mm: 0.08,
      design_margin_mm: 0.02,
    },
  },

  // Bearing-specific
  bearing: {
    designation: "SKF 6205-2RS C3",
    dynamic_load_rating_kn: 19.5,
    speed_limit_rpm: 6000,
    grease_type: "Polyrex EM",
  },

  // Edit metadata
  dependent_edits: {
    if_diameter_changes: ["shaft_001", "seal_001"],
  },
  subsystem_id: "bearing_package",
}
```

**Key Features:**
- Complete manufacturing metadata (operations, surface treatments, inspection)
- Engineering loads and material properties
- ISO tolerances and surface finish specifications
- Edit dependencies (what parts are affected if this one changes?)
- Type-specific fields (bearing designation, fastener torque, weld filler, etc.)

---

### 2. **Simulation Feedback Engine** (`src/cad/simFeedbackEngine.mjs`)

Analyzes FEA results and generates design suggestions:

```javascript
const analyzer = new SimFeedbackAnalyzer(assembly, simResults);
const result = analyzer.analyze();

// Returns:
{
  suggestions: [
    {
      priority: "high",
      type: "dimension_increase",
      part_id: "housing_001",
      affected_field: "wall_thickness",
      current_value: 4,
      suggested_value: 6,
      reason: "Stress is 850 MPa (>yield). Increasing to 6mm reduces to 600 MPa.",
      stress_reduction_percent: 29,
    },
  ],
  issues: [
    {
      severity: "warning",
      issue_type: "stress_high",
      part_id: "shaft_001",
      message: "Von Mises stress 750 MPa is 75% of yield (1000 MPa)",
    },
  ],
  summary: {
    status: "FAIL",
    critical_issues: 1,
    warnings: 3,
    next_steps: "Address critical stress issues before proceeding",
  },
}
```

**Analysis Modes:**
- **Stress**: Von Mises, principal stresses, concentration factors
- **Deflection**: Checks against allowables, suggests stiffness improvements
- **Thermal**: Operating temps vs. limits, thermal gradients
- **Gear Mesh**: Center distance tolerance, backlash, contact stress
- **Fatigue**: S-N curves, safety factors >2
- **Manufacturability**: Tolerance stacks, surface finish feasibility

---

### 3. **Edit Dependency Tracker** (in schema)

```javascript
const tracker = new EditDependencyTracker(assembly);

// When user edits impeller diameter:
const affected = tracker.getAffectedParts("impeller_001", "diameter");
// → ["bearing_001", "seal_001", "shaft_001"]

// Or for subsystems:
const subsystemDeps = tracker.getSubsystemDependents("bearing_package");
// → ["shaft_001", "housing_001"] (all parts outside subsystem that depend on it)
```

Builds transitive closure of dependencies—understands cascading effects of edits.

---

### 4. **Hierarchical Part Editor UI** (`public/lab/enkiPartEditor.js`)

Browser-based editor for edits at any level:

```javascript
const editor = new EnkiPartEditor(assembly, onEditCallback);
editor.bindUI("#edit-panel");

// User interactions:
editor.selectPart("bolt_001");              // Single part
editor.selectSubsystem("bearing_package");  // Entire subsystem
editor.selectParts(["part_1", "part_2"]);   // Multiple parts

// UI shows:
// • Selected parts as chips
// • Editable form fields (dimension, material, finish)
// • Affected parts (will be recomputed)
// • Smart suggestions for the edit

// User applies edits:
{
  edit_mode: "part",
  selected_parts: ["bolt_001"],
  edits: { diameter: 10, torque_nm: 50 },
  timestamp: "2024-01-15T10:30:00Z",
}
```

---

### 5. **Generation Integration** (`src/cad/enkiIntegration.mjs`)

Ties LLM output with manufacturing constraints:

```javascript
// Enrich LLM-generated assembly
const enriched = enrichAssemblyWithManufacturingData(
  assembly_from_claude,
  MATERIAL_DATABASE
);
// → Fills: material properties, operations, tolerances, subsystems

// Validate for manufacturability
const report = validateAssemblyForManufacturability(enriched);
if (report.status !== "PASS") {
  console.warn("Manufacturability issues:", report.issues);
}

// Process user edit
const result = applyEditToAssembly(assembly, {
  selected_parts: ["housing_001"],
  edits: { wall_thickness: 6 },
  edit_mode: "part",
});
// → Updates assembly, tracks affected parts

// Analyze sim + generate suggestions
const suggestions = analyzeCycleAndGenerateSuggestions(
  assembly,
  simResults
);
// → Returns: suggestions, issues, narrative for LLM
```

---

### 6. **Enhanced LLM System Prompt** (`src/cad/enkiEnhancedPrompt.mjs`)

Comprehensive (~15KB) prompt directing Claude to generate complete, real assemblies:

**Key Directives:**
- **Part Count Targets**: 4-cyl engine = 350–600 parts (not 50)
- **Specification Depth**: Every fastener has ISO designation, torque spec, locking method
- **Manufacturing Reality**: All processes specified, all tolerances achievable
- **Design Freedom**: Novel designs OK, must respect physics & manufacturability
- **Complete JSON**: No copy-paste placeholders—every part is individually specified
- **Subsystem Breakdown**: Identifies functional subsystems (pump, bearing, motor)

---

## Workflows

### Workflow 1: Complete Design Generation

```
User: "Design a centrifugal pump: 50 GPM @ 2 bar, 1500 RPM, low-noise"
↓
Enki (Claude) generates ~85 parts:
  • Impeller: 18 blade surfaces + hub
  • Housing: 8 parts (body, covers, flanges, drains)
  • Bearing package: 12 parts (2 deep-groove + shafts)
  • Sealing: mechanical face seal + elastomer bellows
  • Fasteners: 20 cap screws, lock washers, pins
  • Miscellaneous: labels, oil baffles, thermal relief valve
↓
Backend enriches:
  • Fills bearing load ratings, speed limits
  • Calculates impeller balancing tolerance
  • Infers CNC operations for all machined parts
  • Validates tolerance stacks
↓
Frontend renders:
  • 3D pump assembly
  • BOM: 85 line items, 18.5 kg total, $620 cost estimate
  • Subsystem tree:
    - Pump Body (30 parts)
    - Impeller Assembly (20 parts)
    - Bearing Package (12 parts)
    - Sealing System (8 parts)
↓
User exports to STEP, runs FEA
↓
Enki analyzes:
  • Housing stress 320 MPa (yield 400) ✓
  • Wall thickness provides margin
  • Bearing speeds OK
  • Suggestion: "Add cooling fins for 15% better thermal control"
↓
User happy → ready for CAM/manufacturing
```

### Workflow 2: Design Iteration with Sim Feedback

```
FEA Results: Von Mises stress 850 MPa, yield 750 MPa → FAIL
↓
Enki suggests:
  1. Increase wall 4mm → 6mm (stress → 600 MPa) ✓
  2. Upgrade material (cost +$200, not needed)
  3. Add fillet radii R3 (stress conc → 0.7×) ✓
↓
User clicks "housing_001" part → selects thickness field
→ Changes 4 → 6 mm
→ "Apply Changes"
↓
Backend:
  • Identifies affected parts (seals, fasteners, thermal)
  • Updates assembly geometry
  • Maintains edit history
↓
User re-exports, re-runs FEA
↓
New stress: 610 MPa → PASS ✓
↓
User satisfied, ready for manufacturing
```

### Workflow 3: Subsystem Replacement

```
User concern: "Bearings wear too fast in 120°C environment"
↓
User selects subsystem "bearing_package" → 6 bearings
↓
Changes material: "6205-2RS C3" → "SKF 6308-2RS C4 EXPLORER"
↓
Backend updates:
  • New bore/OD/width → checks housing fit
  • Speed rating 12,000 RPM → clearance OK
  • Premium grease (HT 30) vs. standard Polyrex
  • Cost: +$8/unit per bearing
  • Preload calculation updated
↓
All 6 bearing parts updated simultaneously
↓
Dependent parts (shaft seals, etc.) marked for review
↓
User confirms changes, re-simulates
```

---

## Part Type Whitelist

The LLM has access to the complete official part type list:

**Structural**: plate, beam, bracket, housing, ibeam, strut, column, gusset, rib, web_plate, flange, dome, tank

**Rotary**: gear, shaft, bearing, spring, turbine_disk, flywheel, impeller, pulley, sprocket, coupling, damper

**Fluid**: piston, nozzle, pipe_straight, pipe_elbow, pipe_tee, valve_body, orifice, manifold

**Fasteners**: bolt_hex, bolt_socket, nut_hex, washer, screw_socket, screw_pan, screw_countersunk, rivet, dowel_pin, roll_pin, snap_ring, circlip, parallel_key, woodruff_key, shim, stud, thread_insert, set_screw

**Welds**: weld_fillet, weld_butt, weld_spot, weld_plug, braze, solder_joint

**Seals**: o_ring, gasket, lip_seal, v_ring, back_up_ring, felt_seal, mechanical_seal

**Electrical**: pcb, resistor, capacitor, inductor, ic_dip, ic_smd, connector_header, wire_segment, solder_joint, bus_bar, transformer, relay, fuse_holder, terminal_block, crystal, diode, transistor, led, mosfet, opamp

**Thermal**: heat_sink, heat_pipe, fin_array, tec_module, thermal_pad

**Specialty**: ablator, tile, mli_insulation, cable_tie, heat_shrink, foam_fill, label, handle

---

## Material Database

Full material properties included (60+ materials):
- Aluminum alloys (6061, 7075, 2024, etc.)
- Steel alloys (mild, 4130, 4340, 17-4PH, spring steel, tool steels)
- Stainless steels (304, 316, 316L)
- Titanium (CP2, 6Al4V, 6Al4V-ELI)
- High-temp alloys (Inconel, Hastelloy, Waspaloy)
- Copper, brass, bronze, magnesium
- Polymers (ABS, nylon, PEEK, PTFE, POM)
- Composites (carbon fiber, fiberglass, Nomex honeycomb)
- Electronics (solder alloys, FR4, copper)

Each material includes:
- Density, Young's modulus, Poisson's ratio
- Yield/tensile/fatigue strengths
- Thermal properties (conductivity, expansion, specific heat)
- Electrical properties, hardness, machinability
- Corrosion resistance, cost, availability

---

## Integration Checklist

To fully activate Enki V5:

### Backend
- [ ] Replace `SYSTEM_PROMPT` in `/copilot/contextual-analysis` endpoint with `ENKI_ENHANCED_SYSTEM_PROMPT`
- [ ] In `_buildAssemblyFromPlan()`, call `enrichAssemblyWithManufacturingData()`
- [ ] Add validation gate: call `validateAssemblyForManufacturability()`, display warnings
- [ ] Create POST `/enki/analyze-simulation` endpoint (calls `SimFeedbackAnalyzer`)
- [ ] Create POST `/enki/apply-edit` endpoint (calls `applyEditToAssembly()`)
- [ ] Create POST `/enki/generate` endpoint with full enrichment pipeline

### Frontend
- [ ] Import `EnkiPartEditor` into `enki.js`
- [ ] Call `editor.bindUI("#edit-panel")` on init
- [ ] Add edit panel container to HTML
- [ ] Wire up 3D click detection → `editor.selectPart(partId)`
- [ ] Display sim feedback suggestions in chat
- [ ] Add "Apply Edit" button workflow

---

## Key Design Principles

1. **Precision + Freedom**
   - Generate accurate, real-world assemblies
   - Designs are novel, not templated
   - Freedom constrained by physics & manufacturability

2. **No Placeholders**
   - Every part is individually specified (not copy-paste)
   - 4-cylinder engine has 4 distinct pistons, not "piston ×4"
   - Part count targets are mandatory

3. **Complete Digital Twin**
   - Ready for CNC machining, FEA, patent filing
   - All manufacturing data included
   - All tolerances achievable

4. **Sim-Driven Iteration**
   - Tight feedback loop: generate → simulate → analyze → edit → repeat
   - Enki suggests specific, quantified improvements
   - User can edit at any granularity

5. **Editable at Any Level**
   - Single bolt: change torque, material, locking method
   - Subsystem: replace all bearings, upgrade gearbox stage
   - Assembly: optimize for mass, cost, or performance

---

## Files Included

| File | Purpose |
|------|---------|
| `src/cad/enkiEnhancedSchema.mjs` | Part & assembly schema with manufacturing metadata |
| `src/cad/simFeedbackEngine.mjs` | Sim analyzer + suggestion generator |
| `src/cad/enkiPartEditor.js` | Hierarchical part editing UI |
| `src/cad/enkiIntegration.mjs` | Enrichment, validation, edit pipeline |
| `src/cad/enkiEnhancedPrompt.mjs` | LLM system prompt (15KB, comprehensive) |
| `src/cad/enkiIntegrationGuide.mjs` | Architecture overview, workflows, endpoints |

---

## Example Output

**User Request:**
"Design a gearbox reducer: 100 N·m input, 15:1 ratio, 92% efficiency, compact"

**Enki Output (partial):**
```json
{
  "assembly": true,
  "name": "Helical Gearbox Reducer — 2-Stage, 100 N·m/i=15, 92% η, Compact",
  "total_mass_kg": 24.5,
  "parts": [
    {
      "id": "housing_main",
      "name": "Gearbox Housing — Ductile Iron ASTM A536 65-45-12",
      "type": "housing",
      "material": "cast_iron_ductile",
      "dims": { "L": 280, "W": 150, "H": 140 },
      "manufacturing": {
        "primary_process": "casting",
        "operations": [
          { "operation": "Green sand casting", "equipment": "Foundry" },
          { "operation": "CNC finish machining all bores", "equipment": "CNC mill" }
        ]
      },
      "tolerances": {
        "bore_diameter_mm": "40 H7",
        "surface_finish_ra_um": 1.6,
        "tolerance_stack": {
          "total_stack_worst_case_mm": 0.15,
          "design_margin_mm": 0.08
        }
      },
      "mass_kg": 18.2
    },
    {
      "id": "stage1_pinion",
      "name": "Stage 1 Pinion — 20 teeth, Module 2.5, Helical 20° 4130 Steel",
      "type": "gear",
      "material": "steel_4130",
      "manufacturing": {
        "primary_process": "forging + hobbing",
        "operations": [
          { "operation": "Forged blank", "equipment": "Forge" },
          { "operation": "CNC rough bore", "equipment": "Lathe" },
          { "operation": "Hobbing teeth", "equipment": "Gear hobber", "spindle_rpm": 600 },
          { "operation": "Shaving/grinding tooth flanks", "equipment": "Gear grinder" }
        ]
      },
      "gear": {
        "module_mm": 2.5,
        "pitch_diameter_mm": 50,
        "number_of_teeth": 20,
        "face_width_mm": 25,
        "helix_angle_deg": 20,
        "backlash_nominal_mm": 0.075,
        "backlash_tolerance_mm": [0.05, 0.12],
        "gear_quality_grade": "AGMA 9",
        "surface_finish_tooth_flank_ra_um": 0.8
      },
      "mass_kg": 0.85
    },
    // ... 180+ more parts (all bearings, seals, fasteners, etc.)
  ],
  "subsystems": [
    {
      "id": "input_stage",
      "name": "Input Bearing Package",
      "parts": ["bearing_input_1", "bearing_input_2", "seal_input"],
      "criticality": "critical"
    },
    // ...
  ]
}
```

**Sim Feedback:**
```
Stress Analysis: Housing wall stress 420 MPa (yield 450) → ✓ OK
Gear Mesh: Center distance 75.2 mm, spec ±1 mm → ✓ OK
Backlash: 0.082 mm, spec [0.05–0.12] → ✓ OK
Thermal: Peak temp 68°C, limit 80°C → ✓ OK

Suggestions:
  HIGH: Add cooling fins to housing → 10°C reduction
  MEDIUM: Consider 6Al4V input shaft → 20% weight reduction (+$150)
  LOW: Upgrade oil to synthetic → extended drain interval

Status: PASS ✓ Ready for manufacturing
```

---

## Design Philosophy

Think of Enki as an expert mechanical engineer who:
- Has deep knowledge of manufacturing processes, material science, assembly mechanics
- Designs from FIRST PRINCIPLES (physics, not templates)
- Specifies EVERY detail because the user will manufacture and test this
- Iterates intelligently based on simulation feedback
- Balances performance, cost, weight, manufacturability

The output is suitable for:
✓ Handing to a machine shop for CNC programming  
✓ Submitting to CAD kernel for FEA  
✓ Filing with a patent attorney  
✓ Quoting to suppliers  
✓ Validating in physics simulation  

---

## Support

This is the complete Enki V5 implementation. For integration or customization, refer to:
- `enkiIntegrationGuide.mjs` — architecture details
- `enkiEnhancedSchema.mjs` — part schema reference
- `simFeedbackEngine.mjs` — suggestion algorithm details
- `enkiEnhancedPrompt.mjs` — LLM directives

**Ready to design!**

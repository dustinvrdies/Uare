/**
 * ENKI V5 ARCHITECTURE INTEGRATION GUIDE
 * How all pieces fit together: schema → generation → editing → simulation → feedback
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * WORKFLOW: User Request → Enki Design → Simulation → Iteration
 * 
 * 1. USER SUBMITS DESIGN REQUEST
 *    Input: "Design a 3-stage gearbox reducer, 100 N·m input, 10:1 ratio, efficiency >92%"
 * 
 * 2. ENKI GENERATION (in backend)
 *    - Call Claude with ENKI_ENHANCED_SYSTEM_PROMPT
 *    - Claude reasons about gearbox engineering:
 *      * Module selection based on input power & duty cycle
 *      * Gear tooth count, pitch diameters, center distances
 *      * Bearing selection for each shaft (input, intermediate, output)
 *      * Housing design (ductile iron or aluminum, wall thickness, rib placement)
 *      * All fasteners, seals, shims, oil baffles, dipstick provisions
 *      * Oil sump design, fill plug, drain, vent
 *      * Thermal analysis: surface area, oil circulation
 * 
 *    - Claude outputs COMPLETE JSON with 200+ parts
 *    - Backend calls enrichAssemblyWithManufacturingData()
 *      * Fills in material properties from MATERIAL_DATABASE
 *      * Infers manufacturing operations for each part type
 *      * Generates tolerance stack for each critical feature
 *      * Calculates estimated mass
 *      * Validates all parts against engineering constraints
 * 
 *    - Backend calls validateAssemblyForManufacturability()
 *      * Checks tolerance stacks vs. design margins
 *      * Verifies surface finishes are achievable
 *      * Confirms processes are feasible
 * 
 * 3. FRONTEND RENDERS 3D VIEWPORT
 *    - Display assembly tree (subsystems → parts)
 *    - Show BOM with part counts, masses, materials
 *    - Highlight critical parts or constraints
 * 
 * 4. USER RUNS SIMULATION (user choice)
 *    - Exports assembly to STEP format
 *    - Runs FEA (stress, deflection, thermal)
 *    - Simulation returns results JSON
 * 
 * 5. ENKI ANALYZES SIMULATION RESULTS
 *    - Backend calls analyzeCycleAndGenerateSuggestions()
 *    - SimFeedbackAnalyzer evaluates:
 *      * Stress vs. yield (is there margin? are concentrations >1.5×?)
 *      * Deflection vs. allowable (affects clearances & gear mesh)
 *      * Temperature vs. material limits (lubrication breakdown, seal degradation)
 *      * Gear mesh: center distance tolerance, backlash band
 *      * Fatigue (if cyclic loads): S-N curve, safety factor >2
 *      * Manufacturability: tolerance stack achievability, surface finish feasibility
 * 
 *    - Generates suggestions (HIGH priority only):
 *      * "Wall too thin—increase from 4mm to 6mm to reduce peak stress from 850 to 600 MPa"
 *      * "Bearing speed 8200 RPM exceeds limit 6000 RPM—use 7308-BECBP instead"
 *      * "Gear mesh backlash 0.18 mm is high (spec 0.05–0.15)—reduce center distance by 0.3 mm"
 * 
 * 6. USER EDITS (flexible granularity)
 *    a) PART-LEVEL EDIT:
 *       User: "Increase housing wall thickness to 6 mm"
 *       → Frontend calls EnkiPartEditor.selectPart("housing_001")
 *       → User adjusts thickness in form
 *       → Click "Apply Changes"
 *       → Backend calls applyEditToAssembly()
 *       → Affected parts (stress-dependent geometry) marked for recomputation
 * 
 *    b) SUBSYSTEM-LEVEL EDIT:
 *       User: "Replace bearing package with ceramic hybrids"
 *       → Frontend calls EnkiPartEditor.selectSubsystem("bearing_package")
 *       → Selects all 6 bearing parts
 *       → User changes material from "steel" to "hybrid_ceramic"
 *       → Backend recomputes:
 *          * Updated load ratings
 *          * Changed speed limits (ceramic typically higher)
 *          * Different lubrication strategy
 *          * Possible housing bore redesign
 *       → All dependent geometry marked for re-evaluation
 * 
 *    c) ASSEMBLY-LEVEL CONSTRAINT:
 *       User: "Make it 15% lighter overall"
 *       → Claude re-analyzes:
 *          * Reduce wall thickness (min 0.1×critical stress radius)
 *          * Upgrade from aluminum to titanium on high-stress sections
 *          * Reduce fastener sizes (use M6 instead of M8 where possible)
 *          * Optimized rib placement using stress contours
 *       → Generates updated assembly JSON
 * 
 * 7. RE-SIMULATE & VERIFY
 *    - Run FEA again on edited design
 *    - Enki provides new suggestions
 *    - Iterate until satisfied
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * KEY INTEGRATION POINTS
 */

export const INTEGRATION_CHECKLIST = [
  {
    phase: 'LLM Setup',
    tasks: [
      'Replace SYSTEM_PROMPT in enki.js with ENKI_ENHANCED_SYSTEM_PROMPT',
      'Ensure Claude receives full context: material database, part types, assembly examples',
      'Test generation with simple assembly (e.g., bearing package, ~40 parts)',
    ],
  },
  {
    phase: 'Data Enrichment',
    tasks: [
      'In _buildAssemblyFromPlan(), call enrichAssemblyWithManufacturingData()',
      'Pass MATERIAL_DATABASE to enrichment function',
      'Store enriched assembly in _assembly global',
    ],
  },
  {
    phase: 'Validation',
    tasks: [
      'Call validateAssemblyForManufacturability() after enrichment',
      'Display warnings/errors in engineering QC panel',
      'Prevent design handoff if critical issues detected',
    ],
  },
  {
    phase: 'Simulation Integration',
    tasks: [
      'Add simulation results input to Enki chat (user pastes JSON or API auto-pull)',
      'Call analyzeCycleAndGenerateSuggestions() to generate feedback',
      'Display suggestions in dedicated panel (with icons for priority)',
    ],
  },
  {
    phase: 'Editing UI',
    tasks: [
      'Instantiate EnkiPartEditor in enki.js',
      'Bind bindUI() to edit panel container',
      'Wire onEditCallback to applyEditToAssembly()',
      'Track edit history in assembly.edit_history',
    ],
  },
  {
    phase: 'Smart Recomputation',
    tasks: [
      'When user applies edit, use EditDependencyTracker to identify affected parts',
      'Send affected part IDs + edit fields to backend',
      'Backend can choose: (a) update geometry, (b) re-generate from Enki',
      'Update 3D viewport incrementally',
    ],
  },
  {
    phase: 'Export & Manufacturing',
    tasks: [
      'Export to STEP with all manufacturing metadata embedded (comments)',
      'Generate manufacturing cost estimate from operation list + material costs',
      'Generate assembly work instruction PDF from assembly_sequence',
      'Tolerance stack diagram generator',
    ],
  },
];

/**
 * EXAMPLE: Simple Pump Assembly Workflow
 */

export const EXAMPLE_WORKFLOW_PUMP = {
  user_prompt: 'Design a centrifugal pump: 50 GPM at 2 bar discharge, 1500 RPM, low-noise design',

  step_1_generation: {
    description: 'Claude generates pump with enhanced schema',
    claude_reasoning: `
      Centrifugal pump design factors:
      - 50 GPM = 3.16 L/s
      - 2 bar discharge = 0.2 MPa
      - 1500 RPM = 25 Hz shaft speed
      - Impeller diameter: sqrt(4 × Q / (π × n)) ≈ 100mm impeller not optimal
        → Try 6-blade 80mm impeller, inducer inlet
      - Required head: 2 bar = 20.4 m H2O
      - Pump efficiency ~85% at this duty
      - Power = (Q × ρ × g × H) / η ≈ 3.8 kW motor
      
      Shaft: 25mm bore, supported by 2 deep-groove ball bearings
      Housing: Ductile iron, 15 parts (pump body, cover, end plates, etc.)
      Impeller: Aluminum 6061-T6, 18 separate blade models (!), hub
      Fasteners: M8×1.25 cap screws × 8, lock washers
      Seals: Mechanical face seal (tungsten carbide), elastomer bellows
      Coupling: Elastomeric flexible coupling to motor
      
      Total parts: ~80 (impeller blade count alone pushes this)
    `,
    claude_output: {
      assembly: true,
      name: 'Centrifugal Water Pump — 50 GPM @ 2 bar, 3.8 kW, 1500 RPM',
      total_mass_kg: 18.5,
      parts: [
        // 6 impeller blades specified separately (curved surfaces)
        // 2 bearings (inner race, outer race, 8 balls each)
        // Shaft with 3 step diameters
        // Housing: main body, cover plate, inlet flange, discharge flange
        // Seals, fasteners (8 cap screws, 8 lock washers, 2 O-rings)
        // Thermal relief valve, drain plugs, labels
        // Total: 85 parts
      ],
    },
  },

  step_2_enrichment: {
    description: 'Backend enriches with manufacturing data',
    input: '85-part assembly from Claude',
    functions_called: [
      'enrichAssemblyWithManufacturingData(assembly, MATERIAL_DATABASE)',
      'validateAssemblyForManufacturability(enriched_assembly)',
    ],
    output: {
      enriched_parts: 85,
      material_properties_filled: true,
      operations_inferred: true,
      tolerances_generated: true,
      validation_status: 'PASS',
      warnings: [
        'Impeller bore tolerance H7 on aluminum may be difficult (softer material—use carbide tooling)',
        'Blade surface finish Ra 0.8 μm requires CNC finish pass (casting + 2 operations)',
      ],
    },
  },

  step_3_rendering: {
    description: 'Frontend displays pump in 3D + BOM',
    shows: [
      'Assembly tree: Pump Housing (30 parts) → Impeller Assembly (20) → Bearing Package (12) → Sealing System (8)',
      'BOM with 85 line items, total mass 18.5 kg, material breakdown',
      'Critical parts highlighted (bearings, seal, impeller)',
    ],
  },

  step_4_simulation: {
    description: 'User exports to STEP and runs FEA',
    user_action: 'Click "Export → STEP" → imports into COMSOL',
    simulation_runs: [
      'Structural: wall stress from pressure (2 bar internal)',
      'Thermal: heat dissipation from pump shaft friction',
      'CFD: impeller blade loading, flow uniformity',
    ],
    simresults: {
      max_von_mises_stress: 320,
      yield_strength_ductile_iron: 400,
      stress_ratio: 0.8,
      max_temperature: 65,
      thermal_stress: 'negligible',
    },
  },

  step_5_feedback: {
    description: 'Enki analyzes sim results',
    analyzer_call: 'analyzeCycleAndGenerateSuggestions(assembly, simResults)',
    findings: {
      issues: [],
      warnings: [],
      suggestions: [
        {
          type: 'optimization',
          suggestion: 'Stress ratio 0.8 is good. Consider: (1) Add cooling fins to pump body for better thermal control, or (2) Upgrade bearing to sealed type (2RS) for better protection in humid environments.',
        },
      ],
    },
    summary: 'Design is SAFE. Ready for manufacturing.',
  },

  step_6_iteration: {
    description: 'User wants lower noise',
    edit: "Add elastomeric bearing isolators under motor feet (not part of pump, but noted)",
    result: 'No changes to pump itself; added documentation',
  },

  step_7_export: {
    description: 'User exports for manufacturing',
    actions: [
      'STEP file for CNC programming',
      'Manufacturing cost estimate: 85 parts × $2 avg = $170 material + $450 labor = $620/unit',
      'Assembly work instruction (30 steps)',
      'Tolerance stack diagram (6 critical stacks checked)',
    ],
  },
};

/**
 * BACKEND ENDPOINT RECOMMENDATIONS
 */

export const BACKEND_ENDPOINTS_NEEDED = [
  {
    endpoint: 'POST /enki/generate',
    description: 'LLM-based assembly generation',
    input: { design_intent: string, constraints: object },
    output: {
      assembly_plan: object,
      enriched_assembly: object,
      validation_report: object,
    },
  },
  {
    endpoint: 'POST /enki/analyze-simulation',
    description: 'Analyze sim results + generate suggestions',
    input: { assembly_id: string, simResults: object },
    output: {
      suggestions: array,
      issues: array,
      narrative: string,
    },
  },
  {
    endpoint: 'POST /enki/apply-edit',
    description: 'Apply user edit to assembly, recompute affected parts',
    input: {
      assembly_id: string,
      selected_parts: array,
      edits: object,
      edit_mode: 'part' | 'subsystem' | 'assembly',
    },
    output: {
      updated_assembly: object,
      affected_parts: array,
      recomputation_status: string,
    },
  },
  {
    endpoint: 'GET /enki/assembly/:id/bom',
    description: 'Get BOM for assembly (with all manufacturing info)',
    output: {
      line_items: array,
      total_cost: number,
      lead_time_days: number,
      mass_summary: object,
    },
  },
];

export default {
  INTEGRATION_CHECKLIST,
  EXAMPLE_WORKFLOW_PUMP,
  BACKEND_ENDPOINTS_NEEDED,
};

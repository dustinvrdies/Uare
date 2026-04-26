/**
 * SIM-FEEDBACK ANALYSIS ENGINE
 * Analyzes simulation results and suggests design improvements to Enki
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class SimFeedbackAnalyzer {
  constructor(assembly, simResults) {
    this.assembly = assembly;
    this.simResults = simResults;
    this.suggestions = [];
    this.flaggedIssues = [];
  }

  /**
   * Analyze all simulation results and generate suggestions
   */
  analyze() {
    if (!this.simResults) return { suggestions: [], issues: [] };

    this.flaggedIssues = [];
    this.suggestions = [];

    // Run analysis modules
    this._analyzeStress();
    this._analyzeDeflection();
    this._analyzeThermal();
    this._analyzeGearMesh();
    this._analyzeFatigue();
    this._analyzeManufacturability();

    return {
      suggestions: this.suggestions,
      issues: this.flaggedIssues,
      summary: this._generateSummary(),
    };
  }

  /**
   * STRESS ANALYSIS: von Mises, principal stresses, concentration points
   */
  _analyzeStress() {
    const stress = this.simResults.stress_analysis;
    if (!stress) return;

    const maxVonMises = stress.max_von_mises_mpa || 0;
    const avgStress = stress.avg_stress_mpa || 0;

    // Find highly stressed parts
    const parts = this.assembly.parts || [];
    const stressedParts = stress.stress_by_part || [];

    stressedParts.forEach((partStress) => {
      const part = parts.find((p) => p.id === partStress.part_id);
      if (!part) return;

      const yieldStrength = part.engineering?.yield_strength_actual_mpa || 250;
      const ratio = partStress.max_stress_mpa / yieldStrength;

      // CRITICAL: Stress exceeds 90% of yield
      if (ratio > 0.9) {
        this.flaggedIssues.push({
          severity: 'critical',
          part_id: part.id,
          part_name: part.name,
          issue_type: 'stress_exceeds_yield',
          current_value: partStress.max_stress_mpa.toFixed(1),
          limit: yieldStrength.toFixed(1),
          message: `Von Mises stress ${partStress.max_stress_mpa.toFixed(1)} MPa exceeds 90% of yield (${yieldStrength.toFixed(1)} MPa). FAIL.`,
          safety_factor: (yieldStrength / partStress.max_stress_mpa).toFixed(2),
        });
      }

      // WARNING: Stress exceeds 70% of yield
      if (ratio > 0.7 && ratio <= 0.9) {
        this.flaggedIssues.push({
          severity: 'warning',
          part_id: part.id,
          part_name: part.name,
          issue_type: 'stress_high',
          current_value: partStress.max_stress_mpa.toFixed(1),
          limit: yieldStrength.toFixed(1),
          message: `Von Mises stress ${partStress.max_stress_mpa.toFixed(1)} MPa is ${(ratio * 100).toFixed(1)}% of yield.`,
          safety_factor: (yieldStrength / partStress.max_stress_mpa).toFixed(2),
        });
      }

      // SUGGESTION: Thicken the wall
      if (ratio > 0.6) {
        const wallThickness = part.dims?.h || part.dims?.thickness || null;
        if (wallThickness) {
          const suggestedThickness = wallThickness * Math.sqrt(1 / (1 - (ratio - 0.5)));
          this.suggestions.push({
            priority: 'high',
            type: 'dimension_increase',
            part_id: part.id,
            part_name: part.name,
            affected_field: 'wall_thickness|height',
            current_value: wallThickness,
            suggested_value: Math.ceil(suggestedThickness * 2) / 2,  // round to 0.5mm
            reason: `Stress is ${(ratio * 100).toFixed(1)}% of yield. Increasing wall thickness to ${suggestedThickness.toFixed(1)} mm will reduce stress to ~50% of yield.`,
            stress_reduction_percent: ((1 - 0.5 / ratio) * 100).toFixed(0),
          });
        }
      }

      // SUGGESTION: Upgrade material
      if (ratio > 0.75 && ratio < 0.95) {
        const currentMaterial = part.material || 'steel';
        const upgradedMaterial = this._suggestMaterialUpgrade(currentMaterial, ratio);
        if (upgradedMaterial) {
          this.suggestions.push({
            priority: 'high',
            type: 'material_upgrade',
            part_id: part.id,
            part_name: part.name,
            current_value: currentMaterial,
            suggested_value: upgradedMaterial.name,
            reason: `Current material (${currentMaterial}) yields at ${yieldStrength} MPa. Upgrading to ${upgradedMaterial.name} (yield ${upgradedMaterial.yield_strength_mpa} MPa) provides better safety margin.`,
            stress_reduction_percent: 0,
            cost_delta_usd: upgradedMaterial.cost_delta_usd,
            weight_delta_percent: upgradedMaterial.weight_delta_percent,
          });
        }
      }

      // SUGGESTION: Add fillet radii at stress concentration
      if (partStress.stress_concentration_factor > 1.5) {
        this.suggestions.push({
          priority: 'high',
          type: 'geometry_optimization',
          part_id: part.id,
          part_name: part.name,
          affected_field: 'fillet_radius',
          current_value: partStress.stress_concentration_factor,
          suggested_value: partStress.stress_concentration_factor * 0.7,
          reason: `Stress concentration factor is ${partStress.stress_concentration_factor.toFixed(2)}. Increasing fillet radii will reduce local peak stress.`,
          stress_reduction_percent: ((1 - 0.7 / partStress.stress_concentration_factor) * 100).toFixed(0),
        });
      }
    });
  }

  /**
   * DEFLECTION ANALYSIS: Check for excessive part movement
   */
  _analyzeDeflection() {
    const deflection = this.simResults.deflection_analysis;
    if (!deflection) return;

    const maxDeflection = deflection.max_deflection_mm || 0;
    const allowableDeflection = deflection.allowable_deflection_mm || 1.0;

    if (maxDeflection > allowableDeflection * 0.8) {
      this.flaggedIssues.push({
        severity: maxDeflection > allowableDeflection ? 'critical' : 'warning',
        issue_type: 'excessive_deflection',
        current_value: maxDeflection.toFixed(3),
        limit: allowableDeflection.toFixed(3),
        message: `Max deflection ${maxDeflection.toFixed(3)} mm exceeds allowable ${allowableDeflection.toFixed(3)} mm.`,
      });

      this.suggestions.push({
        priority: 'high',
        type: 'stiffness_improvement',
        affected_field: 'material_selection|geometry',
        current_value: maxDeflection,
        suggested_value: allowableDeflection,
        reason: `Deflection of ${maxDeflection.toFixed(3)} mm affects clearances. Increase material stiffness (higher Young's modulus) or increase cross-section area.`,
        stiffness_improvement_needed: (maxDeflection / allowableDeflection).toFixed(2),
      });
    }
  }

  /**
   * THERMAL ANALYSIS: Check for thermal stress and operating limits
   */
  _analyzeThermal() {
    const thermal = this.simResults.thermal_analysis;
    if (!thermal) return;

    const maxTemp = thermal.max_temperature_c || 0;
    const tempGradient = thermal.max_temperature_gradient_c_per_mm || 0;
    const operatingTemp = this.assembly.performance?.operating_temperature_c || 85;
    const maxOperatingTemp = this.assembly.performance?.max_temperature_c || 120;

    // Temperature exceeds limit
    if (maxTemp > maxOperatingTemp) {
      this.flaggedIssues.push({
        severity: 'critical',
        issue_type: 'temperature_exceeds_limit',
        current_value: maxTemp.toFixed(1),
        limit: maxOperatingTemp.toFixed(1),
        message: `Peak temperature ${maxTemp.toFixed(1)}°C exceeds max operating temperature ${maxOperatingTemp}°C.`,
      });

      this.suggestions.push({
        priority: 'critical',
        type: 'thermal_management',
        affected_field: 'cooling_system|material|geometry',
        reason: `Increase heat dissipation: add cooling fins, increase surface area, or upgrade to material with better thermal conductivity.`,
        thermal_delta_c: (maxTemp - maxOperatingTemp).toFixed(1),
      });
    }

    // Thermal gradient too steep (can cause warping, cracking)
    if (tempGradient > 10) {
      this.suggestions.push({
        priority: 'medium',
        type: 'thermal_stability',
        affected_field: 'insulation|heat_distribution',
        reason: `Thermal gradient ${tempGradient.toFixed(2)}°C/mm is steep. Add insulation or improve heat distribution to prevent warping.`,
        gradient_c_per_mm: tempGradient.toFixed(2),
      });
    }
  }

  /**
   * GEAR MESH ANALYSIS: Backlash, center distance, contact stress
   */
  _analyzeGearMesh() {
    const gearMesh = this.simResults.gear_mesh_analysis;
    if (!gearMesh) return;

    gearMesh.stage_analyses?.forEach((stage) => {
      // Center distance tolerance
      const centerDelta = stage.actual_center_distance_mm - stage.expected_center_distance_mm;
      const maxCenterTol = 1.0;  // mm

      if (Math.abs(centerDelta) > maxCenterTol) {
        this.flaggedIssues.push({
          severity: 'warning',
          issue_type: 'gear_center_tolerance_exceeded',
          stage: stage.stage_name,
          current_value: centerDelta.toFixed(3),
          limit: maxCenterTol,
          message: `${stage.stage_name} center distance deviation ${centerDelta.toFixed(3)} mm exceeds tolerance ±${maxCenterTol} mm.`,
        });
      }

      // Backlash check
      const backlash = stage.estimated_backlash_mm;
      const [minBacklash, maxBacklash] = stage.backlash_band_mm || [0.03, 0.15];

      if (backlash < minBacklash || backlash > maxBacklash) {
        this.flaggedIssues.push({
          severity: backlash < minBacklash ? 'critical' : 'warning',
          issue_type: 'gear_backlash_out_of_spec',
          stage: stage.stage_name,
          current_value: backlash.toFixed(3),
          limit: `${minBacklash.toFixed(3)}–${maxBacklash.toFixed(3)}`,
          message: `${stage.stage_name} backlash ${backlash.toFixed(3)} mm is outside spec ${minBacklash.toFixed(3)}–${maxBacklash.toFixed(3)} mm.`,
        });

        this.suggestions.push({
          priority: 'high',
          type: 'gear_adjustment',
          stage: stage.stage_name,
          affected_field: 'center_distance_mm|backlash_tolerance',
          current_value: backlash.toFixed(3),
          suggested_adjustment: this._calcBacklashAdjustment(backlash, minBacklash, maxBacklash),
          reason: `Adjust center distance or shim gears to bring backlash into spec.`,
        });
      }

      // Contact stress
      const contactStress = stage.contact_stress_mpa || 0;
      const maxContactStress = 1200;  // typical limit
      if (contactStress > maxContactStress) {
        this.suggestions.push({
          priority: 'high',
          type: 'gear_material_upgrade',
          stage: stage.stage_name,
          reason: `Contact stress ${contactStress.toFixed(0)} MPa exceeds limit. Upgrade to higher-strength material or increase module (larger teeth).`,
          contact_stress_mpa: contactStress.toFixed(0),
        });
      }
    });
  }

  /**
   * FATIGUE ANALYSIS: Cyclic stress, S-N curve, safety factor
   */
  _analyzeFatigue() {
    const fatigue = this.simResults.fatigue_analysis;
    if (!fatigue) return;

    const fatigueStress = fatigue.equivalent_fatigue_stress_mpa || 0;
    const fatigueLimit = fatigue.material_fatigue_limit_mpa || 100;
    const safetyFactor = fatigueLimit / fatigueStress;

    if (safetyFactor < 2.0) {
      this.flaggedIssues.push({
        severity: safetyFactor < 1.0 ? 'critical' : 'warning',
        issue_type: 'fatigue_safety_margin_low',
        current_value: safetyFactor.toFixed(2),
        limit: '2.0',
        message: `Fatigue safety factor ${safetyFactor.toFixed(2)} is below recommended 2.0.`,
      });

      this.suggestions.push({
        priority: 'high',
        type: 'fatigue_improvement',
        affected_field: 'material_upgrade|geometry_smoothing|surface_finish',
        reason: `Improve fatigue resistance by: (1) upgrading material, (2) smoothing stress concentration areas with larger radii, or (3) improving surface finish (reduces stress concentration).`,
        current_safety_factor: safetyFactor.toFixed(2),
        target_safety_factor: 2.0,
      });
    }
  }

  /**
   * MANUFACTURABILITY: Check tolerances, material properties, surface finish feasibility
   */
  _analyzeManufacturability() {
    const parts = this.assembly.parts || [];

    parts.forEach((part) => {
      // Check if tolerance stack is achievable
      if (part.tolerances?.tolerance_stack) {
        const stack = part.tolerances.tolerance_stack;
        if (stack.total_stack_worst_case_mm > stack.design_margin_mm) {
          this.flaggedIssues.push({
            severity: 'warning',
            part_id: part.id,
            part_name: part.name,
            issue_type: 'tolerance_stack_too_tight',
            message: `Tolerance stack ${stack.total_stack_worst_case_mm.toFixed(3)} mm exceeds design margin ${stack.design_margin_mm.toFixed(3)} mm. May be unmanufacturable.`,
          });

          this.suggestions.push({
            priority: 'high',
            type: 'tolerance_relaxation',
            part_id: part.id,
            part_name: part.name,
            reason: `Loosen individual tolerances slightly, or redesign to reduce stacking elements. Consider statistical tolerance (RSS) instead of worst-case.`,
            stack_mm: stack.total_stack_worst_case_mm.toFixed(3),
            margin_mm: stack.design_margin_mm.toFixed(3),
          });
        }
      }

      // Check surface finish achievability
      if (part.tolerances?.surface_finish_ra_um) {
        const sf = part.tolerances.surface_finish_ra_um;
        const process = part.manufacturing?.primary_process || 'turning';
        const achievableFinishes = {
          turning: 0.8,
          milling: 1.6,
          grinding: 0.4,
          honing: 0.2,
          lapping: 0.1,
        };
        const achievable = achievableFinishes[process] || 1.6;
        if (sf < achievable * 0.8) {
          this.suggestions.push({
            priority: 'medium',
            type: 'surface_finish_process',
            part_id: part.id,
            part_name: part.name,
            reason: `Surface finish Ra ${sf} μm is very tight for ${process}. Consider additional polishing or switching to honing/grinding.`,
            current_finish_um: sf,
            process: process,
          });
        }
      }

      // Check material machinability
      const material = part.material || 'steel';
      const machining = part.manufacturing?.operations || [];
      if (machining.length > 0) {
        const isSoftMaterial = material.includes('aluminum') || material.includes('brass');
        if (!isSoftMaterial && machining.some((op) => op.feed_rate_mm_rev > 0.5)) {
          this.suggestions.push({
            priority: 'low',
            type: 'machining_optimization',
            part_id: part.id,
            part_name: part.name,
            reason: `Material ${material} is hard to machine. Consider reducing feed rates or using coated carbide tools to improve tool life.`,
          });
        }
      }
    });
  }

  /**
   * Generate a narrative summary of all findings
   */
  _generateSummary() {
    const critical = this.flaggedIssues.filter((i) => i.severity === 'critical').length;
    const warnings = this.flaggedIssues.filter((i) => i.severity === 'warning').length;
    const high_priority_suggestions = this.suggestions.filter((s) => s.priority === 'high').length;

    return {
      total_issues: this.flaggedIssues.length,
      critical_issues: critical,
      warnings: warnings,
      total_suggestions: this.suggestions.length,
      high_priority_suggestions: high_priority_suggestions,
      status: critical > 0 ? 'FAIL' : warnings > 0 ? 'WARNING' : 'PASS',
      next_steps:
        critical > 0
          ? `Address ${critical} critical issues before proceeding.`
          : high_priority_suggestions > 0
            ? `Consider ${high_priority_suggestions} high-priority design improvements.`
            : 'Design is within acceptable limits.',
    };
  }

  /**
   * Suggest material upgrade based on current stress ratio
   */
  _suggestMaterialUpgrade(currentMaterial, stressRatio) {
    const upgrades = {
      steel: { name: 'steel_4340', yield_strength_mpa: 750, cost_delta_usd: 1.5, weight_delta_percent: 0 },
      steel_4130: { name: 'steel_4340', yield_strength_mpa: 750, cost_delta_usd: 2.0, weight_delta_percent: 0 },
      aluminum_6061: { name: 'aluminum_7075_t6', yield_strength_mpa: 505, cost_delta_usd: 2.5, weight_delta_percent: 4 },
      titanium_cp2: { name: 'titanium_6al4v', yield_strength_mpa: 880, cost_delta_usd: 5.0, weight_delta_percent: -5 },
    };
    return upgrades[currentMaterial] || null;
  }

  /**
   * Calculate backlash adjustment (shim thickness, center distance delta)
   */
  _calcBacklashAdjustment(current, min, max) {
    if (current < min) {
      return { type: 'reduce_center_distance', adjustment_mm: (current - min).toFixed(3) };
    } else if (current > max) {
      return { type: 'increase_center_distance', adjustment_mm: (current - max).toFixed(3) };
    }
    return null;
  }
}

/**
 * Enki Suggestion Formatter — converts raw suggestions into friendly prompts for the LLM
 */
export function formatSuggestionsForEnki(suggestions, issues) {
  const lines = [];

  if (issues.length > 0) {
    lines.push('**Issues Found:**');
    issues.forEach((issue) => {
      const severity = issue.severity === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING';
      lines.push(`  ${severity}: ${issue.message}`);
    });
  }

  if (suggestions.length > 0) {
    lines.push('\n**Design Suggestions:**');
    suggestions
      .filter((s) => s.priority === 'high' || s.priority === 'critical')
      .slice(0, 5)
      .forEach((sug) => {
        const emoji =
          sug.type === 'dimension_increase'
            ? '📏'
            : sug.type === 'material_upgrade'
              ? '🧪'
              : sug.type === 'geometry_optimization'
                ? '🔧'
                : '💡';
        lines.push(`  ${emoji} **${sug.type}**: ${sug.reason}`);
        if (sug.suggested_value) lines.push(`     → Change ${sug.affected_field} to ${sug.suggested_value}`);
      });
  }

  return lines.join('\n');
}

export default {
  SimFeedbackAnalyzer,
  formatSuggestionsForEnki,
};

/**
 * Enki V5 Simulation Feedback Engine
 * Analyzes FEA & physics results, generates design improvement suggestions
 */

export class SimFeedbackAnalyzer {
  constructor(assembly = {}, simResults = {}) {
    this.assembly = assembly;
    this.sim = simResults;
  }
  
  analyze() {
    const suggestions = [];
    const issues = [];
    const summary = {
      status: 'PASS',
      pass_count: 0,
      fail_count: 0,
      warning_count: 0,
    };
    
    if (this.sim.stress_analysis) {
      this._analyzeStress(suggestions, issues, summary);
    }
    if (this.sim.deflection_analysis) {
      this._analyzeDeflection(suggestions, issues, summary);
    }
    if (this.sim.thermal_analysis) {
      this._analyzeThermal(suggestions, issues, summary);
    }
    if (this.sim.fatigue_analysis) {
      this._analyzeFatigue(suggestions, issues, summary);
    }
    if (this.sim.manufacturability_check) {
      this._analyzeManufacturability(suggestions, issues, summary);
    }
    
    if (issues.length > 0) {
      summary.status = 'FAIL';
      summary.fail_count = issues.filter(i => i.severity === 'CRITICAL').length;
    }
    
    return {
      suggestions,
      issues,
      summary,
      narrative: this._generateNarrative(suggestions, issues, summary),
    };
  }
  
  _analyzeStress(suggestions, issues, summary) {
    const stressData = this.sim.stress_analysis || {};
    const maxStress = stressData.max_stress_mpa || 0;
    const yieldStrength = stressData.yield_strength_mpa || 300;
    const safetyFactor = yieldStrength / Math.max(maxStress, 1);
    
    if (safetyFactor < 1.0) {
      issues.push({
        severity: 'CRITICAL',
        type: 'stress_failure',
        message: `🔴 CRITICAL: Von Mises stress ${maxStress.toFixed(0)} MPa EXCEEDS yield ${yieldStrength.toFixed(0)} MPa`,
        affected_parts: stressData.highest_stress_parts || [],
      });
      summary.fail_count++;
    } else if (safetyFactor < 1.5) {
      issues.push({
        severity: 'WARNING',
        type: 'low_safety_factor',
        message: `⚠️ WARNING: Safety factor ${safetyFactor.toFixed(2)}× is below recommended 1.5×`,
        affected_parts: stressData.highest_stress_parts || [],
      });
      summary.warning_count++;
    } else {
      summary.pass_count++;
    }
    
    // Generate improvement suggestions
    if (maxStress > 0.5 * yieldStrength) {
      const thickness_scale = Math.sqrt(1.3 * maxStress / (0.5 * yieldStrength));
      suggestions.push({
        priority: 'HIGH',
        category: 'structural_reinforcement',
        issue: `High stress region (${maxStress.toFixed(0)} MPa)`,
        recommendation: `Increase wall thickness ${(thickness_scale * 100 - 100).toFixed(0)}% in high-stress areas`,
        impact: `Predicted stress reduction to ${(maxStress / thickness_scale).toFixed(0)} MPa (SF ${(yieldStrength / (maxStress / thickness_scale)).toFixed(2)}×)`,
        effort: 'Low (geometry-only change)',
      });
      
      suggestions.push({
        priority: 'MEDIUM',
        category: 'material_upgrade',
        recommendation: `Upgrade from ${stressData.material || 'current material'} to higher-strength grade`,
        impact: `+${Math.round((yieldStrength * 1.5 - yieldStrength) / yieldStrength * 100)}% yield strength available`,
        effort: 'Medium (material spec + supplier qualification)',
      });
    }
  }
  
  _analyzeDeflection(suggestions, issues, summary) {
    const deflData = this.sim.deflection_analysis || {};
    const maxDeflection = deflData.max_deflection_mm || 0;
    const allowableDeflection = deflData.allowable_deflection_mm || 1.0;
    
    if (maxDeflection > allowableDeflection) {
      issues.push({
        severity: 'WARNING',
        type: 'excessive_deflection',
        message: `📏 Deflection ${maxDeflection.toFixed(2)} mm exceeds allowable ${allowableDeflection.toFixed(2)} mm`,
        affected_parts: deflData.highest_deflection_parts || [],
      });
      summary.warning_count++;
      
      const stiffness_multiplier = maxDeflection / allowableDeflection;
      suggestions.push({
        priority: 'HIGH',
        category: 'stiffness_improvement',
        recommendation: `Increase section modulus by ${((stiffness_multiplier - 1) * 100).toFixed(0)}%`,
        sub_options: [
          `Increase thickness from ${deflData.current_thickness_mm || '?'} to ${(deflData.current_thickness_mm * Math.sqrt(stiffness_multiplier) || '?').toFixed(1)} mm`,
          `Add internal ribs or webs (local stiffness +200%)`,
          `Switch to higher Young's modulus material (e.g., titanium +60% vs aluminum)`,
        ],
        impact: `Predicted deflection reduction to ${(maxDeflection / stiffness_multiplier).toFixed(3)} mm`,
        effort: 'Medium (geometry + FEA re-run)',
      });
    } else {
      summary.pass_count++;
    }
  }
  
  _analyzeThermal(suggestions, issues, summary) {
    const thermData = this.sim.thermal_analysis || {};
    const maxTemp = thermData.max_temp_c || 0;
    const maxServiceTemp = thermData.max_service_temp_c || 100;
    
    if (maxTemp > maxServiceTemp) {
      issues.push({
        severity: 'CRITICAL',
        type: 'thermal_failure',
        message: `🔥 CRITICAL: Peak temperature ${maxTemp.toFixed(0)}°C exceeds max service ${maxServiceTemp.toFixed(0)}°C`,
        affected_parts: thermData.hottest_parts || [],
      });
      summary.fail_count++;
      
      const temp_margin = maxTemp - maxServiceTemp;
      suggestions.push({
        priority: 'CRITICAL',
        category: 'thermal_management',
        recommendation: `Implement active cooling or increase heat dissipation by ${(temp_margin * 1.2).toFixed(0)}°C margin`,
        options: [
          `Add heat sink (estimated -${Math.min(temp_margin + 10, 50).toFixed(0)}°C)`,
          `Increase air flow velocity (${((temp_margin / 40) + 1).toFixed(1)}× current)`,
          `Change material to higher k (thermal conductivity) alloy`,
          `Reduce internal heat generation (lower operating power)`,
        ],
        effort: 'High (design + mechanical integration)',
      });
    } else if (maxTemp > maxServiceTemp * 0.8) {
      issues.push({
        severity: 'WARNING',
        type: 'thermal_margin_low',
        message: `⚠️ Thermal margin only ${(maxServiceTemp - maxTemp).toFixed(0)}°C — low safety buffer`,
      });
      summary.warning_count++;
      
      suggestions.push({
        priority: 'MEDIUM',
        category: 'thermal_margin',
        recommendation: `Consider thermal derating or add cooling redundancy`,
        impact: `Improves reliability under transient conditions`,
      });
    } else {
      summary.pass_count++;
    }
  }
  
  _analyzeFatigue(suggestions, issues, summary) {
    const fatigData = this.sim.fatigue_analysis || {};
    const sn_curve_safety = fatigData.sn_curve_safety_factor || 2.0;
    
    if (sn_curve_safety < 1.0) {
      issues.push({
        severity: 'CRITICAL',
        type: 'fatigue_failure',
        message: `⚠️ CRITICAL: Fatigue safety factor ${sn_curve_safety.toFixed(2)}× — expected life < target cycles`,
        affected_parts: fatigData.fatigue_hotspot_parts || [],
      });
      summary.fail_count++;
      
      suggestions.push({
        priority: 'CRITICAL',
        category: 'fatigue_life',
        recommendation: `Reduce stress amplitude or increase material strength for fatigue`,
        options: [
          `Shot peen high-stress areas (+30–50% fatigue strength)`,
          `Increase fillet radii at stress concentrations`,
          `Upgrade to higher-fatigue-strength material (e.g., bearing steel)`,
        ],
        effort: 'High (materials + manufacturing process)',
      });
    } else {
      summary.pass_count++;
    }
  }
  
  _analyzeManufacturability(suggestions, issues, summary) {
    const mfrData = this.sim.manufacturability_check || {};
    
    // Tolerance stack check
    if (mfrData.tolerance_stack_mm && mfrData.tolerance_stack_mm > 0.12) {
      issues.push({
        severity: 'WARNING',
        type: 'tolerance_stack',
        message: `⚠️ Tolerance stack ${mfrData.tolerance_stack_mm.toFixed(3)} mm — tight for quantity production`,
      });
      summary.warning_count++;
      
      suggestions.push({
        priority: 'MEDIUM',
        category: 'tolerance_optimization',
        recommendation: `Review tolerance strategy: relax non-critical dimensions or use tighter process controls`,
        cost_impact: 'Loose: ↓ cost. Tight: ↑ cost + rework',
      });
    } else {
      summary.pass_count++;
    }
  }
  
  _generateNarrative(suggestions, issues, summary) {
    let narrative = '';
    
    if (summary.status === 'FAIL') {
      narrative += `🔴 **ANALYSIS FAILED** — ${summary.fail_count} critical issues detected.\n\n`;
      narrative += 'Critical Issues:\n';
      issues
        .filter(i => i.severity === 'CRITICAL')
        .forEach(i => {
          narrative += `• ${i.message}\n`;
        });
      narrative += '\n⚠️ Do not proceed to manufacturing. Apply suggestions below.\n\n';
    } else {
      narrative += `✅ **ANALYSIS PASSED** — assembly meets all constraints.\n`;
      if (summary.warning_count > 0) {
        narrative += `⚠️ ${summary.warning_count} warning(s) — review for optimization opportunities.\n\n`;
      } else {
        narrative += `✨ All margins nominal. Ready for manufacturing.\n\n`;
      }
    }
    
    if (suggestions.length > 0) {
      narrative += `**Design Improvement Recommendations** (${suggestions.length} suggestions):\n\n`;
      suggestions.slice(0, 3).forEach((s, i) => {
        narrative += `**${i + 1}. ${s.category.replace(/_/g, ' ').toUpperCase()}** [${s.priority}]\n`;
        narrative += `   ${s.recommendation}\n`;
        if (s.impact) narrative += `   → Impact: ${s.impact}\n`;
        if (s.effort) narrative += `   → Effort: ${s.effort}\n\n`;
      });
      if (suggestions.length > 3) {
        narrative += `   ... and ${suggestions.length - 3} more suggestions.\n`;
      }
    }
    
    return narrative;
  }
}

/**
 * Format suggestions for LLM consumption (text-based)
 */
export function formatSuggestionsForEnki(feedbackResult) {
  const { suggestions, issues, summary } = feedbackResult;
  
  let text = '';
  
  if (summary.status === 'FAIL') {
    text += '## ⛔ SIMULATION FAILED\n';
    text += `- Failed checks: ${summary.fail_count}\n`;
    text += `- Warnings: ${summary.warning_count}\n\n`;
    text += 'Issues:\n';
    issues.forEach(i => {
      text += `- ${i.severity}: ${i.message}\n`;
    });
  } else {
    text += '## ✅ SIMULATION PASSED\n';
    if (summary.warning_count > 0) {
      text += `- Warnings: ${summary.warning_count} (review for optimization)\n`;
    }
  }
  
  if (suggestions.length > 0) {
    text += '\n## Design Improvements\n';
    suggestions.slice(0, 3).forEach(s => {
      text += `- **${s.category}** [${s.priority}]: ${s.recommendation}\n`;
      if (s.impact) text += `  Impact: ${s.impact}\n`;
    });
  }
  
  return text;
}

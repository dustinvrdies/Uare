/**
 * Enki V5 Backend Routes
 * New endpoints: /analyze-simulation, /apply-edit, /generate-with-enrichment
 */

import { Router } from 'express';
import { enrichAssemblyWithManufacturingData, validateAssemblyForManufacturability, applyEditToAssembly, analyzeCycleAndGenerateSuggestions, MATERIAL_DATABASE } from './integration.mjs';
import { getEnhancedSystemPrompt } from './enhancedPrompt.mjs';

export function buildEnkiV5Routes(runtime = {}) {
  const router = Router();
  
  /**
   * POST /enki/analyze-simulation
   * Analyze FEA/physics results and generate design suggestions
   */
  router.post('/analyze-simulation', async (req, res) => {
    try {
      const { assembly, simulation_results } = req.body;
      
      if (!assembly) {
        return res.status(400).json({ ok: false, error: 'assembly required' });
      }
      
      const feedback = analyzeCycleAndGenerateSuggestions(assembly, simulation_results || {});
      
      return res.json({
        ok: true,
        status: feedback.status,
        narrative: feedback.narrative,
        suggestions: feedback.suggestions,
        raw_feedback: feedback.raw_feedback,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  /**
   * POST /enki/apply-edit
   * Apply user edit to assembly, track affected parts
   */
  router.post('/apply-edit', async (req, res) => {
    try {
      const { assembly, edit_request } = req.body;
      
      if (!assembly || !edit_request) {
        return res.status(400).json({ ok: false, error: 'assembly and edit_request required' });
      }
      
      const result = applyEditToAssembly(assembly, edit_request);
      
      // Re-enrich the assembly
      const enriched = enrichAssemblyWithManufacturingData(result.assembly, MATERIAL_DATABASE);
      
      return res.json({
        ok: true,
        assembly: enriched,
        affected_parts: result.affected_parts,
        edit_id: result.edit_id,
        validation: validateAssemblyForManufacturability(enriched),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  /**
   * POST /enki/generate-with-enrichment
   * Full generation pipeline: LLM → Enrichment → Validation
   */
  router.post('/generate-with-enrichment', async (req, res) => {
    try {
      const { assembly_plan } = req.body;
      
      if (!assembly_plan) {
        return res.status(400).json({ ok: false, error: 'assembly_plan required' });
      }
      
      // Enrich with manufacturing data
      const enriched = enrichAssemblyWithManufacturingData(assembly_plan, MATERIAL_DATABASE);
      
      // Validate
      const validation = validateAssemblyForManufacturability(enriched);
      
      return res.json({
        ok: true,
        assembly: enriched,
        validation,
        system_prompt_hint: 'Enrichment and validation complete. Ready for rendering and simulation.',
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  /**
   * GET /enki/system-prompt
   * Return the enhanced system prompt
   */
  router.get('/system-prompt', (req, res) => {
    return res.json({
      ok: true,
      prompt: getEnhancedSystemPrompt(),
    });
  });
  
  /**
   * GET /enki/material-database
   * Return material properties for UI reference
   */
  router.get('/material-database', (req, res) => {
    return res.json({
      ok: true,
      materials: MATERIAL_DATABASE,
    });
  });
  
  return router;
}

export { getEnhancedSystemPrompt, MATERIAL_DATABASE };

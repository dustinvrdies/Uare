import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { derivePatentLearningEvent } from '../learning/eventFactory.mjs';
import { createPatentSearchService } from '../patents/patentSearchService.mjs';

export function buildPatentRoutes(runtime, learningStore, jobStore = null) {
  const router = Router();
  const patentSearchService = createPatentSearchService(runtime);

  router.post('/search', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const request = req.body?.request || {};
      const response = await patentSearchService.search(request, actor);
      const learningEvent = await learningStore.recordEvent(derivePatentLearningEvent(response, actor));
      await jobStore?.create('patent', {
        search_id: response.search_id,
        actor_id: actor.id,
        project_id: response.project_id,
        status: 'completed',
        learning_event_id: learningEvent.event_id,
        request_json: request,
        response_json: response,
        provider_meta_json: response.diagnostics,
      });
      return res.status(201).json({ ok: true, search: { ...response, learning_event_id: learningEvent.event_id }, learning_event: learningEvent });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });


  router.post('/analyze', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const request = req.body?.request || {};
      const response = await patentSearchService.search(request, actor);
      const learningEvent = await learningStore.recordEvent({
        domain: 'patent_claim',
        event_type: 'claim_space_analysis',
        actor_id: actor.id,
        project_id: response.project_id,
        created_at: new Date().toISOString(),
        input: request,
        output: response.claim_intelligence,
        success_score: Number(response.claim_intelligence?.opportunity_score || 0),
        signals: {
          claim_similarity_score: Number(response.claim_intelligence?.claim_similarity_score || 0),
          design_gap_score: Number(response.claim_intelligence?.design_gap_score || 0),
          opportunity_score: Number(response.claim_intelligence?.opportunity_score || 0),
        },
        metadata: {
          search_id: response.search_id,
          patent_ids: response.claim_intelligence?.top_patent_ids || [],
        },
      });
      return res.status(201).json({ ok: true, analysis: response.claim_intelligence, search: { search_id: response.search_id, summary: response.summary, results: response.results }, learning_event: learningEvent });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

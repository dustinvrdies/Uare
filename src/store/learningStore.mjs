import { buildLearningHints, normalizeLearningEvent, summarizeLearningEvents } from '../learning/normalize.mjs';

export function createLearningStore() {
  const events = [];

  return {
    async recordEvent(event = {}) {
      const normalized = normalizeLearningEvent(event);
      events.unshift(normalized);
      return normalized;
    },
    async listEvents({ domain = null, projectId = null, limit = 50 } = {}) {
      return events
        .filter((event) => (!domain || event.domain === domain) && (!projectId || event.project_id === projectId))
        .slice(0, limit);
    },
    async getInsights({ domain = null, projectId = null, limit = 50 } = {}) {
      const scoped = await this.listEvents({ domain, projectId, limit });
      return {
        summary: summarizeLearningEvents(scoped),
        hints: buildLearningHints(scoped),
        events: scoped,
      };
    },
  };
}

import { withPgClient } from '../db/pg.mjs';
import { buildLearningHints, normalizeLearningEvent, summarizeLearningEvents } from '../learning/normalize.mjs';

export function createPostgresLearningStore(runtime = {}) {
  return {
    async recordEvent(event = {}) {
      const normalized = normalizeLearningEvent(event);
      await withPgClient(runtime.databaseUrl, async (client) => {
        await client.query(
          `insert into learning_events (
             event_id, domain, project_id, actor_id, outcome_type,
             success_score, confidence_score, tags, signals_json, input_json, output_json, metadata_json, created_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::timestamptz)
           on conflict (event_id) do update set
             domain = excluded.domain,
             project_id = excluded.project_id,
             actor_id = excluded.actor_id,
             outcome_type = excluded.outcome_type,
             success_score = excluded.success_score,
             confidence_score = excluded.confidence_score,
             tags = excluded.tags,
             signals_json = excluded.signals_json,
             input_json = excluded.input_json,
             output_json = excluded.output_json,
             metadata_json = excluded.metadata_json,
             created_at = excluded.created_at`,
          [
            normalized.event_id,
            normalized.domain,
            normalized.project_id,
            normalized.actor_id,
            normalized.outcome_type,
            normalized.success_score,
            normalized.confidence_score,
            JSON.stringify(normalized.tags || []),
            JSON.stringify(normalized.signals || {}),
            JSON.stringify(normalized.input || {}),
            JSON.stringify(normalized.output || {}),
            JSON.stringify(normalized.metadata || {}),
            normalized.created_at,
          ]
        );
      });
      return normalized;
    },
    async listEvents({ domain = null, projectId = null, limit = 50 } = {}) {
      const rows = await withPgClient(runtime.databaseUrl, async (client) => {
        const clauses = [];
        const values = [];
        if (domain) {
          values.push(domain);
          clauses.push(`domain = $${values.length}`);
        }
        if (projectId) {
          values.push(projectId);
          clauses.push(`project_id = $${values.length}`);
        }
        values.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
        const whereClause = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const result = await client.query(
          `select event_id, domain, project_id, actor_id, outcome_type, success_score, confidence_score,
                  tags, signals_json, input_json, output_json, metadata_json, created_at
             from learning_events
             ${whereClause}
            order by created_at desc
            limit $${values.length}`,
          values
        );
        return result.rows;
      });

      return rows.map((row) => ({
        event_id: row.event_id,
        domain: row.domain,
        project_id: row.project_id,
        actor_id: row.actor_id,
        outcome_type: row.outcome_type,
        success_score: Number(row.success_score || 0),
        confidence_score: Number(row.confidence_score || 0),
        tags: Array.isArray(row.tags) ? row.tags : [],
        signals: row.signals_json || {},
        input: row.input_json || {},
        output: row.output_json || {},
        metadata: row.metadata_json || {},
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      }));
    },
    async getInsights({ domain = null, projectId = null, limit = 50 } = {}) {
      const events = await this.listEvents({ domain, projectId, limit });
      return {
        summary: summarizeLearningEvents(events),
        hints: buildLearningHints(events),
        events,
      };
    },
  };
}

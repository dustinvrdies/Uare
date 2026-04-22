export function normalizeLearningEvent(event = {}) {
  const domain = String(event.domain || '').trim().toLowerCase();
  if (!domain) throw new Error('Learning event domain is required');

  const successScore = clamp(Number(event.success_score), 0, 100);
  const confidenceScore = clamp(Number(event.confidence_score ?? successScore), 0, 100);

  return {
    event_id: String(event.event_id || `learn-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
    domain,
    project_id: event.project_id ? String(event.project_id) : null,
    actor_id: event.actor_id ? String(event.actor_id) : null,
    outcome_type: String(event.outcome_type || 'observation'),
    success_score: successScore,
    confidence_score: confidenceScore,
    tags: [...new Set((Array.isArray(event.tags) ? event.tags : []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))],
    signals: isObject(event.signals) ? event.signals : {},
    input: isObject(event.input) ? event.input : {},
    output: isObject(event.output) ? event.output : {},
    metadata: isObject(event.metadata) ? event.metadata : {},
    created_at: event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString(),
  };
}

export function summarizeLearningEvents(events = []) {
  const totalEvents = events.length;
  if (!totalEvents) {
    return {
      totalEvents: 0,
      averageSuccessScore: 0,
      averageConfidenceScore: 0,
      latestEventAt: null,
    };
  }

  return {
    totalEvents,
    averageSuccessScore: Number((events.reduce((sum, event) => sum + Number(event.success_score || 0), 0) / totalEvents).toFixed(2)),
    averageConfidenceScore: Number((events.reduce((sum, event) => sum + Number(event.confidence_score || 0), 0) / totalEvents).toFixed(2)),
    latestEventAt: events.map((event) => event.created_at).sort().at(-1) || null,
  };
}

export function buildLearningHints(events = []) {
  const positive = events.filter((event) => Number(event.success_score) >= 70);
  const negative = events.filter((event) => Number(event.success_score) < 40);
  const biasSource = positive.length ? positive : events;
  return {
    recommended_tags: countTags(positive.length ? positive : events.filter((event) => Number(event.success_score) >= 50)),
    avoid_tags: countTags(negative),
    signal_bias: buildSignalBias(biasSource),
    evidence_count: events.length,
  };
}

function countTags(events = []) {
  const counts = new Map();
  for (const event of events) {
    for (const tag of event.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));
}

function buildSignalBias(events = []) {
  const buckets = new Map();
  for (const event of events) {
    for (const [key, value] of Object.entries(event.signals || {})) {
      if (!Number.isFinite(Number(value))) continue;
      const current = buckets.get(key) || { total: 0, count: 0 };
      current.total += Number(value);
      current.count += 1;
      buckets.set(key, current);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()]
      .filter(([, bucket]) => bucket.count > 0)
      .map(([key, bucket]) => [key, Number((bucket.total / bucket.count).toFixed(4))])
  );
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

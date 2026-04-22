function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeKind(kind) {
  return String(kind || '').toLowerCase();
}

export function createJobStore() {
  const buckets = {
    solver: new Map(),
    cad: new Map(),
    patent: new Map(),
    physics: new Map(),
  };

  function bucket(kind) {
    const normalized = normalizeKind(kind);
    if (!buckets[normalized]) throw new Error(`Unsupported job kind: ${kind}`);
    return buckets[normalized];
  }

  async function create(kind, input = {}) {
    const normalized = normalizeKind(kind);
    const idKey = normalized === 'patent' ? 'search_id' : normalized === 'cad' ? 'execution_id' : 'job_id';
    const jobId = String(input[idKey] || `${normalized}-${Date.now()}`);
    const record = {
      ...clone(input),
      [idKey]: jobId,
      status: input.status || 'queued',
      created_at: input.created_at || nowIso(),
      updated_at: nowIso(),
    };
    bucket(normalized).set(jobId, record);
    return clone(record);
  }

  async function get(kind, id) {
    const record = bucket(kind).get(String(id));
    return record ? clone(record) : null;
  }

  async function update(kind, id, patch = {}) {
    const current = bucket(kind).get(String(id));
    if (!current) return null;
    const next = {
      ...current,
      ...clone(patch),
      updated_at: nowIso(),
    };
    bucket(kind).set(String(id), next);
    return clone(next);
  }

  async function list(kind, limit = 100, filters = {}) {
    const rows = [...bucket(kind).values()]
      .filter((row) => {
        if (filters.status && row.status !== filters.status) return false;
        if (filters.project_id && row.project_id !== filters.project_id) return false;
        return true;
      })
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, limit);
    return clone(rows);
  }

  return {
    mode: 'memory',
    create,
    get,
    update,
    list,
  };
}

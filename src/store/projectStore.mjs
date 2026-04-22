
import crypto from 'crypto';
import { createJsonFileStore } from '../utils/jsonFileStore.mjs';

function nowIso() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function projectId() { return `proj-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }

export function createProjectStore(runtime = {}) {
  const defaultFile = runtime.projectStoreFile || process.env.PROJECT_STORE_FILE || `./data/projects-${process.pid}.json`;
  const fileStore = createJsonFileStore(defaultFile, { projects: [], audit: [] });

  async function listByOwner(ownerId) {
    const db = fileStore.read();
    return db.projects.filter((project) => project.owner_id === ownerId).sort((a,b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  }

  async function listByOrg(orgId) {
    const db = fileStore.read();
    return db.projects.filter((project) => String(project.org_id || '') === String(orgId || '')).sort((a,b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  }

  async function listVisible(ownerId, orgIds = []) {
    const allowed = new Set((orgIds || []).map((id) => String(id)));
    const db = fileStore.read();
    return db.projects
      .filter((project) => project.owner_id === ownerId || (project.org_id && allowed.has(String(project.org_id))))
      .sort((a,b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  }

  async function save(project) {
    let merged;
    fileStore.mutate((draft) => {
      const existing = draft.projects.find((entry) => entry.id === project.id) || {};
      merged = {
        ...existing,
        ...clone(project),
        id: String(project.id || existing.id || projectId()),
        updated_at: nowIso(),
        created_at: existing.created_at || nowIso(),
      };
      draft.projects = draft.projects.filter((entry) => entry.id !== merged.id);
      draft.projects.unshift(merged);
      return draft;
    });
    return clone(merged);
  }

  async function get(id) {
    return fileStore.read().projects.find((entry) => entry.id === String(id)) || null;
  }

  async function remove(id, ownerId) {
    const current = await get(id);
    if (!current || current.owner_id !== ownerId) return null;
    fileStore.mutate((draft) => {
      draft.projects = draft.projects.filter((entry) => entry.id !== String(id));
      return draft;
    });
    return current;
  }

  async function appendAudit(entry) {
    const record = { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, created_at: nowIso(), ...clone(entry) };
    fileStore.mutate((draft) => { draft.audit.unshift(record); return draft; });
    return record;
  }

  async function listAuditByProject(projectId) {
    return fileStore.read().audit.filter((item) => item.project_id === projectId).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  return { mode: 'file', listByOwner, listByOrg, listVisible, save, get, remove, appendAudit, listAuditByProject };
}

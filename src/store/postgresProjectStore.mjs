
import { getPgPool } from '../db/pg.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function createPostgresProjectStore(runtime = {}) {
  const pool = getPgPool(runtime.databaseUrl);

  async function listByOwner(ownerId) {
    const result = await pool.query('select * from projects where owner_id = $1 order by updated_at desc', [ownerId]);
    return result.rows || [];
  }

  async function listByOrg(orgId) {
    try {
      const result = await pool.query('select * from projects where org_id = $1 order by updated_at desc', [orgId]);
      return result.rows || [];
    } catch {
      return [];
    }
  }

  async function listVisible(ownerId, orgIds = []) {
    const safeOrgIds = (orgIds || []).filter(Boolean);
    if (safeOrgIds.length === 0) {
      return listByOwner(ownerId);
    }
    const placeholders = safeOrgIds.map((_, i) => `$${i + 2}`).join(', ');
    const result = await pool.query(
      `select * from projects where owner_id = $1 or org_id = any(array[${placeholders}]::text[]) order by updated_at desc`,
      [ownerId, ...safeOrgIds]
    );
    return result.rows || [];
  }

  async function save(project) {
    const payload = {
      id: project.id,
      owner_id: project.owner_id,
      org_id: project.org_id || null,
      name: project.name || project.title || null,
      title: project.title || project.name || null,
      description: project.description || null,
      problem_statement: project.problem_statement || null,
      solution: project.solution || null,
      domain: project.domain || null,
      target_user: project.target_user || null,
      workflow_status: project.workflow_status || project.status || 'draft',
      premium_readiness_band: project.premium_readiness_band || 'core_ready',
      export_readiness_score: Number(project.export_readiness_score || 0),
      selected_variant_id: project.selected_variant_id || null,
      intelligence_route: project.intelligence_route || null,
      intelligence_memory: project.intelligence_memory || null,
      latest_export_revision: project.latest_export_revision || null,
      share_mode: project.share_mode || 'private',
      slug: project.slug || null,
      status: project.status || 'active',
      updated_at: nowIso()
    };

    try {
      const result = await pool.query(
        `insert into projects (
          id, owner_id, org_id, name, title, slug, description, problem_statement, solution, domain, target_user,
          workflow_status, premium_readiness_band, export_readiness_score, selected_variant_id,
          intelligence_route, intelligence_memory, latest_export_revision, share_mode, status, updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,
          $16,$17,$18,$19,$20,$21
        )
        on conflict (id) do update set
          owner_id = excluded.owner_id,
          org_id = excluded.org_id,
          name = excluded.name,
          title = excluded.title,
          slug = excluded.slug,
          description = excluded.description,
          problem_statement = excluded.problem_statement,
          solution = excluded.solution,
          domain = excluded.domain,
          target_user = excluded.target_user,
          workflow_status = excluded.workflow_status,
          premium_readiness_band = excluded.premium_readiness_band,
          export_readiness_score = excluded.export_readiness_score,
          selected_variant_id = excluded.selected_variant_id,
          intelligence_route = excluded.intelligence_route,
          intelligence_memory = excluded.intelligence_memory,
          latest_export_revision = excluded.latest_export_revision,
          share_mode = excluded.share_mode,
          status = excluded.status,
          updated_at = excluded.updated_at
        returning *`,
        [
          payload.id, payload.owner_id, payload.org_id, payload.name, payload.title, payload.slug, payload.description, payload.problem_statement, payload.solution, payload.domain, payload.target_user,
          payload.workflow_status, payload.premium_readiness_band, payload.export_readiness_score, payload.selected_variant_id,
          payload.intelligence_route, payload.intelligence_memory, payload.latest_export_revision, payload.share_mode, payload.status, payload.updated_at
        ]
      );
      return result.rows?.[0] || null;
    } catch {
      // Fallback for older schemas without org/name/slug/status columns.
      const result = await pool.query(
        `insert into projects (
          id, owner_id, title, description, problem_statement, solution, domain, target_user,
          workflow_status, premium_readiness_band, export_readiness_score, selected_variant_id,
          intelligence_route, intelligence_memory, latest_export_revision, share_mode, updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,
          $9,$10,$11,$12,
          $13,$14,$15,$16,$17
        )
        on conflict (id) do update set
          owner_id = excluded.owner_id,
          title = excluded.title,
          description = excluded.description,
          problem_statement = excluded.problem_statement,
          solution = excluded.solution,
          domain = excluded.domain,
          target_user = excluded.target_user,
          workflow_status = excluded.workflow_status,
          premium_readiness_band = excluded.premium_readiness_band,
          export_readiness_score = excluded.export_readiness_score,
          selected_variant_id = excluded.selected_variant_id,
          intelligence_route = excluded.intelligence_route,
          intelligence_memory = excluded.intelligence_memory,
          latest_export_revision = excluded.latest_export_revision,
          share_mode = excluded.share_mode,
          updated_at = excluded.updated_at
        returning *`,
        [
          payload.id, payload.owner_id, payload.title, payload.description, payload.problem_statement, payload.solution, payload.domain, payload.target_user,
          payload.workflow_status, payload.premium_readiness_band, payload.export_readiness_score, payload.selected_variant_id,
          payload.intelligence_route, payload.intelligence_memory, payload.latest_export_revision, payload.share_mode, payload.updated_at
        ]
      );
      return result.rows?.[0] || null;
    }
  }

  async function get(id) {
    const result = await pool.query('select * from projects where id = $1 limit 1', [id]);
    return result.rows?.[0] || null;
  }

  async function remove(id, ownerId) {
    const result = await pool.query('delete from projects where id = $1 and owner_id = $2 returning *', [id, ownerId]);
    return result.rows?.[0] || null;
  }

  async function appendAudit(entry) {
    const result = await pool.query(
      'insert into project_audit (project_id, actor_id, action, payload, created_at) values ($1,$2,$3,$4,$5) returning *',
      [entry.project_id || null, entry.actor_id || entry.owner_id || null, entry.action || 'unknown', entry.payload || {}, nowIso()]
    );
    return result.rows?.[0] || null;
  }

  async function listAuditByProject(projectId) {
    const result = await pool.query('select * from project_audit where project_id = $1 order by created_at desc', [projectId]);
    return result.rows || [];
  }

  return { listByOwner, listByOrg, listVisible, save, get, remove, appendAudit, listAuditByProject };
}

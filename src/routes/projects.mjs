
import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { requireOrgRole } from '../product/permissions.mjs';

function slugify(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
}

async function getActorOrgIds(productStore, actor) {
  if (!productStore?.listOrgsForUser) return [];
  const orgs = await productStore.listOrgsForUser(actor.id);
  return (orgs || []).map((org) => String(org.org_id || org.id));
}

function canReadProject(project, actor, orgIds) {
  if (!project) return false;
  if (project.owner_id === actor.id) return true;
  return Boolean(project.org_id && (orgIds || []).includes(String(project.org_id)));
}

function canDeleteProject(project, actor, orgMembership) {
  if (!project) return false;
  if (project.owner_id === actor.id) return true;
  if (!project.org_id) return false;
  return Boolean(orgMembership && ['owner', 'admin'].includes(orgMembership.role));
}

export function buildProjectRoutes(store, runtime, productStore = null) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const actorOrgIds = await getActorOrgIds(productStore, actor);
      const requestedOrgId = req.query?.org_id ? String(req.query.org_id) : null;
      if (requestedOrgId) {
        await requireOrgRole(productStore, requestedOrgId, actor.id, ['owner', 'admin', 'member', 'billing_manager', 'viewer']);
      }
      let projects = [];
      if (requestedOrgId && store.listByOrg) {
        projects = await store.listByOrg(requestedOrgId);
      } else if (store.listVisible) {
        projects = await store.listVisible(actor.id, actorOrgIds);
      } else {
        projects = await store.listByOwner(actor.id);
      }
      projects = (projects || []).filter((project) => !requestedOrgId || String(project.org_id || '') === requestedOrgId);
      return res.json({ ok: true, projects, scope: { org_id: requestedOrgId || null, visible_org_ids: actorOrgIds } });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const name = String(req.body?.name || req.body?.project?.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'Project name is required' });
      const orgId = req.body?.org_id || req.body?.project?.org_id || null;
      if (orgId) {
        await requireOrgRole(productStore, orgId, actor.id, ['owner', 'admin', 'member']);
      }
      const project = await store.save({
        ...(req.body?.project || {}),
        id: req.body?.id || req.body?.project?.id || undefined,
        name,
        slug: req.body?.slug || req.body?.project?.slug || slugify(name),
        description: req.body?.description || req.body?.project?.description || null,
        owner_id: actor.id,
        org_id: orgId ? String(orgId) : null,
        status: req.body?.status || req.body?.project?.status || 'active',
      });
      await store.appendAudit({ project_id: project.id, owner_id: actor.id, actor_id: actor.id, action: 'project.created', payload: { name: project.name, org_id: project.org_id || null } });
      return res.status(201).json({ ok: true, project });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/:projectId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const project = await store.get(req.params.projectId);
      const actorOrgIds = await getActorOrgIds(productStore, actor);
      if (!canReadProject(project, actor, actorOrgIds)) return res.status(404).json({ ok: false, error: 'Project not found' });
      const audit = await store.listAuditByProject(project.id);
      return res.json({ ok: true, project, audit });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.delete('/:projectId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const project = await store.get(req.params.projectId);
      if (!project) return res.status(404).json({ ok: false, error: 'Project not found' });
      let orgMembership = null;
      if (project.org_id) {
        try {
          orgMembership = await requireOrgRole(productStore, project.org_id, actor.id, ['owner', 'admin']);
        } catch {}
      }
      if (!canDeleteProject(project, actor, orgMembership)) {
        return res.status(404).json({ ok: false, error: 'Project not found' });
      }
      let removed = null;
      if (project.owner_id === actor.id) removed = await store.remove(req.params.projectId, actor.id);
      if (!removed && project) removed = project;
      await store.appendAudit({ project_id: removed.id, owner_id: actor.id, actor_id: actor.id, action: 'project.deleted', payload: { org_id: removed.org_id || null } });
      return res.json({ ok: true, project: removed });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { requireOrgRole } from '../product/permissions.mjs';
import { validateBody } from '../middleware/requestValidation.mjs';
import { withIdempotency } from '../middleware/idempotency.mjs';
import { recordAuditEvent } from '../utils/auditStore.mjs';

export function buildOrgRoutes(runtime, productStore) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const orgs = await productStore.listOrgsForUser(actor.id);
      return res.json({ ok: true, orgs });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/', validateBody({
    org: { type: 'object', required: true },
  }), withIdempotency('org-create', runtime), async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const orgInput = req.validatedBody.org || {};
      const org = await productStore.createOrg({ ...orgInput, owner_user_id: actor.id }, actor);
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'org.created', target_type: 'org', target_id: org.org_id, metadata_json: { slug: org.slug, name: org.name } });
      return res.status(201).json({ ok: true, org });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/:orgId/members', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      await requireOrgRole(productStore, req.params.orgId, actor.id, ['owner', 'admin', 'member', 'billing_manager', 'viewer']);
      const members = await productStore.listOrgMembers(req.params.orgId);
      return res.json({ ok: true, members });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/:orgId/members', validateBody({
    email: { type: 'string', required: false, maxLength: 320 },
    user_id: { type: 'string', required: false, maxLength: 200 },
    role: { type: 'string', required: false, default: 'member', enum: ['owner', 'admin', 'member', 'billing_manager', 'viewer'] },
  }), withIdempotency('org-member-upsert', runtime), async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      await requireOrgRole(productStore, req.params.orgId, actor.id, ['owner', 'admin']);
      const email = String(req.validatedBody.email || '').trim();
      const targetUserId = req.validatedBody.user_id || (email ? (await productStore.findUserByEmail(email))?.user_id : null);
      if (!targetUserId) {
        const error = new Error('Target user not found');
        error.statusCode = 404;
        throw error;
      }
      const membership = await productStore.addOrgMember(req.params.orgId, targetUserId, req.validatedBody.role || 'member', actor);
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'org.member.upserted', target_type: 'org_membership', target_id: membership.membership_id || `${req.params.orgId}:${targetUserId}`, metadata_json: { org_id: req.params.orgId, user_id: targetUserId, role: membership.role } });
      return res.status(201).json({ ok: true, membership });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.delete('/:orgId/members/:userId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      await requireOrgRole(productStore, req.params.orgId, actor.id, ['owner', 'admin']);
      await productStore.removeOrgMember(req.params.orgId, req.params.userId);
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'org.member.removed', target_type: 'org_membership', target_id: `${req.params.orgId}:${req.params.userId}`, metadata_json: { org_id: req.params.orgId, user_id: req.params.userId } });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  // ── Role-aware audit review for tenant org owners/admins ─────────────────
  router.get('/:orgId/audit', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      // Only owners and admins can see org-scoped audit history
      await requireOrgRole(productStore, req.params.orgId, actor.id, ['owner', 'admin']);

      const auditStore = req.app?.locals?.auditStore;
      const limit = Math.min(Number(req.query?.limit || 50), 200);
      const filter = {
        action: req.query?.action || undefined,
        actor_id: req.query?.actor_id || undefined,
        target_type: req.query?.target_type || undefined,
        target_id: req.query?.target_id || undefined,
      };

      let events = await auditStore?.listRecent?.(limit * 4, filter) || [];

      // Restrict to actions that belong to this org (stored in metadata_json.org_id)
      const orgId = req.params.orgId;
      events = events.filter((ev) => {
        const meta = ev.metadata_json || {};
        // Include events where org_id matches, or actor_id matches an org member
        return meta.org_id === orgId || (ev.actor_id && ev.actor_id === actor.id);
      });

      // Scope to org-relevant action prefixes (auth, org, billing) — exclude internal ops
      events = events.filter((ev) =>
        !ev.action || /^(auth\.|org\.|billing\.)/.test(ev.action)
      );

      events = events.slice(0, limit);
      return res.json({ ok: true, org_id: orgId, events });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

import crypto from 'crypto';
import { withPgClient } from '../db/pg.mjs';
import { PRODUCT_PLANS, getPlan } from './catalog.mjs';
import { createJsonFileStore } from '../utils/jsonFileStore.mjs';

function nowIso() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function randomId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${digest}`;
}
function verifyPassword(password, passwordDigest = '') {
  const [salt, expected] = String(passwordDigest).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function normalizedOrgRole(role = 'member') {
  return ['owner', 'admin', 'member', 'billing_manager', 'viewer'].includes(role) ? role : 'member';
}

export function createProductStore(runtime = {}) {
  const fileStore = createJsonFileStore(runtime.productStoreFile || './data/product-store.json', {
    users: [], subscriptions: [], usage: [], checkoutSessions: [], authSessions: [], orgs: [], memberships: [], webhookEvents: []
  });

  function snapshot() { return fileStore.read(); }
  function commit(mutator) { return fileStore.mutate(mutator); }

  async function ensureDefaultOrgForUser(user) {
    const db = snapshot();
    const existing = db.memberships.find((row) => row.user_id === user.user_id && row.role === 'owner');
    if (existing) return db.orgs.find((row) => row.org_id === existing.org_id) || null;
    const org = {
      org_id: randomId('org'),
      slug: `${(user.email || user.user_id).split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${Math.random().toString(16).slice(2, 6)}`,
      name: user.full_name ? `${user.full_name}'s Workspace` : `${user.user_id} Workspace`,
      owner_user_id: user.user_id,
      created_at: nowIso(), updated_at: nowIso(),
    };
    commit((draft) => {
      draft.orgs.unshift(org);
      draft.memberships.unshift({ membership_id: randomId('mem'), org_id: org.org_id, user_id: user.user_id, role: 'owner', invited_by: user.user_id, created_at: nowIso(), updated_at: nowIso() });
      return draft;
    });
    return clone(org);
  }

  return {
    mode: 'file',
    async upsertUser(user = {}) {
      const db = snapshot();
      const existing = db.users.find((entry) => entry.user_id === String(user.user_id || user.id || '')) || db.users.find((entry) => String(entry.email || '').toLowerCase() === String(user.email || '').toLowerCase()) || {};
      const next = {
        user_id: String(user.user_id || user.id || existing.user_id || randomId('user')),
        email: String(user.email || existing.email || ''),
        full_name: user.full_name || existing.full_name || null,
        role: user.role || existing.role || 'owner',
        plan_id: user.plan_id || existing.plan_id || 'free',
        password_digest: user.password ? hashPassword(user.password) : (user.password_digest || existing.password_digest || null),
        created_at: existing.created_at || nowIso(),
        updated_at: nowIso(),
      };
      commit((draft) => {
        draft.users = draft.users.filter((entry) => entry.user_id !== next.user_id);
        draft.users.unshift(next);
        if (!draft.subscriptions.find((entry) => entry.user_id === next.user_id)) {
          draft.subscriptions.unshift({
            subscription_id: `sub-${next.user_id}`, user_id: next.user_id, plan_id: next.plan_id, status: 'active', billing_provider: 'mock',
            current_period_start: nowIso(), current_period_end: null, created_at: nowIso(), updated_at: nowIso(), metadata_json: {}
          });
        }
        return draft;
      });
      await ensureDefaultOrgForUser(next);
      return clone({ ...next, password_digest: undefined });
    },
    async authenticateUser(email, password) {
      const user = snapshot().users.find((row) => String(row.email || '').toLowerCase() === String(email || '').toLowerCase());
      if (!user || !user.password_digest || !verifyPassword(password, user.password_digest)) return null;
      return clone({ ...user, password_digest: undefined });
    },
    async getUser(userId) {
      const row = snapshot().users.find((entry) => entry.user_id === String(userId));
      return row ? clone({ ...row, password_digest: undefined }) : null;
    },
    async findUserByEmail(email) {
      const row = snapshot().users.find((entry) => String(entry.email || '').toLowerCase() === String(email || '').toLowerCase());
      return row ? clone({ ...row, password_digest: undefined }) : null;
    },
    async listUsers(limit = 100) {
      return snapshot().users.slice(0, limit).map((row) => clone({ ...row, password_digest: undefined }));
    },
    async createSession(userId, metadata = {}) {
      const session = { session_id: randomId('sess'), user_id: String(userId), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(), created_at: nowIso(), updated_at: nowIso(), metadata_json: metadata };
      commit((draft) => { draft.authSessions.unshift(session); return draft; });
      return clone(session);
    },
    async getSession(sessionId) {
      const session = snapshot().authSessions.find((entry) => entry.session_id === String(sessionId));
      if (!session) return null;
      if (new Date(session.expires_at).getTime() <= Date.now()) { await this.deleteSession(sessionId); return null; }
      return clone(session);
    },
    async touchSession(sessionId, maxAgeSec = 60 * 60 * 24 * 14) {
      let next = null;
      commit((draft) => {
        draft.authSessions = draft.authSessions.map((entry) => entry.session_id === String(sessionId)
          ? (next = { ...entry, expires_at: new Date(Date.now() + (Number(maxAgeSec || 0) * 1000)).toISOString(), updated_at: nowIso() })
          : entry);
        return draft;
      });
      return next ? clone(next) : null;
    },
    async deleteSession(sessionId) { commit((draft) => { draft.authSessions = draft.authSessions.filter((entry) => entry.session_id !== String(sessionId)); return draft; }); return { ok: true }; },
    async getSubscription(userId) { const row = snapshot().subscriptions.find((entry) => entry.user_id === String(userId)); return row ? clone(row) : null; },
    async setSubscription(userId, patch = {}) {
      const current = snapshot().subscriptions.find((entry) => entry.user_id === String(userId)) || { subscription_id: `sub-${userId}`, user_id: String(userId), billing_provider: 'mock', status: 'active', created_at: nowIso() };
      const next = { ...current, ...clone(patch), user_id: String(userId), updated_at: nowIso() };
      commit((draft) => {
        draft.subscriptions = draft.subscriptions.filter((entry) => entry.user_id !== String(userId));
        draft.subscriptions.unshift(next);
        draft.users = draft.users.map((entry) => entry.user_id === String(userId) ? { ...entry, plan_id: next.plan_id || entry.plan_id, updated_at: nowIso() } : entry);
        return draft;
      });
      return clone(next);
    },
    async recordUsage(entry = {}) {
      const normalized = { usage_id: String(entry.usage_id || randomId('usage')), user_id: String(entry.user_id), meter_key: String(entry.meter_key || 'compute_credit'), quantity: Number(entry.quantity || 0), source: entry.source || 'system', metadata_json: entry.metadata_json || entry.metadata || {}, created_at: entry.created_at || nowIso() };
      commit((draft) => { draft.usage.unshift(normalized); return draft; });
      return clone(normalized);
    },
    async getUsageSummary(userId) {
      const scoped = snapshot().usage.filter((row) => row.user_id === String(userId));
      const totalQuantity = scoped.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      return { user_id: String(userId), total_quantity: totalQuantity, recent: scoped.slice(0, 20).map(clone) };
    },
    async createCheckoutSession(userId, planId, actor = {}, providerPayload = {}) {
      const plan = getPlan(planId);
      const session = { checkout_session_id: randomId('chk'), user_id: String(userId), plan_id: plan.plan_id, status: providerPayload.status || 'pending', provider: providerPayload.provider || 'mock', checkout_url: providerPayload.checkout_url || `/billing/mock-checkout/${plan.plan_id}?user_id=${encodeURIComponent(userId)}`, provider_session_id: providerPayload.provider_session_id || null, metadata_json: { created_by: actor?.id || null, ...(providerPayload.metadata_json || {}) }, created_at: nowIso() };
      commit((draft) => { draft.checkoutSessions.unshift(session); return draft; });
      return clone(session);
    },
    async markCheckoutSession(checkoutSessionId, patch = {}) {
      let next = null;
      commit((draft) => { draft.checkoutSessions = draft.checkoutSessions.map((entry) => entry.checkout_session_id === String(checkoutSessionId) ? (next = { ...entry, ...clone(patch) }) : entry); return draft; });
      return next ? clone(next) : null;
    },
async recordWebhookEvent(eventId, payload = {}) {
  const id = String(eventId || '');
  if (!id) return { inserted: false, duplicate: false };
  const existing = snapshot().webhookEvents.find((entry) => entry.event_id === id);
  if (existing) return { inserted: false, duplicate: true, event: clone(existing) };
  const event = { event_id: id, provider: payload.provider || 'stripe', event_type: payload.event_type || payload.type || null, payload_json: clone(payload), processed_at: nowIso(), created_at: nowIso() };
  commit((draft) => { draft.webhookEvents.unshift(event); return draft; });
  return { inserted: true, duplicate: false, event: clone(event) };
},
async getWebhookEvent(eventId) {
  const row = snapshot().webhookEvents.find((entry) => entry.event_id === String(eventId));
  return row ? clone(row) : null;
},
async listPlans() { return clone(PRODUCT_PLANS); },

    async createOrg(org = {}, actor = {}) {
      const next = { org_id: org.org_id || randomId('org'), slug: String(org.slug || `${String(org.name || 'workspace').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${Math.random().toString(16).slice(2,6)}`), name: String(org.name || 'Workspace'), owner_user_id: String(org.owner_user_id || actor.id), billing_email: org.billing_email || null, created_at: nowIso(), updated_at: nowIso() };
      commit((draft) => {
        draft.orgs.unshift(next);
        if (!draft.memberships.find((row) => row.org_id === next.org_id && row.user_id === next.owner_user_id)) draft.memberships.unshift({ membership_id: randomId('mem'), org_id: next.org_id, user_id: next.owner_user_id, role: 'owner', invited_by: actor.id || next.owner_user_id, created_at: nowIso(), updated_at: nowIso() });
        return draft;
      });
      return clone(next);
    },
    async getOrg(orgId) { const row = snapshot().orgs.find((entry) => entry.org_id === String(orgId)); return row ? clone(row) : null; },
    async listOrgsForUser(userId) {
      const db = snapshot();
      const orgIds = db.memberships.filter((row) => row.user_id === String(userId)).map((row) => row.org_id);
      return db.orgs.filter((entry) => orgIds.includes(entry.org_id)).map(clone);
    },
    async getMembership(orgId, userId) { const row = snapshot().memberships.find((entry) => entry.org_id === String(orgId) && entry.user_id === String(userId)); return row ? clone(row) : null; },
    async listOrgMembers(orgId) { const db = snapshot(); return db.memberships.filter((row) => row.org_id === String(orgId)).map((row) => ({ ...clone(row), user: db.users.find((u) => u.user_id === row.user_id) ? clone({ ...db.users.find((u) => u.user_id === row.user_id), password_digest: undefined }) : null })); },
    async addOrgMember(orgId, userId, role = 'member', actor = {}) {
      let membership = null;
      commit((draft) => {
        const existing = draft.memberships.find((entry) => entry.org_id === String(orgId) && entry.user_id === String(userId));
        membership = existing ? { ...existing, role: normalizedOrgRole(role), invited_by: actor.id || existing.invited_by, updated_at: nowIso() } : { membership_id: randomId('mem'), org_id: String(orgId), user_id: String(userId), role: normalizedOrgRole(role), invited_by: actor.id || null, created_at: nowIso(), updated_at: nowIso() };
        draft.memberships = draft.memberships.filter((entry) => !(entry.org_id === String(orgId) && entry.user_id === String(userId)));
        draft.memberships.unshift(membership);
        return draft;
      });
      return clone(membership);
    },
    async removeOrgMember(orgId, userId) { commit((draft) => { draft.memberships = draft.memberships.filter((entry) => !(entry.org_id === String(orgId) && entry.user_id === String(userId))); return draft; }); return { ok: true }; },
  };
}

function createPostgresProductStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;
  return {
    mode: 'postgres',
    async upsertUser(user = {}) {
      const userId = String(user.user_id || user.id || randomId('user'));
      const passwordDigest = user.password ? hashPassword(user.password) : user.password_digest || null;
      await withPgClient(connectionString, async (client) => {
        await client.query(`
          insert into app_users (user_id, email, full_name, role, plan_id, password_digest, created_at, updated_at)
          values ($1,$2,$3,$4,$5,$6,now(),now())
          on conflict (user_id) do update set
            email=excluded.email,
            full_name=excluded.full_name,
            role=excluded.role,
            plan_id=excluded.plan_id,
            password_digest=coalesce(excluded.password_digest, app_users.password_digest),
            updated_at=now()
        `, [userId, user.email || null, user.full_name || null, user.role || 'owner', user.plan_id || 'free', passwordDigest]);
        await client.query(`insert into subscriptions (subscription_id, user_id, plan_id, status, billing_provider, current_period_start, created_at, updated_at)
          values ($1,$2,$3,'active','mock',now(),now(),now()) on conflict (subscription_id) do nothing`, [`sub-${userId}`, userId, user.plan_id || 'free']);
        const orgId = `org-${userId}`;
        await client.query(`insert into orgs (org_id, slug, name, owner_user_id, created_at, updated_at)
          values ($1,$2,$3,$4,now(),now()) on conflict (org_id) do nothing`, [orgId, `${(user.email || userId).split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-workspace`, `${user.full_name || userId} Workspace`, userId]);
        await client.query(`insert into org_memberships (membership_id, org_id, user_id, role, invited_by, created_at, updated_at)
          values ($1,$2,$3,'owner',$3,now(),now()) on conflict (org_id, user_id) do nothing`, [`mem-${userId}`, orgId, userId]);
      });
      return this.getUser(userId);
    },
    async authenticateUser(email, password) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(`select * from app_users where lower(email)=lower($1) limit 1`, [String(email || '')]);
        const row = result.rows[0];
        if (!row || !row.password_digest || !verifyPassword(password, row.password_digest)) return null;
        delete row.password_digest;
        return row;
      });
    },
    async getUser(userId) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(`select user_id, email, full_name, role, plan_id, created_at, updated_at from app_users where user_id = $1 limit 1`, [String(userId)]);
        return result.rows[0] || null;
      });
    },
    async findUserByEmail(email) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(`select user_id, email, full_name, role, plan_id, created_at, updated_at from app_users where lower(email)=lower($1) limit 1`, [String(email || '')]);
        return result.rows[0] || null;
      });
    },
    async listUsers(limit = 100) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(`select user_id, email, full_name, role, plan_id, created_at, updated_at from app_users order by updated_at desc limit $1`, [Math.max(Number(limit || 100), 1)]);
        return result.rows;
      });
    },
    async createSession(userId, metadata = {}) {
      const session = { session_id: randomId('sess'), user_id: String(userId), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(), metadata_json: metadata };
      await withPgClient(connectionString, async (client) => {
        await client.query(`insert into auth_sessions (session_id, user_id, expires_at, metadata_json, created_at, updated_at) values ($1,$2,$3,$4::jsonb,now(),now())`, [session.session_id, session.user_id, session.expires_at, JSON.stringify(session.metadata_json || {})]);
      });
      return session;
    },
    async getSession(sessionId) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(`select * from auth_sessions where session_id=$1 and expires_at > now() limit 1`, [String(sessionId)]);
        return result.rows[0] || null;
      });
    },
    async touchSession(sessionId, maxAgeSec = 60 * 60 * 24 * 14) {
      await withPgClient(connectionString, async (client) => {
        await client.query(`update auth_sessions set expires_at = now() + ($2::text || ' seconds')::interval, updated_at = now() where session_id=$1`, [String(sessionId), String(Math.max(Number(maxAgeSec || 0), 300))]);
      });
      return this.getSession(sessionId);
    },
    async deleteSession(sessionId) {
      await withPgClient(connectionString, async (client) => { await client.query(`delete from auth_sessions where session_id=$1`, [String(sessionId)]); });
      return { ok: true };
    },
    async getSubscription(userId) {
      return withPgClient(connectionString, async (client) => {
        const result = await client.query(`select * from subscriptions where user_id = $1 order by updated_at desc limit 1`, [String(userId)]);
        return result.rows[0] || null;
      });
    },
    async setSubscription(userId, patch = {}) {
      await withPgClient(connectionString, async (client) => {
        await client.query(`
          insert into subscriptions (subscription_id, user_id, plan_id, status, billing_provider, current_period_start, current_period_end, metadata_json, created_at, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now(),now())
          on conflict (subscription_id) do update set
            plan_id=excluded.plan_id,
            status=excluded.status,
            billing_provider=excluded.billing_provider,
            current_period_start=excluded.current_period_start,
            current_period_end=excluded.current_period_end,
            metadata_json=excluded.metadata_json,
            updated_at=now()
        `, [patch.subscription_id || `sub-${userId}`, String(userId), patch.plan_id || 'free', patch.status || 'active', patch.billing_provider || 'mock', patch.current_period_start || nowIso(), patch.current_period_end || null, JSON.stringify(patch.metadata_json || patch.metadata || {})]);
        await client.query(`update app_users set plan_id = $2, updated_at = now() where user_id = $1`, [String(userId), patch.plan_id || 'free']);
      });
      return this.getSubscription(userId);
    },
    async recordUsage(entry = {}) {
      const usageId = String(entry.usage_id || randomId('usage'));
      await withPgClient(connectionString, async (client) => {
        await client.query(`insert into usage_ledger (usage_id, user_id, meter_key, quantity, source, metadata_json, created_at)
          values ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [usageId, String(entry.user_id), entry.meter_key || 'compute_credit', Number(entry.quantity || 0), entry.source || 'system', JSON.stringify(entry.metadata_json || entry.metadata || {}), entry.created_at || nowIso()]);
      });
      return { ...entry, usage_id: usageId };
    },
    async getUsageSummary(userId) {
      return withPgClient(connectionString, async (client) => {
        const total = await client.query(`select coalesce(sum(quantity),0) as total_quantity from usage_ledger where user_id = $1`, [String(userId)]);
        const recent = await client.query(`select * from usage_ledger where user_id = $1 order by created_at desc limit 20`, [String(userId)]);
        return { user_id: String(userId), total_quantity: Number(total.rows[0]?.total_quantity || 0), recent: recent.rows };
      });
    },
    async createCheckoutSession(userId, planId, actor = {}, providerPayload = {}) {
      const session = {
        checkout_session_id: randomId('chk'), user_id: String(userId), plan_id: planId, status: providerPayload.status || 'pending',
        provider: providerPayload.provider || runtime.billingProvider || 'mock', checkout_url: providerPayload.checkout_url || `/billing/mock-checkout/${planId}?user_id=${encodeURIComponent(userId)}`,
        provider_session_id: providerPayload.provider_session_id || null,
        metadata_json: { created_by: actor?.id || null, ...(providerPayload.metadata_json || {}) },
      };
      await withPgClient(connectionString, async (client) => {
        await client.query(`insert into checkout_sessions (checkout_session_id, user_id, plan_id, status, provider, checkout_url, provider_session_id, metadata_json, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())`, [session.checkout_session_id, session.user_id, session.plan_id, session.status, session.provider, session.checkout_url, session.provider_session_id, JSON.stringify(session.metadata_json)]);
      });
      return session;
    },
    async markCheckoutSession(checkoutSessionId, patch = {}) {
      await withPgClient(connectionString, async (client) => {
        const fields = [];
        const values = [];
        let i = 1;
        for (const [key, value] of Object.entries(patch)) { fields.push(`${key}=$${i++}`); values.push(typeof value === 'object' && value != null ? JSON.stringify(value) : value); }
        if (!fields.length) return;
        values.push(String(checkoutSessionId));
        await client.query(`update checkout_sessions set ${fields.join(', ')} where checkout_session_id=$${i}`, values);
      });
      return withPgClient(connectionString, async (client) => (await client.query(`select * from checkout_sessions where checkout_session_id=$1 limit 1`, [String(checkoutSessionId)])).rows[0] || null);
    },
async recordWebhookEvent(eventId, payload = {}) {
  const id = String(eventId || '');
  if (!id) return { inserted: false, duplicate: false };
  return withPgClient(connectionString, async (client) => {
    const result = await client.query(
      `insert into webhook_events (event_id, provider, event_type, payload_json, processed_at, created_at)
       values ($1,$2,$3,$4::jsonb,now(),now())
       on conflict (event_id) do nothing`,
      [id, payload.provider || 'stripe', payload.event_type || payload.type || null, JSON.stringify(payload)]
    );
    if (result.rowCount === 0) {
      const existing = await client.query(`select * from webhook_events where event_id=$1 limit 1`, [id]);
      return { inserted: false, duplicate: true, event: existing.rows[0] || null };
    }
    return { inserted: true, duplicate: false };
  });
},
async getWebhookEvent(eventId) {
  return withPgClient(connectionString, async (client) => (await client.query(`select * from webhook_events where event_id=$1 limit 1`, [String(eventId)])).rows[0] || null);
},
async listPlans() { return PRODUCT_PLANS; },

    async createOrg(org = {}, actor = {}) {
      const next = { org_id: org.org_id || randomId('org'), slug: String(org.slug || `${String(org.name || 'workspace').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${Math.random().toString(16).slice(2,6)}`), name: String(org.name || 'Workspace'), owner_user_id: String(org.owner_user_id || actor.id), billing_email: org.billing_email || null };
      await withPgClient(connectionString, async (client) => {
        await client.query(`insert into orgs (org_id, slug, name, owner_user_id, billing_email, created_at, updated_at) values ($1,$2,$3,$4,$5,now(),now())`, [next.org_id, next.slug, next.name, next.owner_user_id, next.billing_email]);
        await client.query(`insert into org_memberships (membership_id, org_id, user_id, role, invited_by, created_at, updated_at) values ($1,$2,$3,'owner',$3,now(),now()) on conflict (org_id, user_id) do nothing`, [randomId('mem'), next.org_id, next.owner_user_id]);
      });
      return this.getOrg(next.org_id);
    },
    async getOrg(orgId) { return withPgClient(connectionString, async (client) => (await client.query(`select * from orgs where org_id=$1 limit 1`, [String(orgId)])).rows[0] || null); },
    async listOrgsForUser(userId) { return withPgClient(connectionString, async (client) => (await client.query(`select o.* from orgs o join org_memberships m on m.org_id=o.org_id where m.user_id=$1 order by o.updated_at desc`, [String(userId)])).rows); },
    async getMembership(orgId, userId) { return withPgClient(connectionString, async (client) => (await client.query(`select * from org_memberships where org_id=$1 and user_id=$2 limit 1`, [String(orgId), String(userId)])).rows[0] || null); },
    async listOrgMembers(orgId) { return withPgClient(connectionString, async (client) => (await client.query(`select m.*, json_build_object('user_id',u.user_id,'email',u.email,'full_name',u.full_name,'role',u.role,'plan_id',u.plan_id) as user from org_memberships m join app_users u on u.user_id=m.user_id where m.org_id=$1 order by m.created_at asc`, [String(orgId)])).rows); },
    async addOrgMember(orgId, userId, role = 'member', actor = {}) {
      await withPgClient(connectionString, async (client) => {
        await client.query(`insert into org_memberships (membership_id, org_id, user_id, role, invited_by, created_at, updated_at)
          values ($1,$2,$3,$4,$5,now(),now()) on conflict (org_id, user_id) do update set role=excluded.role, invited_by=excluded.invited_by, updated_at=now()`, [randomId('mem'), String(orgId), String(userId), normalizedOrgRole(role), actor.id || null]);
      });
      return this.getMembership(orgId, userId);
    },
    async removeOrgMember(orgId, userId) {
      await withPgClient(connectionString, async (client) => { await client.query(`delete from org_memberships where org_id=$1 and user_id=$2`, [String(orgId), String(userId)]); });
      return { ok: true };
    },
  };
}

export function createProductStoreForRuntime(runtime = {}) {
  return runtime.mode === 'postgres' ? createPostgresProductStore(runtime) : createProductStore(runtime);
}

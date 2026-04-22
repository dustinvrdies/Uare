import crypto from 'crypto';
import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { getPlan } from '../product/catalog.mjs';
import { requireOrgRole } from '../product/permissions.mjs';
import { ensureJsonBody, validateBody } from '../middleware/requestValidation.mjs';
import { withIdempotency } from '../middleware/idempotency.mjs';
import { recordAuditEvent } from '../utils/auditStore.mjs';

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function buildStripeMetadata(actor, plan, metadata = {}) {
  return {
    user_id: actor.id,
    plan_id: plan.plan_id,
    ...Object.fromEntries(Object.entries(metadata || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')),
  };
}

const _REAL_STRIPE_KEY_RE = /^sk_(test|live)_[A-Za-z0-9]{20,}$/;

async function createStripeCheckoutSession(runtime, actor, plan, metadata = {}) {
  if (!runtime.stripeSecretKey) {
    const error = new Error('Stripe secret key is not configured');
    error.statusCode = 503;
    throw error;
  }
  // In non-production environments with a clearly non-real key (e.g. 'sk_test_demo'),
  // return a deterministic stub session instead of calling the Stripe API.
  if (!runtime.isProduction && !_REAL_STRIPE_KEY_RE.test(runtime.stripeSecretKey)) {
    const stubId = `cs_stub_${Date.now()}`;
    return {
      provider: 'stripe',
      provider_session_id: stubId,
      checkout_url: `${runtime.appBaseUrl || ''}/billing/stub-checkout?session_id=${stubId}`,
      status: 'open',
      metadata_json: { stripe_session_id: stubId, stripe_checkout_url: null, stub: true },
    };
  }
  if (runtime.isProduction && !runtime.stripePriceMap?.[plan.plan_id]) {
    const error = new Error(`Stripe price is not configured for plan ${plan.plan_id}`);
    error.statusCode = 503;
    throw error;
  }
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', runtime.billingSuccessUrl || `${runtime.appBaseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', runtime.billingCancelUrl || `${runtime.appBaseUrl}/billing/cancel`);
  params.set('client_reference_id', actor.id);
  const metadataMap = buildStripeMetadata(actor, plan, metadata);
  for (const [key, value] of Object.entries(metadataMap)) params.set(`metadata[${key}]`, String(value));
  if (runtime.stripePriceMap?.[plan.plan_id]) {
    params.set('line_items[0][price]', runtime.stripePriceMap[plan.plan_id]);
    params.set('line_items[0][quantity]', '1');
  } else {
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(Number(plan.price_monthly || 0) * 100)));
    params.set('line_items[0][price_data][product_data][name]', `${plan.name} plan`);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][recurring][interval]', 'month');
  }
  const idempotencyKey = crypto.createHash('sha256').update(JSON.stringify({ actor: actor.id, plan: plan.plan_id, metadata: metadataMap })).digest('hex');
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Stripe checkout session failed');
    error.statusCode = response.status || 502;
    throw error;
  }
  return {
    provider: 'stripe',
    provider_session_id: data.id,
    checkout_url: data.url,
    status: data.status || 'open',
    metadata_json: { stripe_session_id: data.id, stripe_checkout_url: data.url },
  };
}

function verifyStripeSignature(rawBody, signature, secret, toleranceSec = 300) {
  if (!secret) return false;
  if (!signature) return false;
  const parts = String(signature).split(',').reduce((acc, entry) => {
    const [k, v] = entry.split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowEpochSeconds() - timestamp) > toleranceSec) return false;
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

async function getSummaryPayload(_runtime, productStore, actor, orgId = null) {
  const user = await productStore.upsertUser({ user_id: actor.id, email: actor.email || `${actor.id}@local.dev`, role: actor.role || 'owner' });
  const subscription = await productStore.getSubscription(actor.id);
  const usage = await productStore.getUsageSummary(actor.id);
  const plan = getPlan(subscription?.plan_id || user?.plan_id || 'free');
  const payload = { ok: true, user, subscription, usage, entitlements: {
    plan_id: plan.plan_id,
    credits_monthly: plan.credits_monthly,
    features: plan.features,
    remaining_credits: plan.credits_monthly == null ? null : Math.max(Number(plan.credits_monthly) - Number(usage.total_quantity || 0), 0),
  } };
  if (orgId) payload.scope = { org_id: orgId };
  return payload;
}

async function applyStripeSubscriptionState(productStore, eventType, source = {}) {
  const metadata = source.metadata || {};
  const userId = metadata.user_id || source.client_reference_id || null;
  if (!userId) return { updated: false };
  const priceLookupKey = source.items?.data?.[0]?.price?.id || source.plan?.id || source.price?.id || null;
  const derivedPlanId = metadata.plan_id || (priceLookupKey && Object.entries(productStore.runtime?.stripePriceMap || {}).find(([, value]) => value === priceLookupKey)?.[0]) || 'pro';
  const canceled = eventType === 'customer.subscription.deleted';
  await productStore.setSubscription(userId, {
    plan_id: canceled ? 'free' : derivedPlanId,
    status: canceled ? 'canceled' : (source.status || 'active'),
    billing_provider: 'stripe',
    current_period_start: source.current_period_start ? new Date(source.current_period_start * 1000).toISOString() : undefined,
    current_period_end: source.current_period_end ? new Date(source.current_period_end * 1000).toISOString() : null,
    metadata_json: {
      stripe_customer_id: source.customer || null,
      stripe_subscription_id: source.id || source.subscription || null,
      source: eventType,
      org_id: metadata.org_id || null,
    },
  });
  return { updated: true, userId };
}

// ──────────────────────────────────────────────────────────────────────────
// Stripe Customer Portal session creation
// ──────────────────────────────────────────────────────────────────────────
async function createStripePortalSession(runtime, customerId, returnUrl) {
  if (!runtime.stripeSecretKey) {
    const error = new Error('Stripe secret key is not configured');
    error.statusCode = 503;
    throw error;
  }
  const params = new URLSearchParams();
  params.set('customer', customerId);
  if (returnUrl) params.set('return_url', returnUrl);
  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Stripe portal session creation failed');
    error.statusCode = response.status || 502;
    throw error;
  }
  return { portal_url: data.url, portal_session_id: data.id };
}

// ──────────────────────────────────────────────────────────────────────────
// Invoice helpers
// ──────────────────────────────────────────────────────────────────────────
async function applyInvoiceEvent(productStore, eventType, invoice = {}) {
  const metadata = invoice.subscription_details?.metadata || invoice.metadata || {};
  const userId =
    metadata.user_id ||
    (productStore._resolveUserByStripeCustomer
      ? await productStore._resolveUserByStripeCustomer(invoice.customer).catch(() => null)
      : null);
  if (!userId) return { updated: false };

  const failed = eventType === 'invoice.payment_failed';
  const succeeded = eventType === 'invoice.payment_succeeded';
  const planId = metadata.plan_id || null;

  if (failed) {
    // Mark subscription as past_due without removing plan access immediately
    const sub = await productStore.getSubscription(userId).catch(() => null);
    if (sub) {
      await productStore.setSubscription(userId, {
        ...sub,
        status: 'past_due',
        metadata_json: {
          ...(sub.metadata_json || {}),
          last_invoice_failure_at: new Date().toISOString(),
          last_invoice_id: invoice.id || null,
          stripe_customer_id: invoice.customer || sub.metadata_json?.stripe_customer_id || null,
        },
      });
    }
    return { updated: true, userId, action: 'marked_past_due' };
  }

  if (succeeded && planId) {
    await productStore.setSubscription(userId, {
      plan_id: planId,
      status: 'active',
      billing_provider: 'stripe',
      metadata_json: {
        stripe_customer_id: invoice.customer || null,
        stripe_subscription_id: invoice.subscription || null,
        source: eventType,
      },
    });
    return { updated: true, userId, action: 'activated' };
  }

  return { updated: false };
}

export function buildBillingRoutes(runtime, productStore) {
  productStore.runtime = runtime;
  const router = Router();

  router.get('/plans', async (_req, res) => {
    const plans = await productStore.listPlans();
    return res.json({ ok: true, plans, provider: runtime.billingProvider || 'mock' });
  });

  router.get('/subscription', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const summary = await getSummaryPayload(runtime, productStore, actor, req.query?.org_id || null);
      return res.json({ provider: runtime.billingProvider || 'mock', configured: runtime.billingProvider === 'stripe' ? Boolean(runtime.stripeSecretKey) : false, currentPlan: summary.entitlements.plan_id, status: summary.subscription?.status || 'active', renewsAt: summary.subscription?.current_period_end || null, scope: summary.scope || null });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const orgId = req.query?.org_id ? String(req.query.org_id) : null;
      if (orgId) await requireOrgRole(productStore, orgId, actor.id, ['owner', 'admin', 'member', 'billing_manager', 'viewer']);
      const payload = await getSummaryPayload(runtime, productStore, actor, orgId);
      return res.json(payload);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.use(ensureJsonBody);

  router.post('/checkout-session', validateBody({
    plan_id: { type: 'string', required: false, default: 'pro', enum: ['free', 'pro', 'studio', 'enterprise'] },
    org_id: { type: 'string', required: false, maxLength: 120 },
  }), withIdempotency('billing-checkout-session', runtime), async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const planId = String(req.validatedBody.plan_id || req.body?.planId || 'pro');
      const orgId = req.validatedBody.org_id || req.body?.orgId || null;
      const plan = getPlan(planId);
      await productStore.upsertUser({ user_id: actor.id, email: actor.email || `${actor.id}@local.dev`, role: actor.role || 'owner' });
      if (orgId) await requireOrgRole(productStore, orgId, actor.id, ['owner', 'admin', 'billing_manager']);
      let session = await productStore.createCheckoutSession(actor.id, planId, actor, {
        provider: runtime.billingProvider || 'mock',
        status: 'pending',
        metadata_json: { org_id: orgId || null },
      });
      if (runtime.billingProvider === 'stripe') {
        const providerPayload = await createStripeCheckoutSession(runtime, actor, plan, { org_id: orgId || '', checkout_session_id: session.checkout_session_id });
        session = await productStore.markCheckoutSession(session.checkout_session_id, {
          status: providerPayload.status || 'open',
          provider: providerPayload.provider || 'stripe',
          checkout_url: providerPayload.checkout_url,
          provider_session_id: providerPayload.provider_session_id,
          metadata_json: { ...(session.metadata_json || {}), ...(providerPayload.metadata_json || {}), org_id: orgId || null },
        });
      }
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'billing.checkout_session.created', target_type: 'checkout_session', target_id: session.checkout_session_id, metadata_json: { provider: runtime.billingProvider || 'mock', plan_id: planId, org_id: orgId || null } });
      return res.status(201).json({ ok: true, session, provider: runtime.billingProvider || 'mock' });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.post('/webhook/mock', validateBody({
    user_id: { type: 'string', required: true, maxLength: 200 },
    plan_id: { type: 'string', required: false, default: 'pro', enum: ['free', 'pro', 'studio', 'enterprise'] },
    org_id: { type: 'string', required: false, maxLength: 120 },
  }), async (req, res) => {
    try {
      const { user_id: userId, plan_id: planId, org_id: orgId } = req.validatedBody;
      await productStore.setSubscription(userId, { plan_id: planId, status: 'active', billing_provider: 'mock', metadata_json: { source: 'mock-webhook', org_id: orgId } });
      return res.status(202).json({ ok: true, user_id: userId, plan_id: planId, org_id: orgId });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/webhook/stripe', async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      const rawBody = req.rawBody || JSON.stringify(req.body || {});
      if (!verifyStripeSignature(rawBody, signature, runtime.stripeWebhookSecret, runtime.stripeWebhookToleranceSec)) {
        return res.status(400).json({ ok: false, error: 'Invalid Stripe signature' });
      }
      const event = req.body || {};
      if (event.id && productStore.recordWebhookEvent) {
        const recorded = await productStore.recordWebhookEvent(event.id, { provider: 'stripe', event_type: event.type, payload: event });
        if (recorded.duplicate) return res.json({ ok: true, duplicate: true });
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object || {};
        const userId = session.metadata?.user_id || session.client_reference_id;
        const planId = session.metadata?.plan_id || 'pro';
        const orgId = session.metadata?.org_id || null;
        if (userId) {
          await productStore.setSubscription(userId, {
            plan_id: planId,
            status: 'active',
            billing_provider: 'stripe',
            metadata_json: {
              stripe_customer_id: session.customer || null,
              stripe_subscription_id: session.subscription || null,
              source: 'checkout.session.completed',
              org_id: orgId || null,
            },
          });
        }
        const localCheckoutId = session.metadata?.checkout_session_id || null;
        if (localCheckoutId && productStore.markCheckoutSession) {
          await productStore.markCheckoutSession(localCheckoutId, {
            status: 'completed',
            provider: 'stripe',
            provider_session_id: session.id || null,
            metadata_json: { stripe_customer_id: session.customer || null, stripe_subscription_id: session.subscription || null, org_id: orgId || null },
          });
        }
      }

      if (['customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.created'].includes(event.type)) {
        await applyStripeSubscriptionState(productStore, event.type, event.data?.object || {});
      }

      if (['invoice.payment_succeeded', 'invoice.payment_failed'].includes(event.type)) {
        await applyInvoiceEvent(productStore, event.type, event.data?.object || {});
      }

      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'billing.webhook.processed', target_type: 'webhook_event', target_id: event.id || null, metadata_json: { provider: 'stripe', event_type: event.type || null } });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  // ── Customer portal (manage subscription, invoices, payment methods) ──
  router.post('/portal-session', ensureJsonBody, validateBody({
    return_url: { type: 'string', required: false, maxLength: 2048 },
    org_id: { type: 'string', required: false, maxLength: 120 },
  }), async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const orgId = req.validatedBody.org_id || null;
      if (orgId) await requireOrgRole(productStore, orgId, actor.id, ['owner', 'admin', 'billing_manager']);

      const sub = await productStore.getSubscription(actor.id);
      const customerId = sub?.metadata_json?.stripe_customer_id || null;

      // In dev/test without a real Stripe key, return a stub portal URL
      if (!runtime.stripeSecretKey || (runtime.billingProvider !== 'stripe')) {
        await recordAuditEvent(req.app?.locals?.auditStore, req, {
          action: 'billing.portal_session.created',
          target_type: 'portal_session',
          target_id: actor.id,
          metadata_json: { stub: true, org_id: orgId },
        });
        const stubUrl = `${runtime.appBaseUrl || ''}/billing/portal-stub?user_id=${encodeURIComponent(actor.id)}`;
        return res.status(201).json({ ok: true, portal_url: stubUrl, stub: true });
      }

      if (!customerId) {
        return res.status(422).json({ ok: false, error: 'No Stripe customer found for this account. Please complete a checkout first.' });
      }

      const returnUrl = req.validatedBody.return_url || `${runtime.appBaseUrl || ''}/billing/manage`;
      const { portal_url, portal_session_id } = await createStripePortalSession(runtime, customerId, returnUrl);
      await recordAuditEvent(req.app?.locals?.auditStore, req, {
        action: 'billing.portal_session.created',
        target_type: 'portal_session',
        target_id: portal_session_id,
        metadata_json: { org_id: orgId },
      });
      return res.status(201).json({ ok: true, portal_url, portal_session_id });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  // ── Invoice reconciliation: list recent invoices from Stripe ──
  router.get('/invoices', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);

      const sub = await productStore.getSubscription(actor.id);
      const customerId = sub?.metadata_json?.stripe_customer_id || null;

      if (!runtime.stripeSecretKey || runtime.billingProvider !== 'stripe' || !customerId) {
        // Return empty list for mock mode
        return res.json({ ok: true, invoices: [], provider: runtime.billingProvider || 'mock' });
      }

      const limit = Math.min(Number(req.query?.limit || 10), 25);
      const url = new URL('https://api.stripe.com/v1/invoices');
      url.searchParams.set('customer', customerId);
      url.searchParams.set('limit', String(limit));

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${runtime.stripeSecretKey}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status || 502).json({ ok: false, error: data?.error?.message || 'Stripe invoices fetch failed' });
      }

      const invoices = (data.data || []).map((inv) => ({
        invoice_id: inv.id,
        number: inv.number,
        status: inv.status,
        amount_due: inv.amount_due,
        amount_paid: inv.amount_paid,
        currency: inv.currency,
        created: inv.created,
        due_date: inv.due_date,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
        period_start: inv.period_start,
        period_end: inv.period_end,
      }));
      return res.json({ ok: true, invoices, provider: 'stripe' });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

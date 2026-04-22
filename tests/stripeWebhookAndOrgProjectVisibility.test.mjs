
import crypto from 'crypto';
import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

function signStripe(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const signed = `${ts}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${ts},v1=${sig}`;
}

const webhookSecret = 'whsec_test_secret';
const server = await startBackendServer(8927, {
  BILLING_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_demo',
  STRIPE_WEBHOOK_SECRET: webhookSecret,
});

try {
  const headers = { 'content-type': 'application/json' };

  const ownerReg = await fetch(`${server.baseUrl}/auth/register`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'owner2@example.com', password: 'secret123', full_name: 'Owner Two' }),
  });
  const ownerCookie = ownerReg.headers.get('set-cookie') || '';
  const ownerMe = await fetch(`${server.baseUrl}/auth/me`, { headers: { cookie: ownerCookie }});
  const ownerMePayload = await ownerMe.json();
  const ownerUserId = ownerMePayload.user.user_id;

  const memberReg = await fetch(`${server.baseUrl}/auth/register`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'member2@example.com', password: 'secret123', full_name: 'Member Two' }),
  });
  const memberCookie = memberReg.headers.get('set-cookie') || '';
  const memberMe = await fetch(`${server.baseUrl}/auth/me`, { headers: { cookie: memberCookie }});
  const memberMePayload = await memberMe.json();
  const memberUserId = memberMePayload.user.user_id;

  const createOrg = await fetch(`${server.baseUrl}/orgs`, {
    method: 'POST',
    headers: { ...headers, cookie: ownerCookie, 'x-user-id': ownerUserId, 'x-user-role': 'owner' },
    body: JSON.stringify({ org: { name: 'Pass2 Org' } }),
  });
  const orgPayload = await createOrg.json();
  assert(createOrg.status === 201, 'expected org create 201');
  const orgId = orgPayload.org.org_id;

  const addMember = await fetch(`${server.baseUrl}/orgs/${orgId}/members`, {
    method: 'POST',
    headers: { ...headers, cookie: ownerCookie, 'x-user-id': ownerUserId, 'x-user-role': 'owner' },
    body: JSON.stringify({ email: 'member2@example.com', role: 'member' }),
  });
  assert(addMember.status === 201, 'expected add member 201');

  const ownerProject = await fetch(`${server.baseUrl}/projects`, {
    method: 'POST',
    headers: { ...headers, cookie: ownerCookie, 'x-user-id': ownerUserId, 'x-user-role': 'owner' },
    body: JSON.stringify({ name: 'Shared Org Project', org_id: orgId }),
  });
  const ownerProjectPayload = await ownerProject.json();
  assert(ownerProject.status === 201, 'expected project create 201');
  const projectId = ownerProjectPayload.project.id;

  const memberProjects = await fetch(`${server.baseUrl}/projects?org_id=${encodeURIComponent(orgId)}`, {
    headers: { cookie: memberCookie, 'x-user-id': memberUserId, 'x-user-role': 'member' },
  });
  const memberProjectsPayload = await memberProjects.json();
  assert(memberProjects.ok, 'expected member project list ok');
  assert((memberProjectsPayload.projects || []).some((project) => project.id === projectId), 'expected member can see org project');

  const outsiderProjects = await fetch(`${server.baseUrl}/projects/${projectId}`, {
    headers: { 'x-user-id': 'outsider', 'x-user-role': 'owner' },
  });
  assert(outsiderProjects.status === 404, 'expected outsider blocked from org project');

  const checkout = await fetch(`${server.baseUrl}/billing/checkout-session`, {
    method: 'POST',
    headers: { ...headers, cookie: ownerCookie, 'x-user-id': ownerUserId, 'x-user-role': 'owner' },
    body: JSON.stringify({ plan_id: 'pro', org_id: orgId }),
  });
  const checkoutPayload = await checkout.json();
  assert(checkout.status === 201, 'expected checkout 201');
  const checkoutId = checkoutPayload.session.checkout_session_id;

  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_live_demo', metadata: { user_id: ownerUserId, plan_id: 'pro', org_id: orgId, checkout_session_id: checkoutId }, customer: 'cus_123', subscription: 'sub_123' } }
  };
  const raw = JSON.stringify(event);
  const webhook = await fetch(`${server.baseUrl}/billing/webhook/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signStripe(raw, webhookSecret) },
    body: raw,
  });
  assert(webhook.ok, 'expected stripe webhook ok');

  const summary = await fetch(`${server.baseUrl}/billing/summary?org_id=${encodeURIComponent(orgId)}`, {
    headers: { cookie: ownerCookie, 'x-user-id': ownerUserId, 'x-user-role': 'owner' },
  });
  const summaryPayload = await summary.json();
  assert(summary.ok, 'expected billing summary ok');
  assert(summaryPayload.entitlements?.plan_id === 'pro', 'expected plan upgraded to pro');

  console.log('stripeWebhookAndOrgProjectVisibility.test.mjs passed');
} finally {
  await server.stop();
}

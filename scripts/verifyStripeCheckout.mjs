const baseUrl = process.env.APP_BASE_URL || 'http://localhost:8787';
const planId = process.env.TEST_PLAN_ID || 'pro';
const orgId = process.env.TEST_ORG_ID || null;

const res = await fetch(new URL('/billing/checkout-session', baseUrl), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ planId, plan_id: planId, orgId, org_id: orgId })
});

const data = await res.json().catch(() => null);

console.log(JSON.stringify({
  status: res.status,
  ok: res.ok,
  response: data
}, null, 2));

if (!res.ok) {
  process.exit(1);
}

if (!data || (!data.url && !data.checkoutUrl)) {
  console.error('Checkout response did not include a URL.');
  process.exit(1);
}

if (data.status === 'mock' || data.live === false) {
  console.warn('Checkout is in mock/offline mode. Confirm STRIPE_SECRET_KEY and price IDs are configured.');
}

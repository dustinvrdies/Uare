# UARE Production Verification Runbook

Use this after deploying the app with real environment variables.

## Required environment variables

```bash
APP_BASE_URL="https://your-domain.com"
STRIPE_SECRET_KEY="sk_live_or_sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_PRO="price_..."
STRIPE_PRICE_ENTERPRISE="price_..."
BILLING_PROVIDER="stripe"
PRODUCT_STORE_FILE=".product_store.json"
PROJECT_STORE_FILE=".project_store.json"
MISSION_STORE_FILE=".mission_store.json"
TEAM_STORE_FILE=".team_store.json"
```

## 1. Health check

```bash
npm run verify:prod
```

This verifies:
- app responds
- auth routes respond
- billing plans respond
- subscription lifecycle responds
- export summary responds
- org routes respond

## 2. Stripe checkout test

Start a checkout session:

```bash
APP_BASE_URL="https://your-domain.com" npm run verify:stripe
```

Expected:
- checkout session created
- response includes Stripe/live checkout URL when real keys are configured
- fallback/mock mode should only occur in local/offline development

## 3. Webhook delivery test

In Stripe dashboard:
- Add endpoint: `https://your-domain.com/billing/webhook/stripe`
- Events:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

With Stripe CLI:

```bash
stripe listen --forward-to https://your-domain.com/billing/webhook/stripe
stripe trigger checkout.session.completed
```

Expected:
- webhook receives `2xx`
- subscription state updates
- org/user scope is preserved

## 4. Browser E2E smoke

```bash
npm run e2e:smoke
```

Expected:
- lab loads
- auth overlay or app shell appears
- billing/team/export panels are visible
- no fatal client-side JS crash

## 5. Manual production checklist

- Register user
- Create org
- Create project
- Run wizard mission
- Confirm mission persists after refresh
- Upgrade plan through Stripe checkout
- Confirm webhook fulfillment changes subscription state
- Invite another user
- Accept invite
- Share project with role
- Confirm non-member cannot access project
- Export package
- Confirm exported artifacts only expose authorized project/mission data

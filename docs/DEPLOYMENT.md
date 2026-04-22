# Production Deployment Guide

Recommended baseline:
- Node 20+
- Postgres 15+
- TLS via reverse proxy or managed platform
- Stripe test/live keys
- persistent artifact directory

Launch order:
1. `npm ci`
2. `npm run preflight:prod`
3. `npm run db:migrate`
4. `npm test`
5. `npm start`
6. verify `/ops/liveness` and `/ops/readiness`
7. `npm run verify:prod`
8. `npm run verify:stripe`
9. `npm run e2e:smoke`

Critical env:
- NODE_ENV=production
- CUSTOM_BACKEND_MODE=postgres
- DATABASE_URL=postgres://...
- SESSION_SECRET=strong-secret-32-plus-chars
- ALLOW_DEV_HEADER_AUTH=false
- APP_BASE_URL=https://your-domain.com
- CORS_ALLOWED_ORIGINS=https://your-domain.com
- BILLING_PROVIDER=stripe
- STRIPE_SECRET_KEY=...
- STRIPE_WEBHOOK_SECRET=...
- STRIPE_PRICE_PRO=...
- ARTIFACT_ROOT_DIR=/var/lib/uare/artifacts

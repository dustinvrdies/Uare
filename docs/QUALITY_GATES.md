# UARE Quality Gates

Before external beta:
- `npm run audit:prod`
- `npm run preflight:prod`
- `npm test`
- `npm run verify:prod`
- `npm run verify:stripe`
- `npm run e2e:smoke`

Production readiness requires:
- real Postgres
- real Stripe keys
- real webhook secret
- real alert webhook
- live staging verification
- successful invite/share/access-control test

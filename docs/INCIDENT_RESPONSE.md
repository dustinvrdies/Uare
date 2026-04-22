# Incident Response

SEV1: app down, data exposure, payment/webhook failure affecting many users.
SEV2: major workflow failure, export unavailable, org access bug.
SEV3: degraded UX or isolated user issues.

First checks:
1. `/ops/liveness`
2. `/ops/readiness`
3. structured logs by request ID
4. Stripe webhook delivery
5. Postgres health
6. recent deploy/feature flag changes

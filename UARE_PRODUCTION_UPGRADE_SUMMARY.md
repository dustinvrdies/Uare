# UARE production architecture upgrade summary

## What was upgraded

### 1) Postgres + Redis production posture
- Production runtime now defaults to **Postgres** instead of in-memory mode.
- Added explicit **Redis runtime support** for distributed rate limiting and event bus transport.
- Added a shared Redis client helper: `custom_backend/src/redis/client.mjs`.
- Runtime config now supports:
  - `REDIS_URL`
  - `RATE_LIMIT_MODE=redis`
  - `EVENT_BUS_MODE=redis`
  - `EVENT_BUS_REDIS_URL`
  - stronger production defaults for worker/job/replay stores.

### 2) Auth hardening
- Fixed a major architecture gap: authenticated session cookies now resolve across the app through `resolveActor`, not only `/auth/me`.
- Added rolling session refresh support via `touchSession`.
- Strengthened session cookie serialization and expiration handling.
- Improved login flow to rotate away any prior session cookie when signing in again.
- Production password policy is stronger than before.

### 3) Billing hardening
- Checkout session creation now uses Stripe idempotency keys.
- Stripe checkout no longer silently degrades to mock mode in production-style flows.
- Added Stripe webhook timestamp tolerance validation.
- Expanded webhook subscription state handling.
- Added stricter configuration checks for Stripe production readiness.

### 4) Enterprise validation + security layers
- Added request validation middleware module.
- Added trusted-origin enforcement for state-changing requests.
- Expanded security headers.
- Improved error payload structure to include validation details when safe to expose.
- Added richer ops config audit visibility around Redis / rate-limit / event bus posture.

### 5) Data-store modernization
- Added a **Postgres mission store** implementation so mission/version workflows are not file-only in production.
- Kept file-backed mode for local/dev portability.

### 6) Scalable deployment prep
- Reworked Docker image for cleaner production startup.
- Added Redis and a dedicated worker service to `docker-compose.production.yml`.
- Compose now starts:
  - postgres
  - redis
  - app
  - worker
- App and worker both run migrations before startup.

### 7) CI/CD prep
- Added GitHub Actions workflow: `.github/workflows/ci.yml`
- Workflow provisions Postgres + Redis and runs migrations and tests.

## Files added
- `custom_backend/src/redis/client.mjs`
- `custom_backend/src/middleware/requestValidation.mjs`
- `custom_backend/.github/workflows/ci.yml`

## Files materially updated
- `Dockerfile`
- `docker-compose.production.yml`
- `custom_backend/.env.production.example`
- `custom_backend/server.mjs`
- `custom_backend/scripts/preflightProduction.mjs`
- `custom_backend/src/auth/actorResolver.mjs`
- `custom_backend/src/auth/sessionService.mjs`
- `custom_backend/src/config/runtime.mjs`
- `custom_backend/src/middleware/errorHandler.mjs`
- `custom_backend/src/middleware/securityHeaders.mjs`
- `custom_backend/src/product/store.mjs`
- `custom_backend/src/rateLimit/simpleRateLimit.mjs`
- `custom_backend/src/routes/auth.mjs`
- `custom_backend/src/routes/billing.mjs`
- `custom_backend/src/routes/opsQuality.mjs`
- `custom_backend/src/store/missionStore.mjs`
- `custom_backend/tests/helpers/httpHarness.mjs`
- `custom_backend/tests/patentExternalProvider.test.mjs`

## Validation performed

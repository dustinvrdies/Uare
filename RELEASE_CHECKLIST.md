# UARE Release Checklist

## 1) Environment And Dependency Baseline
- [ ] Confirm you are in the authoritative repo root (`OneDrive/UARE_enterprise_extracted`)
- [ ] `cd custom_backend`
- [ ] Verify Node 20+ (`node -v`)
- [ ] Install dependencies from lockfile: `npm ci`
- [ ] Run dependency doctor: `npm run doctor`

## 2) Local App Bring-Up
- [ ] Create env file from template (PowerShell: `Copy-Item .env.example .env`)
- [ ] Set minimum local vars (`PORT`, `DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_URL`)
- [ ] Run migrations: `npm run db:migrate`
- [ ] Start API server: `npm start`
- [ ] Open app: `http://localhost:8787/lab`
- [ ] Confirm liveness: `http://localhost:8787/ops/liveness`
- [ ] Confirm readiness: `http://localhost:8787/ops/readiness`

## 3) Core Functional Smoke
- [ ] Create a project from the UI
- [ ] Open Mission Wizard and generate a mission
- [ ] Verify Explorer renders generated outputs
- [ ] Verify export center routes resolve and files download
- [ ] Run smoke tests: `npm run test:smoke`

## 4) Quality Gates
- [ ] Run full tests: `npm test`
- [ ] Run CAD/route suite: `npm run test:cad`
- [ ] Run production quality audit: `npm run audit:prod`
- [ ] Run production preflight: `npm run preflight:prod`
- [ ] Run production verification: `npm run verify:prod`
- [ ] Run aggregate gate: `npm run verify:all`

## 5) Security And Runtime Hardening
- [ ] Confirm `.env` is not staged in git
- [ ] Confirm session cookie settings for target environment
- [ ] Confirm CSP/security header policy is active
- [ ] Confirm request rate limits are configured for target load
- [ ] Confirm trusted-origin checks are active for production URLs

## 6) Billing/Org Verification
- [ ] Set real Stripe keys and webhook secret in staging/prod env
- [ ] Verify billing checkout path: `npm run verify:stripe`
- [ ] Validate org and membership role flows from UI/API

## 7) Data, Backup, And Operations
- [ ] Verify Postgres is the active persistence mode in production
- [ ] Run backup check: `npm run backup:postgres`
- [ ] Validate ops metrics routes with token when configured
- [ ] Validate alert webhook configuration end-to-end

## 8) Clean Release Packaging
- [ ] Run release prep cleanup: `npm run release:prep`
- [ ] Confirm these are excluded from bundle: `.git/`, `node_modules/`, `data/`, `artifacts/`, `backups/`, logs, test outputs, coverage reports
- [ ] Create release archive from cleaned source tree only
- [ ] Extract release archive into a fresh directory
- [ ] Reinstall deps in fresh directory: `npm ci`
- [ ] Re-run `npm run doctor` in fresh directory
- [ ] Re-run `npm run audit:prod` in fresh directory
- [ ] Re-run `npm test` in fresh directory
- [ ] Re-run `npm run verify:prod` in fresh directory

## 9) Final Go/No-Go
- [ ] Confirm `openapi.yaml` matches deployed behavior
- [ ] Confirm startup commands documented in root and backend README
- [ ] Confirm `/ops/readiness` returns 200 in staging
- [ ] Tag release only after all checklist sections are complete

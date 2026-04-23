# UARE

UARE is the execution backbone for building and operating workflow-heavy products.

It combines platform APIs, job orchestration, worker execution, CAD pipelines, billing, organizations, and ops tooling in one backend designed to grow into a larger product ecosystem.

## Why UARE exists
UARE is built for products that need more than CRUD.

It is designed for systems that must:
- authenticate users and teams
- manage subscriptions and usage
- run long-lived or asynchronous jobs
- generate artifacts
- expose operational visibility
- evolve from single-product backend to platform core

## Core capabilities
### Platform foundation
- auth and session handling
- organizations, membership, and roles
- billing and subscription flows
- usage and audit surfaces

### Execution layer
- workflow and job orchestration
- worker processes
- CAD execution routes and artifact handling
- queue and runtime lifecycle support

### Operations layer
- health and readiness endpoints
- production verification scripts
- metrics and audit routes
- preflight and release tooling

## Technical profile
- Node.js with ES modules
- Express API server
- PostgreSQL via `pg`
- JOSE-based auth support
- optional Redis and NATS adapters
- OpenAPI contract in `openapi.yaml`

## Repository structure
- `server.mjs` - API entrypoint
- `worker.mjs` - worker runtime
- `openapi.yaml` - API contract
- `scripts/` - operational scripts and verification tooling
- `tests/` - smoke, runtime, route, and integration coverage

## Quick start
1. Install dependencies
   - `npm install`
2. Copy the environment template
   - `cp .env.example .env`
3. Start the development server
   - `npm run dev`

Default local server:
- `http://localhost:8787`

## High-value scripts
- `npm run dev` - start local API server
- `npm test` - run the full test suite
- `npm run test:smoke` - run smoke coverage
- `npm run db:migrate` - run migrations
- `npm run doctor` - inspect local environment
- `npm run verify:all` - production-readiness validation
- `npm run release:prep` - prepare release bundle

## API surface
The main API domains currently include:
- auth
- billing
- organizations
- projects
- CAD execution
- ops quality

See `openapi.yaml` for the current contract.

## Security and configuration
- never commit `.env`
- use `.env.example` as the starting point
- rotate any secret that was previously exposed
- prefer environment-driven configuration for all runtime-sensitive values

## Documentation
- `docs/ARCHITECTURE.md` - platform architecture overview
- `docs/ROADMAP.md` - execution roadmap and maturity plan
- `CONTRIBUTING.md` - contribution workflow
- `SECURITY.md` - security expectations

## Current direction
UARE is being shaped into a platform-grade backend that can support:
- internal automation systems
- AI-assisted products
- artifact-generating workflows
- multi-tenant SaaS products
- future DAH ecosystem services

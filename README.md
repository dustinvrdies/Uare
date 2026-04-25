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

## Requirements
- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL if you are running in `CUSTOM_BACKEND_MODE=postgres`
- Optional: Redis and NATS for distributed adapters
- Optional: Python CAD runtime if you want exact CAD kernel output

## Setup
1. Work from the backend repo root.
   - Path used during the latest verified run: `C:\Users\quant\OneDrive\UARE_enterprise_extracted\custom_backend`
2. Install dependencies.
   - Preferred for a clean checkout or release bundle: `npm ci`
   - Acceptable during normal development: `npm install`
3. Create your local environment file.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - Windows Command Prompt: `copy .env.example .env`
   - macOS/Linux: `cp .env.example .env`
4. Edit `.env` for your machine.
   - Minimum local values:
     - `PORT=8787`
     - `NODE_ENV=development`
     - `CUSTOM_BACKEND_MODE=postgres`
     - `DATABASE_URL=postgres://postgres:postgres@localhost:5432/uare`
     - `SESSION_SECRET=change-me`
     - `APP_BASE_URL=http://localhost:8787`
   - For simple local auth/testing, the template already allows `ALLOW_DEV_HEADER_AUTH=true`
5. Run migrations if you are using PostgreSQL.
   - `npm run db:migrate`

## Start The App
### Standard backend start
- `npm start`
- Equivalent runtime command:
  - `node --max-old-space-size=4096 --env-file-if-exists=.env server.mjs`

### Development start
- `npm run dev`

### Guided local start
- `npm run start:local`
- This runs `npm run doctor` first, then starts the server.

### Smart start from the broader UARE wrapper
- `npm run smart:start`
- This calls the parent `start-uare.mjs` launcher when you are using the larger multi-folder layout.

### Worker runtime
- `npm run worker`
- Alias: `npm run worker:auto`

## Open The App
Once the server is up, open:
- `http://localhost:8787/lab`

Useful local endpoints:
- `http://localhost:8787/health`
- `http://localhost:8787/ready`
- `http://localhost:8787/openapi.yaml`

## First-Run Flow
After the app is running:
1. Create a project.
2. Launch the mission wizard.
3. Generate a mission.
4. Inspect the explorer and exported artifacts.

This matches the built-in first-run summary exposed by:
- `npm run first:run`

## Environment Notes
### Core runtime variables
- `PORT` - local server port, defaults to `8787` in the template
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - required for secure session handling
- `APP_BASE_URL` - base URL used for callbacks and links
- `DATA_ROOT_DIR` - local runtime data directory, defaults to `./data`
- `ARTIFACT_STORAGE_MODE` - local or object-storage backed artifact handling

### CAD runtime variables
- `CAD_KERNEL_ENABLED=false` keeps CAD kernel execution disabled
- Set `CAD_KERNEL_ENABLED=true` to enable exact solid generation
- `CAD_PYTHON_BIN` or `CAD_PYTHON_CANDIDATES` can point to the Python runtime used for CAD execution
- `OCC_PYTHON_BIN` or `OCC_PYTHON_CANDIDATES` can point to an OCC-capable Python environment

### Production-required variables
The template declares these as required in production:
- `SESSION_SECRET`
- `APP_BASE_URL`
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## High-value scripts
- `npm run dev` - start local API server
- `npm start` - start the backend with the repo's standard runtime flags
- `npm run worker` - start the worker runtime
- `npm test` - run the full test suite
- `npm run test:smoke` - run smoke coverage
- `npm run test:cad` - run CAD and workflow route coverage
- `npm run db:migrate` - run migrations
- `npm run doctor` - inspect local environment
- `npm run audit:prod` - production quality audit
- `npm run preflight:prod` - production preflight checks
- `npm run verify:prod` - production verification
- `npm run verify:all` - audit, preflight, full tests, and production verification
- `npm run release:prep` - clean runtime data before packaging a release bundle
- `npm run clean:data` - remove runtime data artifacts from the working tree
- `npm run first:run` - print the first-run operator summary

## Verification Before You Trust A Local Build
Run these in order:
1. `npm run doctor`
2. `npm run audit:prod`
3. `npm run preflight:prod`
4. `npm test`
5. `npm run verify:prod`

If you want a single gate, run:
- `npm run verify:all`

## Troubleshooting
### Missing dependencies after unpacking a ZIP
If `npm test` or `npm start` fails with a missing package such as `express`, the extracted copy was unpacked without installed dependencies. From the repo root, run:
- `npm ci`

### Corporate npm registry timeouts
If your environment forces an internal registry that times out, install from the public registry explicitly:
- `npm install --registry=https://registry.npmjs.org`

### Server starts but CAD solid output is unavailable
This usually means the backend is running, but the CAD Python runtime is not configured. Leave `CAD_KERNEL_ENABLED=false` for standard platform work, or configure the Python CAD environment before enabling kernel-backed output.

### Port already in use
Change `PORT` in `.env`, then restart the server.

## Release Hygiene And Packaging Status
The repo has a strong backend foundation, but a raw working-folder ZIP is not a clean release artifact.

What has been confirmed:
- `npm run doctor` passed in the verified repo
- `npm run audit:prod` passed in the verified repo
- The backend architecture is substantial and includes auth, sessions, orgs, billing, CAD execution, workers, analytics, ops routes, migrations, docs, CI, deployment config, and tests

What a raw working-folder archive can get wrong:
- include `.git/`
- include runtime data under `data/`
- include generated CAD artifacts under `artifacts/`
- include backup bundles under `backups/`
- include logs and test output files
- omit installed dependencies, causing `npm test` or `npm start` to fail until `npm ci` is run

Do not distribute or pitch from a dirty working-folder ZIP. Build a clean release bundle instead.

Exclude at minimum:

```txt
.git/
node_modules/
data/
artifacts/
backups/
object_storage_mirror/
*.log
*_out.txt
*_output.txt
*_results.txt
regression_*.txt
test_*.txt
coverage/
playwright-report/
test-results/
```

Before sharing a bundle:
1. Run `npm run release:prep`
2. Reinstall from the bundle with `npm ci`
3. Run `npm run doctor`
4. Run `npm run audit:prod`
5. Run `npm test`
6. Run `npm run verify:prod`

The release target should contain source, docs, migrations, scripts, config examples, and intended public assets only.

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

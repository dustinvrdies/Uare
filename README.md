# UARE Backend

Backend API for the UARE platform.

## What this repo contains
- authentication and session handling
- billing and subscription flows
- organizations and membership management
- CAD execution endpoints and job status routes
- workers, workflows, analytics, and ops quality routes

## Stack
- Node.js
- Express
- PostgreSQL
- JOSE
- optional Redis and NATS adapters

## Quick start
1. Install dependencies:
   `npm install`
2. Copy environment template:
   `cp .env.example .env`
3. Start development server:
   `npm run dev`

Default local server: `http://localhost:8787`

## Useful scripts
- `npm run dev` - start local server
- `npm test` - run all tests
- `npm run db:migrate` - run migrations
- `npm run verify:all` - production readiness checks
- `npm run doctor` - local diagnostics

## API
The API contract is defined in `openapi.yaml`.

## Security
- never commit `.env`
- use `.env.example` as the starting point
- rotate any secret that was previously exposed

## Status
This repository is being hardened for production use.

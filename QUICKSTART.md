# UARE Quickstart

## Fastest local start
Double-click one of these:
- Windows: `START_UARE.bat`
- macOS: `START_UARE.command`

## Manual local start
```bash
cd custom_backend
npm ci
npm run doctor
npm test
npm start
```

Open:
- App: `http://localhost:8787/lab`
- Liveness: `http://localhost:8787/ops/liveness`
- Readiness: `http://localhost:8787/ops/readiness`

## Recommended local flow
1. Create a project
2. Open the Mission Wizard
3. Generate a first mission
4. Open Explorer
5. Review artifacts and export bundles

## Before staging
```bash
cd custom_backend
npm run audit:prod
npm run preflight:prod
npm run verify:prod
```

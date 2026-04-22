console.log(`
UARE first-run summary

1. Start the app
   - Windows: double-click START_UARE.bat
   - macOS: double-click START_UARE.command
   - Manual: cd custom_backend && npm ci && npm start

2. Open:
   - http://localhost:8787/lab

3. First actions:
   - create a project
   - launch the mission wizard
   - generate a mission
   - inspect explorer and exports

4. Before staging:
   - npm run audit:prod
   - npm run preflight:prod
   - npm run verify:prod
`);

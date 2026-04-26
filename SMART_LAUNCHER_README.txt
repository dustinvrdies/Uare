# UARE Smart Launcher

Use the launcher that matches your computer:

- Windows: `START_UARE.bat`
- Windows PowerShell: `START_UARE.ps1`
- macOS: `START_UARE.command`
- Linux/macOS terminal: `START_UARE.sh`

What it now does:
1. Detects your OS and repo paths safely, even with spaces in the folder path
2. Tries to install Node.js/npm if missing and a supported package manager is available
3. Creates `.env` from `.env.example` and injects safe local defaults when needed
4. Finds an open port automatically if 8787 is already in use
5. Detects an already-running UARE server and reuses it
6. Installs dependencies only when package state changed, unless you force reinstall
7. Runs cleanup, audit, preflight, migrations, and tests intelligently
8. Starts the app and waits for `/ops/liveness`
9. Runs `verify:prod` best-effort after the app is up
10. Opens your browser automatically to `/lab`
11. Writes timestamped debug logs to the `logs/` folder and caches launcher state in `.uare-launch-state.json`

Optional flags:
- `--force-install`
- `--skip-tests`
- `--no-browser`
- `--strict`

Important:
- No launcher can guarantee full automatic setup on literally every computer.
- Some computers need admin rights or manual Node.js installation.
- For real production billing and staging checks, set real values in `custom_backend/.env`.

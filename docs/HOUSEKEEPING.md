# Housekeeping

Before each release:
- run `npm run clean:data`
- confirm `custom_backend/data/` only contains `.gitkeep`
- confirm `.env` is not bundled
- confirm production secrets are injected by the host, not committed

# UARE Operations Guide

## Observability
The app emits structured JSON request logs and exposes optional metrics:
- `/ops/quality/metrics-json`
- `/ops/quality/metrics-prometheus`
- `/ops/quality/config-audit`

Set `OPS_METRICS_TOKEN` in production or protect these endpoints at the network layer.

## Alerts
Set `OPS_ALERT_WEBHOOK_URL`, then test:
```bash
curl -X POST "$APP_BASE_URL/ops/alerts/test-alert" -H "content-type: application/json" -d '{"source":"manual"}'
```

## Backups
Run Postgres backups daily before beta and hourly after paid usage begins.

## Go/no-go
- `/ops/readiness` returns 200
- Stripe checkout returns a real URL
- Stripe webhook receives 2xx and is idempotent
- org/project/mission/export access checks pass
- alerts tested

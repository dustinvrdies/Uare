# Stripe Operations Guide

## Required environment variables
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- APP_BASE_URL

## Production checklist
- Create checkout sessions server-side only
- Verify webhook signatures from raw request body
- Fulfill subscriptions only from verified webhooks
- Log webhook event IDs to avoid duplicate fulfillment
- Store org_id and plan_id on local checkout/session records

## Suggested env additions
- STRIPE_PRICE_FREE
- STRIPE_PRICE_PRO
- STRIPE_PRICE_ENTERPRISE
- BILLING_PROVIDER=stripe

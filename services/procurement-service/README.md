# Procurement Service

## Purpose
Accepts purchase order intent requests and tracks their status once integration completes.

## Inputs/Outputs
- Inputs: REST purchase order requests and integration completion events.
- Outputs: Kafka intent events and status projections.

## Example
```bash
curl -s -X POST http://localhost:3001/v1/purchase-orders/request \
  -H 'content-type: application/json' \
  -d '{"sku":"LAPTOP-15","quantity":5}'
```

## Self-check
```bash
pnpm --filter procurement-service test
```

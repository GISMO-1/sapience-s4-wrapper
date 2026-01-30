# Supply Chain Service

## Purpose
Provides inventory lookups, updates projections from events, and emits low-stock signals.

## Inputs/Outputs
- Inputs: Kafka completion events and inventory queries.
- Outputs: Low stock events and REST inventory responses.

## Example
```bash
curl -s http://localhost:3002/v1/inventory/LAPTOP-15
```

## Self-check
```bash
pnpm --filter supplychain-service test
```

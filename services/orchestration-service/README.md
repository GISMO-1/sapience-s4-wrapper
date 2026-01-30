# Orchestration Service

## Purpose
Coordinates a simple procurement saga by reacting to low-stock events and triggering purchase order requests.

## Inputs/Outputs
- Inputs: Low stock events.
- Outputs: Purchase order intent events and saga state updates.

## Example
```bash
curl -s http://localhost:3005/health
```

## Self-check
```bash
pnpm --filter orchestration-service test
```

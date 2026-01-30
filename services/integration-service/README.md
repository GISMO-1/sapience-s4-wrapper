# Integration Service

## Purpose
Acts as the SAP boundary, consuming intent events, invoking a stub SAP adapter, and publishing completion events.

## Inputs/Outputs
- Inputs: Kafka intent events (purchase order requests).
- Outputs: Kafka completion events and REST responses from the cached SAP view.

## Example
```bash
curl -s http://localhost:3004/v1/sap/purchase-orders/PO-1001
```

## Self-check
```bash
pnpm --filter integration-service test
```

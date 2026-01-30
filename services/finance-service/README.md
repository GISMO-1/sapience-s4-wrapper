# Finance Service

## Purpose
Accepts invoice review intents and projects accruals when purchase orders are created.

## Inputs/Outputs
- Inputs: REST invoice review requests and integration PO events.
- Outputs: Kafka invoice review events and accrual projections.

## Example
```bash
curl -s -X POST http://localhost:3003/v1/invoices/review-request \
  -H 'content-type: application/json' \
  -d '{"invoiceId":"INV-1001","amount":1200}'
```

## Self-check
```bash
pnpm --filter finance-service test
```

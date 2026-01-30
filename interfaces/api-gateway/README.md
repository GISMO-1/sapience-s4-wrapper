# API Gateway

## Purpose
Routes intent requests to domain services and proxies domain-specific APIs.

## Inputs/Outputs
- Inputs: REST requests from clients.
- Outputs: Normalized intent responses and proxied responses.

## Example
```bash
curl -s -X POST http://localhost:3000/v1/intent \
  -H 'content-type: application/json' \
  -d '{"text":"check inventory for widgets"}'
```

## Self-check
```bash
pnpm --filter api-gateway test
```

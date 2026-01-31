# Policy outcomes store

Purpose: Store real-world outcome feedback tied to policy decisions by trace ID. Inputs are outcome payloads and query filters; outputs are stored outcome records ordered deterministically.

Example command:
```bash
curl -s -X POST http://localhost:3000/v1/policy/outcomes \
  -H 'content-type: application/json' \
  -d '{"traceId":"TRACE_ID","outcomeType":"failure","severity":3,"notes":"Synthetic test"}' | jq
```

Self-check:
```bash
curl -s http://localhost:3000/v1/policy/outcomes/TRACE_ID | jq
```

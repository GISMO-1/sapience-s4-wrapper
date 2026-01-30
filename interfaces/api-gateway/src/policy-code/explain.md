# Policy explain helpers

Purpose: Build explainable policy responses that include policy metadata, intent summary, decision details, and risk. Inputs are intent data, stored policy decisions, and policy metadata; outputs are the response shape for `/v1/policy/explain/:traceId`.

Example command:
```bash
curl -s http://localhost:3000/v1/policy/explain/TRACE_ID | jq
```

Self-check:
```bash
curl -s http://localhost:3000/v1/policy/explain/TRACE_ID | jq
```

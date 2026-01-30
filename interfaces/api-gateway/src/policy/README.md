# Policy store

Purpose: Persist policy decision records and retrieve them by trace ID for explain endpoints. Inputs are policy decision results and trace IDs; outputs are stored records from memory or Postgres.

Example command:
```bash
curl -s http://localhost:3000/v1/policy/explain/TRACE_ID | jq
```

Self-check:
```bash
curl -s http://localhost:3000/v1/policy/explain/TRACE_ID | jq
```

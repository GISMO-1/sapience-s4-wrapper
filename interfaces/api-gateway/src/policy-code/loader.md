# Policy loader

Purpose: Load and validate YAML policy files, cache the last good policy, and provide reload support. Inputs are `policies/policies.v1.yaml` (or `POLICY_PATH`) plus optional replay candidates (current/path/inline); outputs are validated policy snapshots and metadata.

Example command:
```bash
POLICY_RELOAD_ENABLED=true curl -s -X POST http://localhost:3000/v1/policy/reload | jq
```

Self-check:
```bash
curl -s http://localhost:3000/v1/policy/explain/TRACE_ID | jq
```

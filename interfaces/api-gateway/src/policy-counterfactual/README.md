# Policy counterfactuals

Purpose: deterministically compute counterfactual blast-radius reports from recorded replays, outcomes, and lifecycle data without re-executing policies. Inputs are counterfactual request payloads (policy hash, optional baseline, and window). Outputs are deterministic blast-radius reports with stable hashes.

Example command:
```bash
curl -s -X POST http://localhost:3000/v1/policy/counterfactual \
  -H 'content-type: application/json' \
  -d '{"policyHash":"<CANDIDATE_HASH>","compareToPolicyHash":"<BASELINE_HASH>","since":"2024-02-01T00:00:00Z","until":"2024-02-02T00:00:00Z","limit":200}' | jq
```

Self-check:
```bash
curl -s "http://localhost:3000/v1/policy/blast-radius?policyHash=<CANDIDATE_HASH>&since=2024-02-01T00:00:00Z&until=2024-02-02T00:00:00Z" | jq '.reportHash'
```

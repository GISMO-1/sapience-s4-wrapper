# Demo seeding

## Purpose
Use the demo seed script to generate sample intents, run a policy replay, record outcomes, and fetch quality/lineage data from the API gateway. Inputs: `API_BASE` (defaults to `http://localhost:8080`). Outputs: printed IDs (trace IDs + replay run ID) and URLs for replay report, policy quality, and lineage.

## Example command
```bash
pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts
```

### Convenience wrappers
```bash
./scripts/seed-demo.sh
# or
powershell -ExecutionPolicy Bypass -File .\scripts\seed-demo.ps1
```

## Self-check
```bash
API_BASE=http://localhost:8080 pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts --self-check
```

## Expected console output (example)
```
Seeding demo data against http://localhost:8080
• intent "create a PO for 25 laptops" → trace 9b65d6cd-...
• intent "check inventory for AUTO-ITEM" → trace 1a1320ef-...
• intent "review invoice INV-2042 for $12,450" → trace 04f56b88-...
...

Done. Key links and IDs:
• Replay run: 7dd2a9ac-...
• Replay report: http://localhost:8080/v1/policy/replay/7dd2a9ac-.../report
• Policy hash: 2f1a0c8c-...
• Policy quality: http://localhost:8080/v1/policy/quality?policyHash=2f1a0c8c-...
• Policy drift: http://localhost:8080/v1/policy/drift?policyHash=2f1a0c8c-...
• Policy lineage: http://localhost:8080/v1/policy/lineage/current
• Promotion guardrails: http://localhost:8080/v1/policy/promote/check?policyHash=2f1a0c8c-...
• Counterfactual blast radius: http://localhost:8080/v1/policy/blast-radius?policyHash=2f1a0c8c-...
• Web portal: http://localhost:5173
```

## Counterfactual blast radius
Use the recorded replay/outcome data to generate a deterministic counterfactual report for a policy hash (no policy execution occurs).

Example command:
```bash
curl -s -X POST http://localhost:8080/v1/policy/counterfactual \\
  -H 'content-type: application/json' \\
  -d '{\"policyHash\":\"<POLICY_HASH>\",\"compareToPolicyHash\":\"<BASELINE_HASH>\",\"since\":\"2024-02-01T00:00:00Z\",\"until\":\"2024-02-02T00:00:00Z\"}' | jq
```

Self-check:
```bash
curl -s \"http://localhost:8080/v1/policy/blast-radius?policyHash=<POLICY_HASH>&since=2024-02-01T00:00:00Z&until=2024-02-02T00:00:00Z\" | jq '.reportHash'
```

## Screenshots checklist (web portal)
1. Open the web portal at `http://localhost:5173`.
2. Verify the latest replay run is listed (note the run ID from the seed output).
3. Open the replay report to confirm totals and changed examples.
4. Navigate to outcomes and verify the recorded success/failure/override entries.
5. Open policy quality to confirm metrics are populated.
6. Open policy lineage to confirm the current chain loads.

## Troubleshooting
- **"Unexpected token < in JSON"**: the API base URL is pointing at the web portal or another HTML response. Ensure `API_BASE` is set to the API gateway (`http://localhost:8080` by default) and that the gateway is running. If you are using a proxy, verify it forwards `/v1/*` to the API gateway.

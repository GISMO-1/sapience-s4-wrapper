# Policy Drift Intelligence

Purpose: Compute deterministic policy drift health signals by comparing recent vs. baseline windows across outcomes and replay diffs. Inputs are a policy hash, time windows, and stored outcomes/replay data. Outputs are a drift report with metrics, deltas, and a health state.

## Example command
```bash
curl -s "http://localhost:3000/v1/policy/drift?policyHash=POLICY_HASH" | jq
```

## Self-check
Run the drift unit tests:
```bash
pnpm -C interfaces/api-gateway test -- policy-drift
```

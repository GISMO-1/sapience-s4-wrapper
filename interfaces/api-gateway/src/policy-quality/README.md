# Policy quality scoring

Purpose: Compute deterministic quality metrics from outcome feedback. Inputs are outcome records; outputs are aggregated rates and a 0–100 quality score.

Example command:
```bash
curl -s "http://localhost:3000/v1/policy/quality?policyHash=POLICY_HASH" | jq
```

Self-check:
```bash
curl -s "http://localhost:3000/v1/policy/quality?policyHash=POLICY_HASH" | jq
```

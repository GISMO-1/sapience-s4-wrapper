# Policy Lineage

Purpose: Track promotion lineage for policies, capturing parent relationships, rationale, accepted risk scores, and drift summaries. Inputs are promotion metadata plus replay-derived drift data; outputs are lineage records and chains used by policy APIs.

Example command:
```bash
curl -s http://localhost:3000/v1/policy/lineage/current | jq
```

Self-check:
```bash
pnpm --filter api-gateway test -- --runInBand policy-lineage
```

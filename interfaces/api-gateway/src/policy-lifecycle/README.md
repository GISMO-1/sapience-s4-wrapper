## Policy lifecycle guardrails
Purpose: track policy lifecycle states (draft → simulated → approved → active) and compute deterministic impact scores for promotion guardrails. Inputs are replay result records and promotion approval metadata; outputs are impact reports and stored policy status records.

Example command:
```bash
curl -s http://localhost:3000/v1/policy/status | jq
```

Self-check:
```bash
pnpm --filter api-gateway test -- -t "policy promotion"
```

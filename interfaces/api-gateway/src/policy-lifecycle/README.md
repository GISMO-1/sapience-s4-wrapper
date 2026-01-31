## Policy lifecycle guardrails
Purpose: track policy lifecycle signals and compute deterministic impact scores for promotion guardrails. Inputs are replay result records and promotion metadata; outputs are impact reports and stored policy status records.

Example command:
```bash
curl -s http://localhost:3000/v1/policy/status | jq
```

Self-check:
```bash
pnpm --filter api-gateway test -- -t "policy promotion"
```

## Policy lifecycle timeline
Purpose: surface a deterministic, derived lifecycle state and ordered policy events. Inputs are a policy hash plus stored simulations, guardrail checks, approvals, promotions, and the active policy pointer. Outputs are a `{ state, events[] }` timeline payload.

Example command:
```bash
curl -s "http://localhost:3000/v1/policy/timeline?policyHash=POLICY_HASH" | jq
```

Self-check:
```bash
pnpm --filter api-gateway test -- -t "policy lifecycle timeline"
```

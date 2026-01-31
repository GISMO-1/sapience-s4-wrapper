# Policy Promotion Guardrails

Purpose: evaluate deterministic promotion guardrails for candidate policies. Inputs are candidate/current policy snapshots plus replay/outcome context; outputs are a decision with ordered reasons and a metrics snapshot.

## Semantics
- **Blast radius** and **impacted intents** are computed from the policy impact simulation window.
- **Health state** is derived from drift/quality metrics and must meet the minimum configured state.
- **Quality score** is computed as `100 - qualityScore` (lower is better) to represent deviation from perfect quality; it is compared against the configured maximum.
- **Severity delta** is derived from the most recent replay results for the candidate policy hash.
- Reasons are returned in deterministic order and numeric summaries are rounded to 4 decimals.

## Example
Use `evaluatePromotionGuardrails` with in-memory stores in a test:

```ts
const decision = await evaluatePromotionGuardrails({
  policyHash: "candidate-hash",
  candidatePolicy,
  currentPolicy,
  outcomeStore,
  replayStore,
  lineageStore,
  config,
  executionMode: "manual"
});
```

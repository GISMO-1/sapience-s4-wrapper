# Policy Rollback & Reconciliation

## Purpose
Provide deterministic rollback decisions, lifecycle rollback events, and semantic policy reconciliation between two policy hashes or time windows. The module normalizes policy data, produces stable hashes, and captures rollback events for provenance/timeline reporting.

## Inputs & Outputs
- **Rollback**: accepts `RollbackRequest` (target policy hash, actor, rationale, optional dry-run) and returns a deterministic `RollbackDecision` plus an optional `RollbackEvent` when executed.
- **Reconcile**: accepts policy hashes (or a time window resolved to hashes) and returns a `ReconcileReport` describing semantic diffs (added/removed/modified rules) with a deterministic `reportHash`.

## Example
```bash
curl -s -X POST http://localhost:3000/v1/policy/rollback \
  -H 'content-type: application/json' \
  -d '{"targetPolicyHash":"POLICY_HASH","actor":"analyst","rationale":"Rollback after regression","dryRun":true}' | jq
```

```bash
curl -s "http://localhost:3000/v1/policy/reconcile?fromPolicyHash=HASH_A&toPolicyHash=HASH_B" | jq
```

## Self-check
Run the API gateway rollback/reconcile tests:
```bash
pnpm --filter api-gateway test -- policy-rollback
```

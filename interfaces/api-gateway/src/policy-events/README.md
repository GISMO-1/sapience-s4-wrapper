# Policy Events

## Purpose
The policy-events module defines the canonical, hashable event model for governance actions and projects existing data stores into a deterministic, ordered event log. It ensures the policy governance state can be replayed and verified without relying on mutable live state.

## Inputs / Outputs
- **Inputs:**
  - `policyHash` plus optional `since`/`until` windows.
  - Existing stores (replay runs/results, outcomes, guardrail checks, approvals, lineage).
- **Outputs:**
  - An ordered list of `PolicyEvent` records with stable hashes.

## Example
```bash
pnpm --filter api-gateway test -- policy-events.projector.test.ts
```

## Self-check
```bash
pnpm --filter api-gateway test -- policy-events.projector.test.ts
```

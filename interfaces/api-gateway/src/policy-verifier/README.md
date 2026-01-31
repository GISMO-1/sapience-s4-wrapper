# Policy Verifier

## Purpose
The policy-verifier module deterministically replays the canonical policy event log to rebuild derived state and compares it to the live views served by the API gateway. It surfaces mismatches that indicate non-reproducible governance state.

## Inputs / Outputs
- **Inputs:**
  - Canonical policy events for a policy hash.
  - Optional drift/quality windows.
- **Outputs:**
  - Verification result with `verified`, mismatches, event counts, and window details.

## Example
```bash
pnpm --filter api-gateway test -- policy-verify.api.test.ts
```

## Self-check
```bash
pnpm --filter api-gateway test -- policy-verifier.replay.test.ts
```

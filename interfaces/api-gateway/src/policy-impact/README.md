# Policy Impact Simulation

## Purpose
The policy impact module runs a deterministic, read-only simulation that compares a candidate policy against the currently active policy over historical intents. It produces a single **Policy Impact Report** used for safe promotion decisions, including a blast radius score and per-intent classifications.

## Inputs & Outputs
- **Inputs**:
  - `currentPolicy`: Snapshot of the currently active policy.
  - `candidatePolicy`: Snapshot of the candidate policy (inline or file-based).
  - `intents`: Historical intents (from the replay store baseline intents list).
  - `window`: `{ since, until }` time range for the historical intents.
  - `executionMode`: Policy execution mode for evaluation (e.g., `manual`, `simulate`).
- **Output**:
  - `PolicyImpactReport` with:
    - `policyHashCurrent`, `policyHashCandidate`
    - `window` time range
    - `totals` (counts for newly blocked/allowed, approvals escalated, severity increases)
    - `blastRadiusScore` (0–100 deterministic formula)
    - `rows` (per-intent comparisons and classifications)

## Blast Radius Semantics
The blast radius score is a deterministic sum with a hard clamp between 0 and 100:
- **newly blocked** intents: +5 each
- **approval escalations**: +3 each
- **severity increases**: +2 each
- **newly allowed** intents: +1 each

Severity is derived from the policy decision (`ALLOW` = 0, `WARN` = 1, `DENY` = 2) to keep the comparison explainable and deterministic.

## Demo Flow
1. **Simulate** the candidate policy over historical intents.
2. **Inspect** the blast radius score, summary counts, and impacted intents.
3. **Decide** whether the policy is safe to promote.

## Example Command
```bash
curl -s -X POST http://localhost:3000/v1/policy/impact \
  -H 'content-type: application/json' \
  -d '{
    "candidatePolicy": "version: \"v1\"\n...",
    "since": "2024-02-01T00:00:00Z",
    "until": "2024-02-07T00:00:00Z",
    "limit": 100
  }'
```

## Self-check
```bash
pnpm --filter api-gateway test -- policy-impact.compute.test.ts
```

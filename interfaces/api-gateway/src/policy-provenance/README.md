# Policy Provenance

## Purpose
The policy-provenance module assembles a deterministic, read-only governance snapshot that captures policy metadata, lifecycle history, guardrail checks, approvals, drift analysis, impact simulation summary, and determinism verification into a single immutable report suitable for audit and compliance review.

## Inputs/Outputs
- **Inputs:** policy hash, active policy hash, and existing policy stores (lifecycle, lineage, replay, guardrails, approvals, outcomes). Optional policy metadata from the active snapshot can be supplied to enrich the report.
- **Output:** a `PolicyProvenanceReport` containing ordered lifecycle events, normalized metrics (4-decimal rounding), and a `reportHash` computed from canonical JSON.

## Example command
```bash
curl -s "http://localhost:3000/v1/policy/provenance?policyHash=<POLICY_HASH>" | jq
```

## Self-check
Run the provenance unit tests to validate deterministic assembly and hash stability:
```bash
pnpm --filter api-gateway test -- policy-provenance.build
```

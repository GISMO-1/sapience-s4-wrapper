# Policy-as-Code (YAML)

This directory contains declarative policy files for the API gateway. Policies are versioned, validated with a strict schema, and loaded at runtime.

## File layout

- `policies.v1.yaml`: primary policy file loaded by the gateway.

## Policy format

```yaml
version: "v1"
defaults:
  confidenceThreshold: 0.6
  execution:
    autoRequires: ["WARN"]
rules:
  - id: "blocked-sku"
    enabled: true
    priority: 80
    appliesTo:
      intentTypes: ["CREATE_PO", "CHECK_INVENTORY"]
    constraints:
      - type: "SKU_BLOCKLIST"
        params:
          skus: ["BLOCKED-SKU-1"]
    decision: "DENY"
    reason: "SKU is on the blocklist."
    tags: ["ops", "compliance"]
```

## Evaluation order & deterministic resolution

1. Only `enabled: true` rules are evaluated.
2. Rules are sorted by `priority` (descending), then `id` (ascending).
3. A rule matches only when **all** of its constraints match.
4. Final decision resolution:
   - If any matched rule is `DENY` → final decision is `DENY`.
   - Else if any matched rule is `WARN` → final decision is `WARN`.
   - Else → `ALLOW`.

The defaults block is applied before rule evaluation:
- `confidenceThreshold` denies intents with a confidence lower than the threshold.
- If execution mode is `auto` and risk is `high`, the decision becomes `WARN` or `DENY` depending on `defaults.execution.autoRequires`.

## Required approvals

Policy evaluation emits a deterministic `requiredApprovals` list based on matched rule tags and execution defaults. The gateway maps tags to approval roles as follows:

- `finance` → `FINANCE_REVIEWER`
- `compliance` → `COMPLIANCE_REVIEWER`
- `ops` → `OPS_REVIEWER`
- `safety` → `SAFETY_REVIEWER`
- `defaults` → `POLICY_REVIEWER`
- `dev` → `DEV_REVIEWER`
- `simulation` → `SIMULATION_REVIEWER`

If execution mode is `auto` and the final decision is `WARN`, the gateway adds `AUTO_EXECUTION_REVIEWER` when `defaults.execution.autoRequires` contains `WARN` or `ALLOW_ONLY`.

Each required approval includes the matched rule reason to keep decisions deterministic and audit-friendly.

## Constraint examples

### CONFIDENCE_MIN
```yaml
- type: "CONFIDENCE_MIN"
  params:
    min: 0.5
```
Matches when the intent confidence is **below** the minimum.

### MAX_AMOUNT
```yaml
- type: "MAX_AMOUNT"
  params:
    max: 50000
```
Matches when the intent `entities.amount` exceeds the maximum.

### SKU_BLOCKLIST
```yaml
- type: "SKU_BLOCKLIST"
  params:
    skus: ["BLOCKED-SKU-1", "BLOCKED-SKU-2"]
```
Matches when the intent `entities.sku` is in the list.

### VENDOR_BLOCKLIST
```yaml
- type: "VENDOR_BLOCKLIST"
  params:
    vendors: ["VENDOR-RED", "VENDOR-ORANGE"]
```
Matches when the intent `entities.vendor` is in the list.

### EXECUTION_MODE
```yaml
- type: "EXECUTION_MODE"
  params:
    mode: "simulate"
```
Matches when the gateway execution mode matches the specified value.

### RATE_LIMIT
```yaml
- type: "RATE_LIMIT"
  params:
    windowSeconds: 60
    max: 3
```
Matches when the in-memory rate limiter exceeds the limit for the key (intent type + SKU/vendor).

## Risk model (gateway)

- `CREATE_PO` with quantity > 1000 → risk `medium`.
- `CREATE_PO` with quantity > 5000 → risk `high`.
- Missing vendor on `CREATE_PO` adds a warning signal.

Risk signals and categories are included in policy explain responses.

## Reloading policies

Policies are reloaded in two ways:

- `SIGHUP` (best-effort).
- `POST /v1/policy/reload` (only if `POLICY_RELOAD_ENABLED=true`).

## Policy replay (decision-only)

The gateway can replay stored intents against a candidate policy to compare baseline decisions with re-evaluated outcomes. Replay runs are persisted for traceability, along with per-intent diffs and matched rules.

Example: replay with the current loaded policy:
```bash
curl -s -X POST http://localhost:3000/v1/policy/replay \\
  -H 'content-type: application/json' \\
  -d '{"candidatePolicy":{"source":"current"},"filters":{"limit":50}}' | jq
```

Example: fetch the replay impact report for a run:
```bash
curl -s http://localhost:3000/v1/policy/replay/RUN_ID/report | jq
```

Example: replay with an inline policy (requires `POLICY_INLINE_ENABLED=true`):
```bash
POLICY_INLINE_ENABLED=true curl -s -X POST http://localhost:3000/v1/policy/replay \\
  -H 'content-type: application/json' \\
  -d '{"candidatePolicy":{"source":"inline","yaml":"version: \"v1\"\\ndefaults:\\n  confidenceThreshold: 0.7\\n  execution:\\n    autoRequires: [\"WARN\"]\\nrules: []\\n"}}' | jq
```

## Policy lineage & promotion rationale

Policy promotions now require a promotion rationale (minimum 10 characters) and an accepted risk score. Each promotion records a lineage entry linking the new policy hash to its parent, including a drift summary (constraints added/removed, severity delta, and net risk score change).

Example: promote with rationale metadata:
```bash
curl -s -X POST http://localhost:3000/v1/policy/promote \\
  -H 'content-type: application/json' \\
  -d '{\"runId\":\"RUN_ID\",\"approvedBy\":\"Reviewer\",\"rationale\":\"Regression results match baseline.\",\"acceptedRiskScore\":12}' | jq
```

Example: fetch the current lineage chain:
```bash
curl -s http://localhost:3000/v1/policy/lineage/current | jq
```

## Outcome feedback loop

Real-world outcomes can be recorded against a trace ID to build an outcome-weighted quality signal for policies. Outcomes must reference an existing intent + policy decision. Severity ranges from 1 (low) to 5 (high).

Example: record an outcome:
```bash
curl -s -X POST http://localhost:3000/v1/policy/outcomes \
  -H 'content-type: application/json' \
  -d '{"traceId":"TRACE_ID","outcomeType":"failure","severity":3,"notes":"Synthetic follow-up"}' | jq
```

Example: fetch quality metrics for a policy hash:
```bash
curl -s "http://localhost:3000/v1/policy/quality?policyHash=POLICY_HASH" | jq
```

Quality score notes (window-scoped): failures are weighted 3× severity, rollbacks 2×, overrides 1×, and successes 0×. The weighted penalty is normalized against the maximum possible penalty (severity 5, weight 3) to produce a 0–100 score.

## Drift health signals

The gateway exposes deterministic drift health signals that compare a recent 7-day window to a 30-day baseline. The drift report aggregates outcome quality, replay diff counts, and (if present) lineage drift summaries.

Health thresholds:
- **WATCH**: failure rate delta ≥ 0.05, override rate delta ≥ 0.05, or replay delta ≥ 10.
- **DEGRADED**: quality score < 80, failure rate > 0.10, override rate > 0.10, or replay delta ≥ 25.
- **CRITICAL**: quality score < 60, failure rate > 0.20, override rate > 0.20, or replay delta ≥ 50.

Example: fetch drift health for a policy hash:
```bash
curl -s "http://localhost:3000/v1/policy/drift?policyHash=POLICY_HASH" | jq
```

## Safe fallback

If policy loading fails and no cached policy exists, the gateway uses a safe fallback:
- `WARN` for manual/simulate execution.
- `DENY` for auto execution.

## Tool reference

Purpose: Define, validate, and reload policy rules for deterministic gateway decisions. Inputs are the YAML policy files; outputs are deterministic policy decisions, explain responses, and stored decision records.

Example command:
```bash
curl -s -X POST http://localhost:3000/v1/policy/reload | jq
```

Self-check:
```bash
curl -s http://localhost:3000/v1/policy/explain/TRACE_ID | jq
```

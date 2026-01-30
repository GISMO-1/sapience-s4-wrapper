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

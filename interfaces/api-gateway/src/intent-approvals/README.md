# Intent approvals store

## Purpose
Provide a durable audit trail for intent execution approvals, keyed by trace ID and policy decision metadata.

## Inputs/Outputs
- Inputs: `IntentApprovalInput` (trace ID, intent ID, policy hash, decision ID, required role, actor, rationale).
- Outputs: `IntentApprovalRecord` entries for persistence and retrieval.

## Example
```bash
pnpm -C interfaces/api-gateway exec tsx -e "import { InMemoryIntentApprovalStore } from './src/intent-approvals/store.js'; const store = new InMemoryIntentApprovalStore(); await store.recordApproval({ traceId: 'trace-1', intentId: 'intent-1', policyHash: 'hash', decisionId: 'decision-1', requiredRole: 'FINANCE_REVIEWER', actor: 'local-user', rationale: 'Reviewed manually.' }); console.log(await store.listApprovalsByTraceId('trace-1'));"
```

## Self-check
```bash
pnpm -C interfaces/api-gateway exec tsx -e "import { InMemoryIntentApprovalStore } from './src/intent-approvals/store.js'; const store = new InMemoryIntentApprovalStore(); const record = await store.recordApproval({ traceId: 'trace-2', intentId: 'intent-2', policyHash: 'hash', decisionId: 'decision-2', requiredRole: 'COMPLIANCE_REVIEWER', actor: 'local-user', rationale: 'Checked.' }); console.log(record.requiredRole);"
```

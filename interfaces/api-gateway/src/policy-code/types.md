# Policy types

Purpose: Provide shared TypeScript types for policy documents, decisions, matches, and risk assessment. Inputs are policy and intent data; outputs are strongly typed structures used across the policy pipeline.

Example command:
```bash
pnpm --filter api-gateway typecheck
```

Self-check:
```bash
pnpm --filter api-gateway test -- --runInBand policy
```

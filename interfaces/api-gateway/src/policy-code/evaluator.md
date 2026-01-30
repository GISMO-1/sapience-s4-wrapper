# Policy evaluator

Purpose: Evaluate intents against YAML policy rules, compute risk, apply deterministic rule ordering, and produce explainable decisions. Inputs are intents and execution context; outputs are policy decisions and risk assessments.

Example command:
```bash
pnpm --filter api-gateway test -- --runInBand policy
```

Self-check:
```bash
pnpm --filter api-gateway test -- --runInBand policy
```

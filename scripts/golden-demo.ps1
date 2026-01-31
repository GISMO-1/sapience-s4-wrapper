<#!
README
Purpose: Generate a deterministic golden demo snapshot using the API gateway in-process Fastify app.
Inputs: Optional flags passed to the TypeScript script (--self-check, --help).
Outputs: artifacts/golden-demo.json and artifacts/golden-demo.md in the repo root.

Example:
  ./scripts/golden-demo.ps1

Self-check:
  ./scripts/golden-demo.ps1 --self-check
!#>

pnpm -C interfaces/api-gateway exec tsx ../../scripts/golden-demo.ts @args

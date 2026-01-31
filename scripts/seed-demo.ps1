$ErrorActionPreference = "Stop"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm is required to run the demo seed script."
  exit 1
}

if (-not $env:API_BASE) {
  $env:API_BASE = "http://localhost:8080"
}

pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts @args

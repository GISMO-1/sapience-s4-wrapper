#!/usr/bin/env bash
set -euo pipefail

API_BASE=${API_BASE:-http://localhost:8080}
PNPM_BIN=${PNPM_BIN:-pnpm}

if ! command -v "$PNPM_BIN" >/dev/null 2>&1; then
  echo "pnpm is required to run the demo seed script." >&2
  exit 1
fi

API_BASE="$API_BASE" "$PNPM_BIN" -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts "$@"

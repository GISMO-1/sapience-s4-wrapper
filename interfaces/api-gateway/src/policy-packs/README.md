# Policy Pack Registry

## Purpose
Provides deterministic policy pack discovery, hashing, and install-as-candidate workflows for the API gateway.
Policy packs live under `policies/packs/<packName>/` and include `pack.json`, `policy.yaml`, optional `notes.md`,
and optional `signature.json`.

## Inputs/Outputs
- **Inputs**: policy pack directories, policy YAML, and optional signing key (`POLICY_PACK_SIGNING_KEY`).
- **Outputs**: deterministic hashes (`policyHash`, `packHash`), optional HMAC signatures, pack summaries,
  and promotion-ready install bundles (impact, drift, guardrail reports).

## Example
```bash
# List packs
curl http://localhost:3000/v1/policy/packs

# Download deterministic JSON
curl http://localhost:3000/v1/policy/packs/example-pack/download?format=json

# Install as candidate
curl -X POST http://localhost:3000/v1/policy/packs/example-pack/install
```

## Self-check
```bash
pnpm --filter api-gateway test -- policy-packs
```

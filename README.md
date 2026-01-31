# Sapience – cloud-native AI wrapper for SAP S/4HANA

[![CI](https://github.com/GISMO-1/sapience-s4-wrapper/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/GISMO-1/sapience-s4-wrapper/actions/workflows/ci.yml)
![License](https://img.shields.io/github/license/GISMO-1/sapience-s4-wrapper)
![Node](https://img.shields.io/badge/node-20.x-green)
![Python](https://img.shields.io/badge/python-3.11-blue)
![Docker](https://img.shields.io/badge/docker-ready-blue)
![Architecture](https://img.shields.io/badge/architecture-event--driven-orange)
![Status](https://img.shields.io/badge/status-active%20development-yellow)

Sapience is a cloud-native wrapper that provides intent-driven APIs and event-driven microservices for SAP S/4HANA. It offers a stable, boringly reliable stack with observability, local dev tooling, and a web portal to validate intent routing quickly.

## Architecture summary
Sapience is composed of domain services (procurement, supply chain, finance), an integration service that would eventually talk to SAP, an orchestration service that coordinates sagas, an API gateway, and an AI assistant service. Services communicate using Kafka-compatible events with a shared envelope. Each service owns its data in Postgres and exposes minimal REST APIs.

## Quickstart
Local (no Docker):
```bash
pnpm install
pnpm -r build
pnpm -r test
```

Docker (compose):
```bash
docker compose -f infra/docker-compose.yaml up --build
```

URLs/ports:
- API gateway: http://localhost:8080/health
- Web portal: http://localhost:5173

60-second demo flow:
1. Send an intent.
2. Run a replay.
3. View the replay report.
4. Record an outcome.
5. View policy quality.
6. View policy lineage.

### Demo seed script
Purpose: seed sample intents, run a replay, record outcomes, and fetch quality/lineage data. Inputs: `API_BASE` (defaults to `http://localhost:8080`). Outputs: printed IDs and URLs.

Example command:
```bash
pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts
```

Self-check:
```bash
API_BASE=http://localhost:8080 pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts --self-check
```

## Makefile shortcuts
Purpose: provide consistent local dev commands for containers and tests. Inputs are local Docker and pnpm configuration; outputs are running containers, logs, or test results.

Example command:
```bash
make up
```

Self-check:
```bash
make test
```

## Endpoints and example curl commands
### API gateway intent routing
```bash
curl -s -X POST http://localhost:8080/v1/intent \
  -H 'content-type: application/json' \
  -d '{"text":"create a PO for laptops"}' | jq
```

### AI assist planner (gateway passthrough)
```bash
curl -s -X POST http://localhost:8080/v1/assist \
  -H 'content-type: application/json' \
  -d '{"text":"review invoice INV-2024"}' | jq
```

To execute the first tool call via the gateway, set `EXECUTE_TOOL_CALLS=true` for the API gateway container.

### Procurement: request a purchase order
```bash
curl -s -X POST http://localhost:3001/v1/purchase-orders/request \
  -H 'content-type: application/json' \
  -d '{"sku":"LAPTOP-15","quantity":10}' | jq
```

### Supply chain: inventory lookup
```bash
curl -s http://localhost:3002/v1/inventory/LAPTOP-15 | jq
```

### Finance: invoice review request
```bash
curl -s -X POST http://localhost:3003/v1/invoices/review-request \
  -H 'content-type: application/json' \
  -d '{"invoiceId":"INV-1001","amount":5000}' | jq
```

### Integration: read cached PO
```bash
curl -s http://localhost:3004/v1/sap/purchase-orders/PO-1001 | jq
```

## Policy-as-Code
The API gateway loads policy rules from `policies/policies.v1.yaml` and enforces deterministic, explainable decisions. The `/v1/policy/explain/:traceId` endpoint returns the policy hash alongside the decision, matched rules, and risk signals. To reload policies locally, set `POLICY_RELOAD_ENABLED=true` and call:

```bash
curl -s -X POST http://localhost:8080/v1/policy/reload | jq
```

Policy replay now includes an executive-ready impact report plus a minimal sandbox UI in the web portal. Promotion guardrails score replay impact and enforce blast-radius thresholds before activating new policies. Use the replay and promotion endpoints to compare baseline vs. candidate decisions:
- `POST /v1/policy/replay` to execute a replay run.
- `GET /v1/policy/replay/:runId/report` to fetch totals, deltas, and top changes.
- `POST /v1/policy/promote` to approve and activate a simulated policy.
- `GET /v1/policy/status` to inspect policy lifecycle status and approvals.
- `GET /v1/policy/current` to inspect the loaded policy snapshot.
- `GET /v1/policy/lineage/current` to view the active policy lineage chain.
- `GET /v1/policy/lineage/:policyHash` to view lineage for a specific policy hash.

Outcome feedback loop endpoints capture real-world results and compute outcome-weighted policy quality signals:
- `POST /v1/policy/outcomes` to record a success/failure/override/rollback outcome for a trace ID.
- `GET /v1/policy/outcomes/:traceId` to inspect outcomes tied to a trace.
- `GET /v1/policy/quality?policyHash=...` to compute windowed quality metrics for a policy hash.

## Why lineage matters
Policy lineage provides a clear audit trail for how guardrails evolve. By capturing parent relationships, rationale, accepted risk scores, and drift summaries on every promotion, teams can explain why a policy changed and quantify the blast radius before it reaches production.

## Event flow (short)
1. Domain services publish intent events (ex: `sapience.procurement.po.requested`).
2. The integration service receives intent events, calls the SAP adapter (currently fake), and publishes completion events (ex: `sapience.integration.po.created`).
3. Domain services consume completion events to update their local projections.
4. Orchestration service listens for low-stock events and triggers a procurement saga.

## Repo layout
- `services/`: microservices (Node.js + Fastify + TypeScript) and AI service (FastAPI).
- `interfaces/`: API gateway and web portal.
- `infra/`: docker-compose, Kubernetes and DevOps notes.
- `docs/`: architecture and domain documentation.
- `.github/workflows`: CI pipeline.

## Next steps for real SAP connectivity
- Implement OData client for read-heavy flows.
- Add BAPI connector for transactional workflows.
- Support IDoc ingestion for asynchronous updates.
- Replace the fake SAP adapter in `integration-service` with real adapters.

For more details, see the docs in `docs/`.

# Sapience – cloud-native AI wrapper for SAP S/4HANA

Sapience is a cloud-native wrapper that provides intent-driven APIs and event-driven microservices for SAP S/4HANA. It offers a stable, boringly reliable stack with observability, local dev tooling, and a web portal to validate intent routing quickly.

## Architecture summary
Sapience is composed of domain services (procurement, supply chain, finance), an integration service that would eventually talk to SAP, an orchestration service that coordinates sagas, an API gateway, and an AI assistant service. Services communicate using Kafka-compatible events with a shared envelope. Each service owns its data in Postgres and exposes minimal REST APIs.

## Quickstart
```bash
cp .env.example .env
cd infra
docker-compose up --build
```

Once running:
- Web portal: http://localhost:5173
- API gateway: http://localhost:3000/health

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
curl -s -X POST http://localhost:3000/v1/intent \
  -H 'content-type: application/json' \
  -d '{"text":"create a PO for laptops"}' | jq
```

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

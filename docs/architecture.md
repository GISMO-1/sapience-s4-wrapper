# Architecture

Sapience uses a modular microservice layout with event-driven messaging. Each service owns its data and exposes REST endpoints. The integration service acts as the future SAP adapter boundary, ensuring all writes are SAP-safe.

## Services
- Integration: SAP adapter boundary, publishes completion events.
- Procurement: purchase order intents.
- Supply Chain: inventory and low-stock detection.
- Finance: invoice review intents and accrual projections.
- Orchestration: saga coordination.
- API Gateway: intent routing and API proxying.
- AI Service: deterministic assistant to produce tool calls.

## Observability
OpenTelemetry-compatible trace IDs flow through logs and the event envelope. Health endpoints are exposed for liveness and readiness checks.

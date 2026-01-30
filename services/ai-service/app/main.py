from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import settings
from .explain import build_explanation, fetch_intent, fetch_saga_events
from .health import build_health_payload
from .readiness import check_readiness

app = FastAPI(title="Sapience AI Service")


class AssistRequest(BaseModel):
    text: str


class ToolCall(BaseModel):
    endpoint: str
    payload: dict[str, Any]


class PlanStep(BaseModel):
    description: str
    action: str
    payload: dict[str, Any]


class AssistResponse(BaseModel):
    plan: str
    steps: list[PlanStep]
    tool_calls: list[ToolCall]


def build_tool_calls(text: str) -> AssistResponse:
    lowered = text.lower()
    # Future LLM hook: replace deterministic rules with model-driven intent extraction.
    if "inventory" in lowered or "stock" in lowered:
        return AssistResponse(
            plan="Lookup inventory in supply chain service",
            steps=[
                PlanStep(
                    description="Check current inventory levels for the requested SKU.",
                    action="CHECK_INVENTORY",
                    payload={"text": text},
                )
            ],
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    if "invoice" in lowered:
        return AssistResponse(
            plan="Request invoice review in finance service",
            steps=[
                PlanStep(
                    description="Submit an invoice review request with the provided details.",
                    action="REVIEW_INVOICE",
                    payload={"text": text},
                )
            ],
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    if "order" in lowered or "po" in lowered:
        return AssistResponse(
            plan="Create purchase order through procurement service",
            steps=[
                PlanStep(
                    description="Prepare a purchase order request based on the provided text.",
                    action="CREATE_PO",
                    payload={"text": text},
                )
            ],
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    return AssistResponse(
        plan="No matching intent found; route to intent endpoint",
        steps=[
            PlanStep(
                description="Route the text to the intent endpoint for manual triage.",
                action="CHECK_INVENTORY",
                payload={"text": text},
            )
        ],
        tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return build_health_payload(settings.service_name)


@app.get("/ready")
async def ready() -> dict[str, str]:
    try:
        await check_readiness(settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ready", "service": settings.service_name}


@app.post("/v1/assist", response_model=AssistResponse)
async def assist(payload: AssistRequest) -> AssistResponse:
    return build_tool_calls(payload.text)


@app.get("/v1/explain/{trace_id}")
async def explain(trace_id: str) -> dict[str, Any]:
    intent = await fetch_intent(settings, trace_id)
    saga_events = await fetch_saga_events(settings, trace_id)
    payload = build_explanation(intent, saga_events)
    return {"traceId": trace_id, **payload}

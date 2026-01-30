from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

from .config import settings
from .explain import build_explain_response
from .health import build_health_payload
from .http_clients import fetch_intent, fetch_saga_events
from .readiness import check_readiness
from .trace import get_trace_id, set_trace_id

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
    if "inventory" in lowered or "stock" in lowered:
        return AssistResponse(
            plan="Lookup inventory in supply chain service",
            steps=[
                PlanStep(
                    description="Identify inventory lookup intent",
                    action="parse_intent",
                    payload={"text": text},
                ),
                PlanStep(
                    description="Request inventory check via gateway",
                    action="call_gateway_intent",
                    payload={"text": text},
                ),
            ],
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    if "invoice" in lowered:
        return AssistResponse(
            plan="Request invoice review in finance service",
            steps=[
                PlanStep(
                    description="Identify invoice review intent",
                    action="parse_intent",
                    payload={"text": text},
                ),
                PlanStep(
                    description="Request invoice review via gateway",
                    action="call_gateway_intent",
                    payload={"text": text},
                ),
            ],
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    if "order" in lowered or "po" in lowered:
        return AssistResponse(
            plan="Create purchase order through procurement service",
            steps=[
                PlanStep(
                    description="Identify purchase order intent",
                    action="parse_intent",
                    payload={"text": text},
                ),
                PlanStep(
                    description="Request purchase order via gateway",
                    action="call_gateway_intent",
                    payload={"text": text},
                ),
            ],
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    return AssistResponse(
        plan="No matching intent found; route to intent endpoint",
        steps=[
            PlanStep(
                description="Fallback to gateway intent route",
                action="call_gateway_intent",
                payload={"text": text},
            )
        ],
        tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
    )


@app.get("/health")
async def health(request: Request, response: Response) -> dict[str, str]:
    trace_id = get_trace_id(request)
    set_trace_id(response, trace_id)
    return build_health_payload(settings.service_name)


@app.get("/ready")
async def ready() -> dict[str, str]:
    try:
        await check_readiness(settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ready", "service": settings.service_name}


@app.post("/v1/assist", response_model=AssistResponse)
async def assist(payload: AssistRequest, request: Request, response: Response) -> AssistResponse:
    trace_id = get_trace_id(request)
    set_trace_id(response, trace_id)
    return build_tool_calls(payload.text)


@app.get("/v1/explain/{trace_id}")
async def explain(trace_id: str, request: Request, response: Response) -> dict[str, Any]:
    trace_header = get_trace_id(request)
    set_trace_id(response, trace_header)
    intent_payload = await fetch_intent(trace_id, trace_header)
    saga_payload = await fetch_saga_events(trace_id, trace_header)
    return build_explain_response(trace_id, intent_payload, saga_payload)

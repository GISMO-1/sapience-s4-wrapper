from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import settings
from .health import build_health_payload
from .readiness import check_readiness

app = FastAPI(title="Sapience AI Service")


class AssistRequest(BaseModel):
    text: str


class ToolCall(BaseModel):
    endpoint: str
    payload: dict[str, Any]


class AssistResponse(BaseModel):
    plan: str
    tool_calls: list[ToolCall]


def build_tool_calls(text: str) -> AssistResponse:
    lowered = text.lower()
    if "inventory" in lowered or "stock" in lowered:
        return AssistResponse(
            plan="Lookup inventory in supply chain service",
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    if "invoice" in lowered:
        return AssistResponse(
            plan="Request invoice review in finance service",
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    if "order" in lowered or "po" in lowered:
        return AssistResponse(
            plan="Create purchase order through procurement service",
            tool_calls=[ToolCall(endpoint="/v1/intent", payload={"text": text})],
        )
    return AssistResponse(
        plan="No matching intent found; route to intent endpoint",
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

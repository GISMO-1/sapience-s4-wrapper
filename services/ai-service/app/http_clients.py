from __future__ import annotations

from typing import Any

import httpx

from .config import settings


async def fetch_intent(trace_id: str, trace_header: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            f"{settings.api_gateway_url}/v1/intents/{trace_id}",
            headers={"x-trace-id": trace_header},
        )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


async def fetch_saga_events(trace_id: str, trace_header: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            f"{settings.orchestration_url}/v1/sagas/{trace_id}",
            headers={"x-trace-id": trace_header},
        )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()

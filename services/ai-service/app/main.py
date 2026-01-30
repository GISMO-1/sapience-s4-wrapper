from __future__ import annotations

import os
from typing import Any

import asyncpg
from aiokafka import AIOKafkaAdminClient
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Sapience AI Service")


class AssistRequest(BaseModel):
    text: str


class ToolCall(BaseModel):
    tool: str
    input: dict[str, Any]


class AssistResponse(BaseModel):
    plan: str
    tool_calls: list[ToolCall]


def build_tool_calls(text: str) -> AssistResponse:
    lowered = text.lower()
    if "inventory" in lowered or "stock" in lowered:
        return AssistResponse(
            plan="Lookup inventory in supply chain service",
            tool_calls=[ToolCall(tool="intent", input={"text": text})],
        )
    if "invoice" in lowered:
        return AssistResponse(
            plan="Request invoice review in finance service",
            tool_calls=[ToolCall(tool="intent", input={"text": text})],
        )
    if "order" in lowered or "po" in lowered:
        return AssistResponse(
            plan="Create purchase order through procurement service",
            tool_calls=[ToolCall(tool="intent", input={"text": text})],
        )
    return AssistResponse(
        plan="No matching intent found; route to intent endpoint",
        tool_calls=[ToolCall(tool="intent", input={"text": text})],
    )


async def check_postgres() -> None:
    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        user=os.getenv("DB_USER", "sapience"),
        password=os.getenv("DB_PASSWORD", "sapience"),
        database=os.getenv("DB_NAME", "ai"),
    )
    await conn.execute("SELECT 1")
    await conn.close()


async def check_kafka() -> None:
    brokers = os.getenv("BROKER_BROKERS", "localhost:9092")
    admin = AIOKafkaAdminClient(bootstrap_servers=brokers)
    await admin.start()
    await admin.list_topics()
    await admin.close()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    try:
        await check_postgres()
        await check_kafka()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ready"}


@app.post("/v1/assist", response_model=AssistResponse)
async def assist(payload: AssistRequest) -> AssistResponse:
    return build_tool_calls(payload.text)

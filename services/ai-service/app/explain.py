from __future__ import annotations

from typing import Any

import asyncpg

from .config import Settings


async def fetch_intent(settings: Settings, trace_id: str) -> dict[str, Any] | None:
    conn = await asyncpg.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.gateway_db_name,
    )
    row = await conn.fetchrow(
        "SELECT intent_type, raw_text, parsed_json, created_at FROM intents WHERE trace_id = $1 ORDER BY created_at DESC LIMIT 1",
        trace_id,
    )
    await conn.close()
    if not row:
        return None
    return {
        "intentType": row["intent_type"],
        "rawText": row["raw_text"],
        "parsed": row["parsed_json"],
        "createdAt": row["created_at"].isoformat(),
    }


async def fetch_saga_events(settings: Settings, trace_id: str) -> list[dict[str, Any]]:
    conn = await asyncpg.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.orchestration_db_name,
    )
    rows = await conn.fetch(
        "SELECT state, event_type, payload, created_at FROM saga_events WHERE trace_id = $1 ORDER BY created_at ASC",
        trace_id,
    )
    await conn.close()
    return [
        {
            "state": row["state"],
            "eventType": row["event_type"],
            "payload": row["payload"],
            "timestamp": row["created_at"].isoformat(),
        }
        for row in rows
    ]


def build_explanation(intent: dict[str, Any] | None, saga_events: list[dict[str, Any]]) -> dict[str, Any]:
    if not intent:
        return {
            "summary": "No intent record found for this trace.",
            "intent": None,
            "events": saga_events,
        }
    outcome = saga_events[-1]["state"] if saga_events else "UNKNOWN"
    return {
        "summary": f"Intent '{intent['intentType']}' executed with outcome {outcome}.",
        "intent": intent,
        "events": saga_events,
        "outcome": outcome,
    }

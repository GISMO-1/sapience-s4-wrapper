from __future__ import annotations

from typing import Any


def build_narrative(
    trace_id: str,
    intent_payload: dict[str, Any] | None,
    saga_payload: dict[str, Any] | None,
) -> str:
    intent_summary = "No intent recorded."
    if intent_payload:
        intent = intent_payload.get("intent", {})
        intent_type = intent.get("intentType", "unknown")
        confidence = intent.get("confidence")
        intent_summary = f"Intent {intent_type} detected with confidence {confidence}."

    saga_summary = "No saga events recorded."
    if saga_payload:
        events = saga_payload.get("events", [])
        saga_summary = f"{len(events)} saga event(s) recorded."

    return f"Trace {trace_id}: {intent_summary} {saga_summary}"


def build_explain_response(
    trace_id: str,
    intent_payload: dict[str, Any] | None,
    saga_payload: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "traceId": trace_id,
        "intent": intent_payload,
        "saga": saga_payload,
        "narrative": build_narrative(trace_id, intent_payload, saga_payload),
    }

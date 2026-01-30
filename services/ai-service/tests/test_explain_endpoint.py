from __future__ import annotations

from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.main import app


async def fake_fetch_intent(trace_id: str, trace_header: str) -> dict[str, object]:
    return {
        "traceId": trace_id,
        "intent": {"intentType": "CREATE_PO", "confidence": 0.9, "rawText": "Create PO"},
        "createdAt": "2024-01-01T00:00:00Z",
    }


async def fake_fetch_saga_events(trace_id: str, trace_header: str) -> dict[str, object]:
    return {
        "traceId": trace_id,
        "events": [
            {"eventType": "LOW_STOCK_DETECTED", "state": "NEW", "payload": {"sku": "SKU-1"}}
        ],
    }


def test_explain_endpoint(monkeypatch) -> None:
    monkeypatch.setattr("app.main.fetch_intent", fake_fetch_intent)
    monkeypatch.setattr("app.main.fetch_saga_events", fake_fetch_saga_events)

    client = TestClient(app)
    response = client.get("/v1/explain/trace-123")
    assert response.status_code == 200
    payload = response.json()
    assert payload["traceId"] == "trace-123"
    assert "narrative" in payload

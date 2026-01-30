from pathlib import Path
import sys
from typing import Any

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main


def test_explain_endpoint(monkeypatch: Any) -> None:
    async def fake_fetch_intent(_settings: Any, _trace_id: str) -> dict[str, Any]:
        return {
            "intentType": "CHECK_INVENTORY",
            "rawText": "check stock SKU123",
            "parsed": {"intentType": "CHECK_INVENTORY"},
            "createdAt": "2024-01-01T00:00:00Z",
        }

    async def fake_fetch_saga_events(_settings: Any, _trace_id: str) -> list[dict[str, Any]]:
        return [{"state": "COMPLETED", "eventType": "sapience.integration.po.created", "payload": {}, "timestamp": "t1"}]

    monkeypatch.setattr(main, "fetch_intent", fake_fetch_intent)
    monkeypatch.setattr(main, "fetch_saga_events", fake_fetch_saga_events)

    client = TestClient(main.app)
    response = client.get("/v1/explain/trace-123")
    assert response.status_code == 200
    assert response.json()["outcome"] == "COMPLETED"

from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.explain import build_explanation


def test_build_explanation() -> None:
    intent = {
        "intentType": "CREATE_PO",
        "rawText": "low stock SKU123",
        "parsed": {"intentType": "CREATE_PO", "entities": {"sku": "SKU123"}, "confidence": 0.8},
        "createdAt": "2024-01-01T00:00:00Z",
    }
    events = [
        {"state": "REQUESTED", "eventType": "sapience.procurement.po.requested", "payload": {}, "timestamp": "t1"},
        {"state": "COMPLETED", "eventType": "sapience.integration.po.created", "payload": {}, "timestamp": "t2"},
    ]

    result = build_explanation(intent, events)
    assert result["intent"]["intentType"] == "CREATE_PO"
    assert result["outcome"] == "COMPLETED"

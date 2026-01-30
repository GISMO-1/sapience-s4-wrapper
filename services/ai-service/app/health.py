from __future__ import annotations


def build_health_payload(service_name: str) -> dict[str, str]:
    return {"status": "ok", "service": service_name}

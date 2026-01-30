from __future__ import annotations

from uuid import uuid4

from fastapi import Request, Response


def get_trace_id(request: Request) -> str:
    trace_id = request.headers.get("x-trace-id")
    return trace_id or str(uuid4())


def set_trace_id(response: Response, trace_id: str) -> None:
    response.headers["x-trace-id"] = trace_id

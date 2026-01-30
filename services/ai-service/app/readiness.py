from __future__ import annotations

from .config import Settings
from .db import check_postgres
from .kafka import check_kafka


async def check_readiness(settings: Settings) -> None:
    await check_postgres(settings)
    await check_kafka(settings)

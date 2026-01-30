from __future__ import annotations

import asyncpg

from .config import Settings


async def check_postgres(settings: Settings) -> None:
    conn = await asyncpg.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.db_name,
    )
    await conn.execute("SELECT 1")
    await conn.close()

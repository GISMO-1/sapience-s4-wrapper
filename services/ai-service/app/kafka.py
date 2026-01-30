from __future__ import annotations

from aiokafka import AIOKafkaClient

from .config import Settings


async def check_kafka(settings: Settings) -> None:
    client = AIOKafkaClient(bootstrap_servers=settings.broker_brokers)
    await client.bootstrap()
    await client.close()

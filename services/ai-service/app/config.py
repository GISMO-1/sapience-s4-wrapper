from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    broker_brokers: str
    gateway_db_name: str
    orchestration_db_name: str


def load_settings() -> Settings:
    return Settings(
        service_name=os.getenv("SERVICE_NAME", "ai-service"),
        db_host=os.getenv("DB_HOST", "localhost"),
        db_port=int(os.getenv("DB_PORT", "5432")),
        db_user=os.getenv("DB_USER", "sapience"),
        db_password=os.getenv("DB_PASSWORD", "sapience"),
        db_name=os.getenv("DB_NAME", "ai"),
        broker_brokers=os.getenv("BROKER_BROKERS", "localhost:9092"),
        gateway_db_name=os.getenv("GATEWAY_DB_NAME", "api_gateway"),
        orchestration_db_name=os.getenv("ORCHESTRATION_DB_NAME", "orchestration"),
    )


settings = load_settings()

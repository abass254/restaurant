"""Create platform AI agent (OpenAI) config table."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.database import engine  # noqa: E402


def main() -> None:
    settings = get_settings()
    env_key = settings.openai_api_key.strip()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_agent_configurations (
                    id VARCHAR(36) PRIMARY KEY,
                    api_key TEXT NOT NULL,
                    chat_model VARCHAR(120) NULL,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL
                )
                """,
            ),
        )

        has_active = conn.execute(
            text(
                "SELECT COUNT(*) FROM ai_agent_configurations WHERE is_active = 1",
            ),
        ).scalar()

        if not has_active and env_key:
            conn.execute(
                text(
                    """
                    INSERT INTO ai_agent_configurations (
                        id, api_key, chat_model, is_active, created_at, updated_at
                    ) VALUES (
                        :id, :api_key, :chat_model, 1, :now, :now
                    )
                    """,
                ),
                {
                    "id": str(uuid.uuid4()),
                    "api_key": env_key,
                    "chat_model": settings.openai_chat_model or None,
                    "now": now,
                },
            )

    print("ai_agent_configurations table is ready.")


if __name__ == "__main__":
    main()

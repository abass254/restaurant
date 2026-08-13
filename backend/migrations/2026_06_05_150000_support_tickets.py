"""Support ticket history + event timeline."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _has_table(conn, table: str) -> bool:
    return table in inspect(conn).get_table_names()


def main() -> None:
    with engine.begin() as conn:
        if not _has_table(conn, "support_tickets"):
            conn.execute(
                text(
                    """
                    CREATE TABLE support_tickets (
                        id VARCHAR(36) PRIMARY KEY,
                        instagram_account_id VARCHAR(36) NOT NULL,
                        instagram_conversation_id VARCHAR(36) NOT NULL,
                        ticket_number INTEGER NOT NULL,
                        status VARCHAR(32) NOT NULL DEFAULT 'waiting_customer',
                        resolution VARCHAR(32) NULL,
                        close_reason TEXT NULL,
                        participant_username VARCHAR(255) NULL,
                        participant_ig_id VARCHAR(255) NULL,
                        opened_at DATETIME NULL,
                        closed_at DATETIME NULL,
                        first_customer_reply_at DATETIME NULL,
                        first_agent_reply_at DATETIME NULL,
                        resolved_at DATETIME NULL,
                        resolved_by_user_id VARCHAR(36) NULL,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        UNIQUE (instagram_account_id, ticket_number),
                        FOREIGN KEY (instagram_account_id) REFERENCES instagram_accounts(id),
                        FOREIGN KEY (instagram_conversation_id) REFERENCES instagram_conversations(id),
                        FOREIGN KEY (resolved_by_user_id) REFERENCES users(id)
                    )
                    """,
                ),
            )

        if not _has_table(conn, "ticket_events"):
            conn.execute(
                text(
                    """
                    CREATE TABLE ticket_events (
                        id VARCHAR(36) PRIMARY KEY,
                        support_ticket_id VARCHAR(36) NOT NULL,
                        event_type VARCHAR(64) NOT NULL,
                        body TEXT NULL,
                        metadata_json JSON NULL,
                        actor_user_id VARCHAR(36) NULL,
                        created_at DATETIME NULL,
                        FOREIGN KEY (support_ticket_id) REFERENCES support_tickets(id),
                        FOREIGN KEY (actor_user_id) REFERENCES users(id)
                    )
                    """,
                ),
            )

        if not _has_column(conn, "instagram_conversations", "current_support_ticket_id"):
            conn.execute(
                text(
                    "ALTER TABLE instagram_conversations "
                    "ADD COLUMN current_support_ticket_id VARCHAR(36) NULL",
                ),
            )

        # Backfill one support ticket per conversation that already has ticket timestamps.
        rows = conn.execute(
            text(
                """
                SELECT c.id, c.instagram_account_id, c.participant_username,
                       c.participant_ig_id, c.ticket_status, c.ticket_opened_at,
                       c.ticket_closed_at
                FROM instagram_conversations c
                LEFT JOIN support_tickets t ON t.instagram_conversation_id = c.id
                WHERE t.id IS NULL
                  AND (c.ticket_opened_at IS NOT NULL OR c.ticket_status = 'closed')
                """,
            ),
        ).fetchall()

        for row in rows:
            conv_id, account_id, username, ig_id, ticket_status, opened_at, closed_at = row
            number_row = conn.execute(
                text(
                    """
                    SELECT COALESCE(MAX(ticket_number), 0) + 1
                    FROM support_tickets
                    WHERE instagram_account_id = :account_id
                    """,
                ),
                {"account_id": account_id},
            ).fetchone()
            ticket_number = int(number_row[0])
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            opened = opened_at or now
            is_closed = (ticket_status or "open").lower() == "closed"
            status = "closed_unresolved" if is_closed else "waiting_customer"
            resolution = "auto_timeout" if is_closed and closed_at else None
            ticket_id = str(uuid.uuid4())
            conn.execute(
                text(
                    """
                    INSERT INTO support_tickets (
                        id, instagram_account_id, instagram_conversation_id,
                        ticket_number, status, resolution, participant_username,
                        participant_ig_id, opened_at, closed_at, created_at, updated_at
                    ) VALUES (
                        :id, :account_id, :conv_id, :ticket_number, :status,
                        :resolution, :username, :ig_id, :opened_at, :closed_at,
                        :now, :now
                    )
                    """,
                ),
                {
                    "id": ticket_id,
                    "account_id": account_id,
                    "conv_id": conv_id,
                    "ticket_number": ticket_number,
                    "status": status,
                    "resolution": resolution,
                    "username": username,
                    "ig_id": ig_id,
                    "opened_at": opened,
                    "closed_at": closed_at if is_closed else None,
                    "now": now,
                },
            )
            conn.execute(
                text(
                    """
                    INSERT INTO ticket_events (
                        id, support_ticket_id, event_type, body, created_at
                    ) VALUES (:id, :ticket_id, 'ticket_opened', 'Ticket opened', :now)
                    """,
                ),
                {"id": str(uuid.uuid4()), "ticket_id": ticket_id, "now": now},
            )
            if is_closed:
                conn.execute(
                    text(
                        """
                        INSERT INTO ticket_events (
                            id, support_ticket_id, event_type, body, created_at
                        ) VALUES (
                            :id, :ticket_id, 'auto_closed',
                            'Closed due to customer inactivity', :now
                        )
                        """,
                    ),
                    {"id": str(uuid.uuid4()), "ticket_id": ticket_id, "now": closed_at or now},
                )
            conn.execute(
                text(
                    """
                    UPDATE instagram_conversations
                    SET current_support_ticket_id = :ticket_id
                    WHERE id = :conv_id
                    """,
                ),
                {"ticket_id": ticket_id, "conv_id": conv_id},
            )

    print("support_tickets, ticket_events, and backfill are ready.")


if __name__ == "__main__":
    main()

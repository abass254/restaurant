from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from app.models import InstagramAccount, SupportTicket, TicketEvent
from app.support.datetime_utils import as_utc, sortable_datetime, utc_now

NAIROBI = ZoneInfo("Africa/Nairobi")
MENU_OPTION_RE = re.compile(r"option\s+(\d+)", re.IGNORECASE)


class TicketAnalyticsService:
    """Aggregate support-ticket metrics for merchant dashboards."""

    def __init__(self, db: Session):
        self.db = db

    def build_report(
        self,
        merchant_account_id: str,
        *,
        days: int = 30,
    ) -> dict[str, Any]:
        days = max(1, min(days, 365))
        account_ids = self._instagram_account_ids(merchant_account_id)
        if not account_ids:
            return self._empty_report(days)

        now = utc_now()
        start = now - timedelta(days=days)

        tickets = (
            self.db.query(SupportTicket)
            .options(joinedload(SupportTicket.events))
            .filter(
                SupportTicket.instagram_account_id.in_(account_ids),
                SupportTicket.opened_at >= start,
            )
            .order_by(SupportTicket.opened_at.desc())
            .all()
        )

        open_backlog = (
            self.db.query(SupportTicket)
            .filter(
                SupportTicket.instagram_account_id.in_(account_ids),
                SupportTicket.status.in_(("open", "waiting_customer")),
            )
            .count()
        )

        return self._aggregate(tickets, open_backlog=open_backlog, days=days, end=now)

    def _instagram_account_ids(self, merchant_account_id: str) -> list[str]:
        rows = (
            self.db.query(InstagramAccount.id)
            .filter(InstagramAccount.account_id == merchant_account_id)
            .all()
        )
        return [row[0] for row in rows]

    def _aggregate(
        self,
        tickets: list[SupportTicket],
        *,
        open_backlog: int,
        days: int,
        end: datetime,
    ) -> dict[str, Any]:
        opened_by_day: Counter[str] = Counter()
        closed_by_day: Counter[str] = Counter()
        resolution_counts: Counter[str] = Counter()
        status_counts: Counter[str] = Counter()
        menu_counts: Counter[str] = Counter()
        funnel_counts: Counter[str] = Counter()
        hour_counts: Counter[int] = Counter()

        durations: list[int] = []
        first_response: list[int] = []
        first_customer: list[int] = []

        for ticket in tickets:
            opened = ticket.opened_at
            if opened:
                day_key = self._nairobi_day_key(opened)
                opened_by_day[day_key] += 1
                hour_counts[self._nairobi_hour(opened)] += 1

            if ticket.closed_at:
                closed_by_day[self._nairobi_day_key(ticket.closed_at)] += 1

            status_counts[ticket.status or "unknown"] += 1
            if ticket.resolution:
                resolution_counts[ticket.resolution] += 1
            elif ticket.is_open():
                resolution_counts["open"] += 1

            if ticket.opened_at and ticket.closed_at:
                delta = sortable_datetime(ticket.closed_at) - sortable_datetime(ticket.opened_at)
                durations.append(max(0, int(delta.total_seconds())))

            if ticket.opened_at and ticket.first_agent_reply_at:
                delta = (
                    sortable_datetime(ticket.first_agent_reply_at)
                    - sortable_datetime(ticket.opened_at)
                )
                first_response.append(max(0, int(delta.total_seconds())))

            if ticket.opened_at and ticket.first_customer_reply_at:
                delta = (
                    sortable_datetime(ticket.first_customer_reply_at)
                    - sortable_datetime(ticket.opened_at)
                )
                first_customer.append(max(0, int(delta.total_seconds())))

            for event in ticket.events or []:
                funnel_counts[event.event_type] += 1
                if event.event_type == "menu_selected":
                    option = self._menu_option(event.body or "")
                    if option:
                        menu_counts[option] += 1

        closed_total = sum(
            1 for ticket in tickets if ticket.closed_at is not None and not ticket.is_open()
        )
        solved = resolution_counts.get("solved", 0)
        auto_timeout = resolution_counts.get("auto_timeout", 0)

        timeline = self._daily_series(end, days, opened_by_day, closed_by_day)

        return {
            "range_days": days,
            "summary": {
                "total_tickets": len(tickets),
                "open_backlog": open_backlog,
                "closed_tickets": closed_total,
                "solved_tickets": solved,
                "unsolved_tickets": resolution_counts.get("unsolved", 0),
                "auto_timeout_tickets": auto_timeout,
                "solve_rate_pct": self._pct(solved, closed_total),
                "auto_timeout_rate_pct": self._pct(auto_timeout, closed_total),
                "avg_duration_seconds": self._avg(durations),
                "median_duration_seconds": self._median(durations),
                "avg_first_response_seconds": self._avg(first_response),
                "avg_first_customer_reply_seconds": self._avg(first_customer),
            },
            "tickets_by_day": timeline,
            "resolution_breakdown": self._counter_rows(
                resolution_counts,
                {
                    "solved": "Solved",
                    "unsolved": "Unresolved",
                    "auto_timeout": "Auto-closed (timeout)",
                    "open": "Still open",
                },
            ),
            "status_breakdown": self._counter_rows(
                status_counts,
                {
                    "waiting_customer": "Waiting on customer",
                    "open": "Open",
                    "resolved": "Resolved",
                    "closed_unresolved": "Closed unresolved",
                },
            ),
            "menu_selections": [
                {"option": label, "count": menu_counts[label]}
                for label in sorted(menu_counts.keys(), key=lambda value: int(value))
            ],
            "event_funnel": self._funnel_rows(funnel_counts),
            "hourly_volume": [
                {"hour": hour, "label": f"{hour:02d}:00", "count": hour_counts.get(hour, 0)}
                for hour in range(24)
            ],
        }

    @staticmethod
    def _empty_report(days: int) -> dict[str, Any]:
        end = utc_now()
        return {
            "range_days": days,
            "summary": {
                "total_tickets": 0,
                "open_backlog": 0,
                "closed_tickets": 0,
                "solved_tickets": 0,
                "unsolved_tickets": 0,
                "auto_timeout_tickets": 0,
                "solve_rate_pct": 0.0,
                "auto_timeout_rate_pct": 0.0,
                "avg_duration_seconds": None,
                "median_duration_seconds": None,
                "avg_first_response_seconds": None,
                "avg_first_customer_reply_seconds": None,
            },
            "tickets_by_day": TicketAnalyticsService._daily_series(end, days, Counter(), Counter()),
            "resolution_breakdown": [],
            "status_breakdown": [],
            "menu_selections": [],
            "event_funnel": [],
            "hourly_volume": [
                {"hour": hour, "label": f"{hour:02d}:00", "count": 0} for hour in range(24)
            ],
        }

    @staticmethod
    def _nairobi_day_key(value: datetime) -> str:
        aware = as_utc(value) or datetime.now(timezone.utc)
        return aware.astimezone(NAIROBI).strftime("%Y-%m-%d")

    @staticmethod
    def _nairobi_hour(value: datetime) -> int:
        aware = as_utc(value) or datetime.now(timezone.utc)
        return aware.astimezone(NAIROBI).hour

    @staticmethod
    def _daily_series(
        end: datetime,
        days: int,
        opened: Counter[str],
        closed: Counter[str],
    ) -> list[dict[str, Any]]:
        end_aware = as_utc(end) or datetime.now(timezone.utc)
        end_local = end_aware.astimezone(NAIROBI).date()
        rows: list[dict[str, Any]] = []
        for offset in range(days - 1, -1, -1):
            day = end_local - timedelta(days=offset)
            key = day.isoformat()
            rows.append(
                {
                    "date": key,
                    "label": day.strftime("%d %b"),
                    "opened": opened.get(key, 0),
                    "closed": closed.get(key, 0),
                },
            )
        return rows

    @staticmethod
    def _funnel_rows(counts: Counter[str]) -> list[dict[str, Any]]:
        order = [
            ("ticket_opened", "Tickets opened"),
            ("greeting_sent", "Greetings sent"),
            ("customer_replied", "Customer replies"),
            ("menu_selected", "Menu selections"),
            ("agent_replied", "Agent replies"),
            ("marked_solved", "Marked solved"),
            ("marked_unresolved", "Marked unresolved"),
            ("auto_closed", "Auto-closed"),
            ("manually_closed", "Manually closed"),
            ("manually_reopened", "Reopened"),
        ]
        return [
            {"event_type": event_type, "label": label, "count": counts.get(event_type, 0)}
            for event_type, label in order
            if counts.get(event_type, 0) > 0
        ] or [{"event_type": "ticket_opened", "label": "Tickets opened", "count": 0}]

    @staticmethod
    def _counter_rows(counter: Counter[str], labels: dict[str, str]) -> list[dict[str, Any]]:
        rows = [
            {"key": key, "label": labels.get(key, key.replace("_", " ").title()), "count": count}
            for key, count in counter.items()
            if count > 0
        ]
        rows.sort(key=lambda row: row["count"], reverse=True)
        return rows

    @staticmethod
    def _menu_option(body: str) -> str | None:
        match = MENU_OPTION_RE.search(body)
        if match:
            return match.group(1)
        return None

    @staticmethod
    def _pct(part: int, whole: int) -> float:
        if whole <= 0:
            return 0.0
        return round((part / whole) * 100, 1)

    @staticmethod
    def _avg(values: list[int]) -> int | None:
        if not values:
            return None
        return int(round(sum(values) / len(values)))

    @staticmethod
    def _median(values: list[int]) -> int | None:
        if not values:
            return None
        ordered = sorted(values)
        mid = len(ordered) // 2
        if len(ordered) % 2:
            return ordered[mid]
        return int(round((ordered[mid - 1] + ordered[mid]) / 2))

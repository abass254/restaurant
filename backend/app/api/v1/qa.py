"""Internal QA issue tracker — email-gated."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, QaIssue, User
from app.schemas import QaAssigneeOut, QaAssigneesListResponse, QaIssueOut, QaIssuesListResponse
from app.support.datetime_utils import as_utc
from app.support.internal_tools_access import (
    INTERNAL_TOOLS_ALLOWED_EMAILS,
    is_internal_tools_user,
    require_internal_tools_user,
)
from app.support.merchant_permissions import active_account_id

router = APIRouter(prefix="/qa", tags=["qa"])

QA_ISSUE_TYPES = frozenset({"bug", "task", "improvement", "question"})
QA_PRIORITIES = frozenset({"highest", "high", "medium", "low", "lowest"})
QA_STATUSES = frozenset({"open", "in_progress", "done", "wont_fix"})
QA_COMPONENTS = frozenset(
    {
        "general",
        "dashboard",
        "orders",
        "delivery",
        "inventory",
        "pos",
        "customer",
        "tickets",
        "feeds",
        "tools",
        "settings",
        "rider_app",
        "auth",
        "payments",
    }
)


def _iso(dt: datetime | None) -> str | None:
    aware = as_utc(dt)
    return aware.isoformat() if aware else None


def _internal_tools_users(db: Session) -> list[User]:
    allowed = {email.lower() for email in INTERNAL_TOOLS_ALLOWED_EMAILS}
    rows = db.query(User).filter(User.email.isnot(None)).all()
    matches = [
        user
        for user in rows
        if (user.email or "").strip().lower() in allowed
    ]
    matches.sort(key=lambda user: ((user.name or "").lower(), (user.email or "").lower()))
    return matches


def _validate_assignee_id(db: Session, assignee_id: str | None) -> str | None:
    if assignee_id is None:
        return None
    assignee = db.get(User, assignee_id)
    if not assignee or not is_internal_tools_user(assignee):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid assignee.")
    return assignee_id


def _serialize_issue(issue: QaIssue) -> QaIssueOut:
    reporter = issue.reporter
    assignee = issue.assignee
    account_name = None
    if issue.account_id:
        account_name = getattr(getattr(issue, "_account", None), "business_name", None)
    return QaIssueOut(
        id=issue.id,
        key=f"QA-{issue.issue_number}",
        issue_number=issue.issue_number,
        summary=issue.summary,
        description=issue.description,
        issue_type=issue.issue_type,
        priority=issue.priority,
        component=issue.component,
        status=issue.status,
        page_url=issue.page_url,
        steps_to_reproduce=issue.steps_to_reproduce,
        reporter_name=reporter.name if reporter else None,
        reporter_email=reporter.email if reporter else None,
        assignee_id=issue.assignee_id,
        assignee_name=assignee.name if assignee else None,
        assignee_email=assignee.email if assignee else None,
        account_name=account_name,
        created_at=_iso(issue.created_at),
        updated_at=_iso(issue.updated_at),
    )


def _next_issue_number(db: Session) -> int:
    current = db.query(func.max(QaIssue.issue_number)).scalar()
    return (current or 0) + 1


class CreateQaIssueRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=255)
    description: str | None = None
    issue_type: str = "bug"
    priority: str = "medium"
    component: str = "general"
    page_url: str | None = Field(default=None, max_length=500)
    steps_to_reproduce: str | None = None
    assignee_id: str | None = None


class UpdateQaIssueRequest(BaseModel):
    summary: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    issue_type: str | None = None
    priority: str | None = None
    component: str | None = None
    status: str | None = None
    page_url: str | None = Field(default=None, max_length=500)
    steps_to_reproduce: str | None = None
    assignee_id: str | None = Field(default=None)


@router.get("/assignees", response_model=QaAssigneesListResponse)
def list_qa_assignees(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    require_internal_tools_user(user)
    return {
        "data": [
            QaAssigneeOut(id=row.id, name=row.name, email=row.email)
            for row in _internal_tools_users(db)
        ],
    }


@router.get("/issues", response_model=QaIssuesListResponse)
def list_qa_issues(
    status_filter: str | None = Query(default=None, alias="status"),
    component: str | None = Query(default=None),
    mine: bool = Query(default=False),
    assigned: str | None = Query(default=None, pattern="^(me|unassigned)$"),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    require_internal_tools_user(user)

    q = (
        db.query(QaIssue)
        .options(
            joinedload(QaIssue.reporter),
            joinedload(QaIssue.assignee),
        )
        .order_by(QaIssue.issue_number.desc())
    )
    if status_filter:
        q = q.filter(QaIssue.status == status_filter.strip().lower())
    if component:
        q = q.filter(QaIssue.component == component.strip().lower())
    if mine:
        q = q.filter(QaIssue.reporter_id == user.id)
    if assigned == "me":
        q = q.filter(QaIssue.assignee_id == user.id)
    elif assigned == "unassigned":
        q = q.filter(QaIssue.assignee_id.is_(None))

    rows = q.limit(limit).all()
    account_ids = {row.account_id for row in rows if row.account_id}
    accounts_by_id: dict[str, Account] = {}
    if account_ids:
        accounts = db.query(Account).filter(Account.id.in_(account_ids)).all()
        accounts_by_id = {account.id: account for account in accounts}
    for row in rows:
        if row.account_id and row.account_id in accounts_by_id:
            row._account = accounts_by_id[row.account_id]  # type: ignore[attr-defined]

    return {"data": [_serialize_issue(row) for row in rows]}


@router.post("/issues", response_model=QaIssueOut, status_code=status.HTTP_201_CREATED)
def create_qa_issue(
    request: Request,
    payload: CreateQaIssueRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    require_internal_tools_user(user)

    issue_type = payload.issue_type.strip().lower()
    priority = payload.priority.strip().lower()
    component = payload.component.strip().lower()
    if issue_type not in QA_ISSUE_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid issue type.")
    if priority not in QA_PRIORITIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid priority.")
    if component not in QA_COMPONENTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid component.")

    assignee_id = _validate_assignee_id(db, payload.assignee_id)
    now = datetime.now(timezone.utc)
    account_id = active_account_id(user)
    issue = QaIssue(
        issue_number=_next_issue_number(db),
        account_id=account_id,
        reporter_id=user.id,
        assignee_id=assignee_id,
        summary=payload.summary.strip(),
        description=(payload.description or "").strip() or None,
        issue_type=issue_type,
        priority=priority,
        component=component,
        status="open",
        page_url=(payload.page_url or "").strip() or None,
        steps_to_reproduce=(payload.steps_to_reproduce or "").strip() or None,
        created_at=now,
        updated_at=now,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue, attribute_names=["reporter", "assignee"])
    if account_id:
        account = db.get(Account, account_id)
        if account:
            issue._account = account  # type: ignore[attr-defined]
    return _serialize_issue(issue)


@router.patch("/issues/{issue_id}", response_model=QaIssueOut)
def update_qa_issue(
    issue_id: str,
    request: Request,
    payload: UpdateQaIssueRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    require_internal_tools_user(user)

    issue = (
        db.query(QaIssue)
        .options(
            joinedload(QaIssue.reporter),
            joinedload(QaIssue.assignee),
        )
        .filter(QaIssue.id == issue_id)
        .first()
    )
    if not issue:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Issue not found.")

    if payload.summary is not None:
        issue.summary = payload.summary.strip()
    if payload.description is not None:
        issue.description = payload.description.strip() or None
    if payload.issue_type is not None:
        issue_type = payload.issue_type.strip().lower()
        if issue_type not in QA_ISSUE_TYPES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid issue type.")
        issue.issue_type = issue_type
    if payload.priority is not None:
        priority = payload.priority.strip().lower()
        if priority not in QA_PRIORITIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid priority.")
        issue.priority = priority
    if payload.component is not None:
        component = payload.component.strip().lower()
        if component not in QA_COMPONENTS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid component.")
        issue.component = component
    if payload.status is not None:
        status_value = payload.status.strip().lower()
        if status_value not in QA_STATUSES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid status.")
        issue.status = status_value
    if payload.page_url is not None:
        issue.page_url = payload.page_url.strip() or None
    if payload.steps_to_reproduce is not None:
        issue.steps_to_reproduce = payload.steps_to_reproduce.strip() or None
    if "assignee_id" in payload.model_fields_set:
        issue.assignee_id = _validate_assignee_id(db, payload.assignee_id)

    issue.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(issue, attribute_names=["reporter", "assignee"])
    if issue.account_id:
        account = db.get(Account, issue.account_id)
        if account:
            issue._account = account  # type: ignore[attr-defined]
    return _serialize_issue(issue)

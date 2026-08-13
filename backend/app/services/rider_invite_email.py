"""Email delivery for rider fleet invite links."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email

INVITE_EMAIL_FROM_ADDRESS = "no-reply@dukai.app"
INVITE_EMAIL_FROM_NAME = "DUKAI PLATFORM"


def _require_mail_service() -> EmailService:
    service = EmailService()
    if not service.settings.mail_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email sending is disabled.",
        )
    if not service.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail provider is not configured.",
        )
    return service


def send_rider_invite_email(
    *,
    to_email: str,
    rider_name: str,
    merchant_name: str,
    invite_url: str,
) -> None:
    """Send the rider join link to an email address."""
    recipient = (to_email or "").strip().lower()
    if not recipient:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="An email address is required to send the invite.",
        )

    service = _require_mail_service()
    shop = (merchant_name or "").strip() or "a shop"
    first_name = (rider_name or "").strip().split()[0] if (rider_name or "").strip() else "there"

    html = render_branded_email(
        title="You're invited to deliver with DukAI",
        heading=f"{shop} invited you to join their delivery fleet",
        intro=(
            f"Hi {first_name}, you were invited to deliver orders for {shop} "
            "on DukAI. Open the link below on your phone to join and start "
            "receiving assigned deliveries."
        ),
        paragraphs=[
            "This invite link expires in 7 days. If you weren't expecting this, "
            "you can ignore the email.",
        ],
        details=[
            ("Shop", shop),
            ("Rider name", (rider_name or "").strip() or "—"),
        ],
        cta_label="Join as rider",
        cta_url=invite_url,
        footer_note="Only open this link if you trust the shop that invited you.",
    )
    sent = service.send_email(
        to=recipient,
        to_name=rider_name,
        subject=f"{shop} invited you to deliver on DukAI",
        text=(
            f"Hi {first_name},\n\n"
            f"You were invited to deliver orders for {shop} on DukAI.\n\n"
            f"Join here: {invite_url}\n\n"
            "This invite link expires in 7 days."
        ),
        html=html,
        category="rider-invite",
        from_address=INVITE_EMAIL_FROM_ADDRESS,
        from_name=INVITE_EMAIL_FROM_NAME,
    )
    if not sent:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the rider invite email.",
        )

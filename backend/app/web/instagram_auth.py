import logging
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.core.oauth_state import try_parse_return_origin
from app.core.session import get_current_user, save_session
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.services.platform_instagram import user_can_manage_platform_instagram
from app.web.webhooks import handle_webhook, verify_instagram_webhook

logger = logging.getLogger(__name__)

router = APIRouter(tags=["instagram-auth"])


def _frontend_url(
    path: str = "",
    *,
    base: str | None = None,
    error: str | None = None,
) -> str:
    settings = get_settings()
    origin = (base or settings.frontend_url).rstrip("/")
    url = f"{origin}{path}"
    if error:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}error={quote(error)}"
    return url


def _request_return_origin(request: Request) -> str:
    settings = get_settings()
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    proto = forwarded_proto.split(",")[0].strip() if forwarded_proto else request.url.scheme
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if forwarded_host:
        host = forwarded_host.split(",")[0].strip()
        return f"{proto}://{host}".rstrip("/")
    return settings.frontend_url.rstrip("/")


def _known_oauth_return_origin(origin: str) -> str | None:
    """Allow known app hosts on OAuth callback even if this backend's env omits them."""
    normalized = origin.rstrip("/")
    for candidate in ("https://dukai.app", "https://uat.dukai.app"):
        if normalized == candidate:
            return candidate
    return None


def _safe_return_origin(request: Request, state: str | None = None) -> str:
    settings = get_settings()
    from_state = try_parse_return_origin(settings, state)
    if from_state:
        return from_state

    origin = _request_return_origin(request)
    try:
        return settings.validate_oauth_return_origin(origin)
    except ValueError:
        known = _known_oauth_return_origin(origin)
        if known:
            return known
        return settings.frontend_url.rstrip("/")


@router.get("/auth/instagram")
def instagram_redirect(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    return_origin = _safe_return_origin(request)

    user = get_current_user(services.db, session)
    if user is None:
        return RedirectResponse(
            _frontend_url(
                "/sign-in",
                base=return_origin,
                error="Please sign in to connect your Instagram account.",
            ),
            status_code=302,
        )

    if not user_can_manage_platform_instagram(user):
        return RedirectResponse(
            _frontend_url(
                "/settings",
                base=return_origin,
                error="You need a merchant shop account to connect Instagram.",
            ),
            status_code=302,
        )

    login_url = services.auth.get_login_url(
        user_id=str(user.id),
        return_origin=return_origin,
    )
    return RedirectResponse(login_url, status_code=302)


@router.get("/instagram/callback")
@router.get("/auth/instagram/callback")
def instagram_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    if hub_mode:
        logger.warning(
            "Meta webhook verify hit OAuth callback URL; use https://…/webhooks/instagram instead"
        )
        return verify_instagram_webhook(hub_mode, hub_verify_token, hub_challenge)

    return_origin = _safe_return_origin(request, state)
    logger.info(
        "Instagram OAuth callback: host=%s return_origin=%s has_state=%s",
        request.headers.get("host"),
        return_origin,
        bool(state),
    )

    if error:
        message = error_description or "Meta authorization was cancelled."
        return RedirectResponse(_frontend_url("/settings", base=return_origin, error=message))

    if not code or not state:
        return RedirectResponse(
            _frontend_url(
                "/settings",
                base=return_origin,
                error="Incomplete response from Meta. Please try again.",
            ),
        )

    user = get_current_user(services.db, session)
    settings = get_settings()
    try:
        _, return_origin = services.auth.handle_callback(
            services.db,
            code,
            state,
            user,
        )
    except Exception as exc:
        logger.exception("Instagram OAuth callback failed")
        message = (
            f"Connection failed: {exc}"
            if settings.app_debug
            else "Could not connect your Instagram account. Please try again."
        )
        return RedirectResponse(_frontend_url("/settings", base=return_origin, error=message))

    redirect = RedirectResponse(
        _frontend_url("/settings?connected=1", base=return_origin),
        status_code=302,
    )
    if user is not None:
        redirect.set_cookie(**save_session(request, session))
    return redirect


@router.post("/instagram/callback")
@router.post("/auth/instagram/callback")
async def instagram_callback_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    services: ServiceContainer = Depends(get_services),
):
    logger.warning(
        "Meta webhook POST hit OAuth callback URL; use https://…/webhooks/instagram instead"
    )
    return await handle_webhook(request, background_tasks, services)

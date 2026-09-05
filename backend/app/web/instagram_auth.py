import logging
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.core.instagram_hub import (
    OAUTH_STATE_COOKIE,
    OAUTH_STATE_SESSION_KEY,
    new_oauth_state,
    public_https_origin,
    state_cookie,
    states_match,
)
from app.core.oauth_state import try_parse_return_origin
from app.core.session import _cookie_secure, get_current_user, save_session
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.services.platform_instagram import user_can_manage_platform_instagram
from app.web.webhooks import handle_webhook, verify_instagram_webhook

logger = logging.getLogger(__name__)

router = APIRouter(tags=["instagram-auth"])

OAUTH_NEXT_SESSION_KEY = "instagram_oauth_next"


def _safe_oauth_next(raw: str | None) -> str:
    path = (raw or "").strip()
    if path.startswith("/trans-chap") and not path.startswith("//") and "://" not in path:
        return path.split("#")[0][:200]
    return "/settings"


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
    for candidate in (
        "https://dukai.app",
        "https://uat.dukai.app",
        "https://merchants.dukai.app",
    ):
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


def _hub_return_origin(request: Request) -> str | None:
    settings = get_settings()
    return public_https_origin(
        settings.app_url,
        _request_return_origin(request),
        settings.frontend_url,
    )


def _oauth_done_path(session: dict, *, connected: bool = False) -> str:
    raw = session.pop(OAUTH_NEXT_SESSION_KEY, None)
    path = _safe_oauth_next(raw if isinstance(raw, str) else None)
    if connected:
        sep = "&" if "?" in path else "?"
        return f"{path}{sep}connected=1"
    return path


def _clear_oauth_state(redirect: RedirectResponse, session: dict) -> None:
    session.pop(OAUTH_STATE_SESSION_KEY, None)
    redirect.delete_cookie(OAUTH_STATE_COOKIE, path="/")


@router.get("/auth/instagram")
def instagram_redirect(
    request: Request,
    next_path: str | None = Query(default=None, alias="next"),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    return_origin = _safe_return_origin(request)
    session[OAUTH_NEXT_SESSION_KEY] = _safe_oauth_next(next_path)

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

    state = new_oauth_state()
    session[OAUTH_STATE_SESSION_KEY] = state
    hub_url = services.auth.get_login_url(
        state=state,
        origin=_hub_return_origin(request) or return_origin,
    )
    redirect = RedirectResponse(hub_url, status_code=302)
    redirect.set_cookie(**save_session(request, session))
    redirect.set_cookie(**state_cookie(value=state, secure=_cookie_secure(request)))
    return redirect


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
            "Meta webhook verify hit OAuth callback URL; handshake belongs on dukai.app"
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
        logger.info(
            "Instagram OAuth cancelled error=%s description=%s",
            error,
            error_description,
        )
        redirect = RedirectResponse(
            _frontend_url(_oauth_done_path(session), base=return_origin, error="cancelled"),
        )
        _clear_oauth_state(redirect, session)
        redirect.set_cookie(**save_session(request, session))
        return redirect

    expected = request.cookies.get(OAUTH_STATE_COOKIE) or session.get(OAUTH_STATE_SESSION_KEY)
    cookie_ok = states_match(state, str(expected) if expected else None)
    user = get_current_user(services.db, session)

    if not cookie_ok and state:
        try:
            user = services.auth.user_from_signed_state(services.db, state, user)
            cookie_ok = True
        except RuntimeError:
            cookie_ok = False

    if not code or not state or not cookie_ok:
        redirect = RedirectResponse(
            _frontend_url(_oauth_done_path(session), base=return_origin, error="invalid_state"),
        )
        _clear_oauth_state(redirect, session)
        redirect.set_cookie(**save_session(request, session))
        return redirect

    if user is None:
        return RedirectResponse(
            _frontend_url(
                "/sign-in",
                base=return_origin,
                error="Please sign in to connect your Instagram account.",
            ),
        )

    settings = get_settings()
    try:
        _, return_origin = services.auth.handle_callback(
            services.db,
            code,
            user,
            return_origin=return_origin,
        )
    except Exception as exc:
        logger.exception("Instagram OAuth callback failed")
        message = (
            f"Connection failed: {exc}"
            if settings.app_debug
            else "Could not connect your Instagram account. Please try again."
        )
        redirect = RedirectResponse(
            _frontend_url(_oauth_done_path(session), base=return_origin, error=message)
        )
        _clear_oauth_state(redirect, session)
        redirect.set_cookie(**save_session(request, session))
        return redirect

    redirect = RedirectResponse(
        _frontend_url(_oauth_done_path(session, connected=True), base=return_origin),
        status_code=302,
    )
    _clear_oauth_state(redirect, session)
    redirect.set_cookie(**save_session(request, session))
    return redirect


@router.post("/instagram/callback")
@router.post("/auth/instagram/callback")
async def instagram_callback_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    logger.warning(
        "Webhook POST hit OAuth callback URL; hub should POST /webhooks/instagram"
    )
    return await handle_webhook(request, background_tasks)

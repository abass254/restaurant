from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import router as api_v1_router
from app.config import get_settings
from app.core.uploads import UPLOADS_DIR
from app.core.session import (
    _cookie_secure,
    ensure_csrf_token,
    get_session,
    save_session,
    xsrf_cookie_value,
)
from app.web.instagram_auth import router as instagram_auth_router
from app.web.google_auth import router as google_auth_router
from app.web.meta_webhooks import router as meta_webhooks_router
from app.web.mpesa_webhook import router as mpesa_webhook_router
from app.web.webhooks import router as webhooks_router
from app.core.boot_guards import assert_production_secrets, fastapi_docs_kwargs
from app.core.http_error_logging import log_unhandled_error, register_http_error_logging
from app.core.log_buffer import RequestLogMiddleware, install_log_handler

logger = logging.getLogger(__name__)

# Meta's Instagram Content Publishing API fetches media with facebookexternalhit.
# robots.txt must exist and allow that crawler or publishing fails.
ROBOTS_TXT = """\
# Meta's Instagram Graph API fetches media with this crawler. A robots.txt must
# exist and allow it, or publishing fails with "Only photo or video…".
User-agent: facebookexternalhit
Allow: /

User-agent: *
Allow: /
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the M-PESA lost-callback recovery sweep alongside the app."""
    settings = get_settings()
    task: asyncio.Task | None = None
    if settings.mpesa_stk_recovery_enabled:
        from app.services.mpesa_recovery_service import run_recovery_loop

        task = asyncio.create_task(run_recovery_loop())

    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


def create_app() -> FastAPI:
    settings = get_settings()
    assert_production_secrets(settings)
    logging.basicConfig(
        level=logging.DEBUG if settings.app_debug else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    install_log_handler()
    app = FastAPI(
        title=settings.app_name,
        debug=settings.app_debug,
        lifespan=lifespan,
        **fastapi_docs_kwargs(debug=settings.app_debug),
    )

    if settings.app_debug:
        register_http_error_logging(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # List endpoints (inventory, orders) return ~1MB of JSON for large shops.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    app.add_middleware(RequestLogMiddleware)

    @app.get("/sanctum/csrf-cookie")
    def sanctum_csrf_cookie(request: Request, response: Response):
        session = get_session(request)
        token = ensure_csrf_token(session)
        cookie = save_session(request, session)
        response.set_cookie(**cookie)
        response.set_cookie(
            key="XSRF-TOKEN",
            value=xsrf_cookie_value(token),
            max_age=settings.session_max_age,
            secure=_cookie_secure(request),
            samesite="lax",
        )
        return {"message": "CSRF cookie set."}

    def _frontend_sign_in():
        return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/sign-in")

    @app.get("/sign-in")
    def sign_in_redirect():
        return _frontend_sign_in()

    @app.get("/login")
    def login_redirect():
        return _frontend_sign_in()

    @app.get("/up")
    def health():
        return {"status": "ok"}

    @app.get("/robots.txt", response_class=PlainTextResponse)
    def robots_txt():
        return ROBOTS_TXT

    if settings.app_debug:

        @app.get("/test")
        def test_connection():
            return {"message": "Backend connection OK — FastAPI"}

    @app.get("/")
    def root():
        return RedirectResponse(settings.frontend_url)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        if settings.app_debug:
            log_unhandled_error(request, exc)
        else:
            logger.exception("Unhandled error on %s", request.url.path)
        if settings.app_debug:
            return JSONResponse(
                status_code=500,
                content={"message": str(exc)},
            )
        return JSONResponse(
            status_code=500,
            content={"detail": "Server error.", "message": "Server error."},
        )

    app.include_router(api_v1_router)
    app.include_router(instagram_auth_router)
    app.include_router(google_auth_router)
    app.include_router(webhooks_router)
    app.include_router(meta_webhooks_router)
    app.include_router(mpesa_webhook_router)

    # Serve uploaded product photos. URLs look like /uploads/products/<id>/<sha>.jpg.
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

    return app


app = create_app()

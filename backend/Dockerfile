# syntax=docker/dockerfile:1.7

# TransChap FastAPI backend.
# Listens on port 7071 inside the container (configurable via APP_PORT).

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_PORT=7071

WORKDIR /app

# curl is only kept for the HEALTHCHECK. Everything else (pymysql, bcrypt,
# cryptography) ships as a manylinux wheel for Python 3.12, so no build
# toolchain is required.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Non-root runtime user owning the writable upload mount.
RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --create-home app \
    && mkdir -p /app/uploads \
    && chown -R app:app /app

USER app

EXPOSE 7071

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${APP_PORT}/up" || exit 1

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT}"]

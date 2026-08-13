# FastAPI backend (DukAI)

Python API for DukAI. Uses the same route contract expected by the Next.js frontend.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env
# Edit ../.env — all secrets live at the repo root (no backend/.env)
```

## Run (development)

```bash
uvicorn app.main:app --host 127.0.0.1 --port 7001 --reload
```

Health check: `GET http://127.0.0.1:7001/up`

## Frontend

Set `BACKEND_URL` in the repo-root `.env` (loaded automatically by Next.js).

## Auth

Session cookies + CSRF mirror Laravel Sanctum SPA mode:

- `GET /sanctum/csrf-cookie` — sets session + `XSRF-TOKEN`
- Login stores `user_id` in a signed cookie (`dukai_session`)
- Mutating requests require `X-XSRF-TOKEN` header (handled by `frontend/src/lib/api.ts`)

Users must log in again when session settings change.

## API surface

All routes under `/api/v1/*` plus:

- `GET /auth/instagram`, `GET /auth/instagram/callback`
- `GET/POST /webhooks/instagram`

See `docs/ARCHITECTURE.md` for the full contract.

## Sales autopilot MVP

Set in `.env`:

```env
SALES_AUTOPILOT_ENABLED=true
```

When enabled, the first inbound Instagram DM gets a seller-style kickoff reply,
then the bot can qualify, recommend products from inventory, create an order,
and trigger M-PESA checkout.

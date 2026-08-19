# DukAI architecture

FastAPI is the **API-only backend** (`backend/`). Next.js is the **only user-facing UI**. MySQL is the **primary database**.

## Ports

| Service   | Dev (`npm run dev` / `./run.sh`) | Prod (Docker / `npm start`) |
|-----------|----------------------------------|-----------------------------|
| Next.js   | **7000**                         | **7070**                    |
| FastAPI   | **7001**                         | **7071**                    |

| Mode   | Frontend URL              | API URL (direct)           |
|--------|---------------------------|----------------------------|
| Dev    | http://127.0.0.1:7000     | http://127.0.0.1:7001      |
| Prod   | http://localhost:7070     | http://127.0.0.1:7071      |

In both modes the browser only talks to the frontend; Next.js rewrites proxy `/api`, `/auth`, `/sanctum`, etc. to `BACKEND_URL` (dev: `http://127.0.0.1:7001`, prod Docker: `http://backend:7071`).

### Local (no Docker)

```bash
# Terminal 1 — API
cd backend && source .venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 7001 --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

### Docker (full stack incl. MySQL)

```bash
cp .env.example .env     # fill in secrets
docker compose up -d --build
docker compose exec backend sh -c 'for f in migrations/*.py; do python "$f"; done'
```

See [DOCKER.md](DOCKER.md) for the full guide.

## Production (`insta.ufanisi.net`)

- **Public domain** → Next.js (port 7070 behind nginx).
- **API** → FastAPI on port 7071 (internal or `api.insta.ufanisi.net`).
- Set `FRONTEND_URL=https://insta.ufanisi.net`, `APP_URL=https://api.insta.ufanisi.net` (or your API host).
- Instagram OAuth starts on this API (`/auth/instagram`), which sends the user to the dukai.app hub. The hub returns the auth code to `{APP_URL}/instagram/callback`.

## Authentication

- Merchant UI primary route: **`/sign-in`**. `/` redirects signed-in users to their first allowed page, otherwise to `/sign-in`. `/login` is a compatibility redirect to `/sign-in`.
- **Session + CSRF** (Sanctum-compatible contract): cookies shared between frontend and API via `CORS_ALLOWED_ORIGINS`.
- Login flow: Next.js → `{API}/auth/instagram` → dukai.app hub → Instagram → hub → `{APP_URL}/instagram/callback` → Next.js `/settings`.
- API calls from Next.js use `credentials: "include"` and `GET /sanctum/csrf-cookie` before mutating requests.

## API surface

All JSON routes are under `/api/v1/`:

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/v1/auth/login`, `GET /api/v1/auth/user`, `POST /api/v1/auth/logout` |
| Register | `POST /api/v1/register` |
| Settings | `GET /api/v1/settings`, `POST/DELETE /api/v1/settings/instagram` |
| Onboarding | `GET /api/v1/onboarding`, `POST /api/v1/onboarding/refresh` |
| Inbox | `GET /api/v1/messages`, `GET /api/v1/messages/{id}`, `POST .../reply` |
| Starters | `/api/v1/conversation-starters` |
| Auto-reply | `/api/v1/auto-reply` |

## Web routes (non-API)

Only infrastructure that must be called by Meta or OAuth:

- `GET/POST /webhooks/instagram`
- `POST /webhooks/meta/deauthorize` — Meta deauthorize callback
- `POST /api/v1/meta/data-deletion` — Meta user data deletion callback
- `GET /auth/instagram`, `GET /auth/instagram/callback`
- `GET /sanctum/csrf-cookie`
- Fallback `/` redirects to `FRONTEND_URL`

Public legal pages (Next.js): `/privacy_policy`, `/terms`, `/data-deletion`.

See [META_APP_REVIEW.md](META_APP_REVIEW.md) for Meta App Review console URLs and submission checklist.

Legacy Laravel/Blade UI in `resources/views` is **deprecated**; new work goes in `frontend/`.

## MySQL

Managed by FastAPI migration scripts:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=dukai
DB_USERNAME=dukai
DB_PASSWORD=your_password
```

Schema changes are applied via backend migration scripts:

```bash
bash scripts/backend-migrate.sh
```

## Legacy token compatibility

If your DB was originally populated by older Laravel services, keep `APP_KEY` in `.env` so FastAPI can decrypt legacy encrypted Instagram tokens.

# Running DukAI in Docker

The full stack — MySQL, FastAPI backend, Next.js frontend — runs from a single
`docker compose up`. The tracked [`compose.yaml`](../compose.yaml) starts the
same stack in UAT or production. Ports follow the spec:

| Service   | Container port | Host port           |
|-----------|----------------|---------------------|
| frontend  | 7070           | `7070`              |
| backend   | 7071           | `127.0.0.1:7071`    |
| db (MySQL)| 3306           | `127.0.0.1:3307`    |

> The MySQL container publishes on host port **3307** (not 3306) so it
> doesn't clash with a system MySQL service. Inside the docker network the
> backend still talks to it on port `3306` at host `db`.

Only the frontend is exposed publicly. The browser hits `http://localhost:7070`
and Next.js server-side rewrites proxy `/api`, `/auth`, `/sanctum`,
`/webhooks`, `/mpesa`, and `/uploads` to `http://backend:7071` on the internal
docker network.

## 1. Configure

```bash
cp .env.example .env
# edit .env — set DB_PASSWORD, META_*, INSTAGRAM_*, etc.
```

Minimum values to set for a fresh install:

- `DB_PASSWORD`, `DB_ROOT_PASSWORD` — required; Compose will not start without them. Do not use `dukai`, `root`, or `password`.
- `SESSION_SECRET` — long random string (Compose/`APP_ENV=production` refuses placeholders).
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` — from your Meta app.
- `INSTAGRAM_REDIRECT_URI` — must match the Meta app's registered OAuth redirect URI.

For a production deployment on **merchants.dukai.app**, set:

```env
APP_URL=https://merchants.dukai.app
FRONTEND_URL=https://merchants.dukai.app
CORS_ALLOWED_ORIGINS=https://merchants.dukai.app
UPLOADS_HOST_PATH=/home/ubuntu/agents/uploads
APP_DEBUG=false
APP_ENV=production
NEXT_PUBLIC_DEBUG=false
```

The tracked Compose stack uses the persistent `backend_uploads` named volume.
For a host-managed media folder, use a reviewed deployment override which bind
mounts it at `/app/uploads`. Media is public at
`https://merchants.dukai.app/uploads/...`. See [UPLOADS.md](./UPLOADS.md).

For a generic production host behind nginx/TLS, set the same pattern with your
domain:

```env
APP_URL=https://your.domain
FRONTEND_URL=https://your.domain
CORS_ALLOWED_ORIGINS=https://your.domain
INSTAGRAM_REDIRECT_URI=https://your.domain/auth/instagram/callback
APP_DEBUG=false
APP_ENV=production
NEXT_PUBLIC_DEBUG=false
```

`APP_ENV=production` forces debug off even if `APP_DEBUG=true`. Compose also sets `APP_DEBUG=false` on the backend container.

## 2. Build & start

```bash
docker compose up -d --build
```

> Compose auto-reads `.env` for variable interpolation; the backend
> container also loads it via `env_file`.

First start brings up MySQL, then starts the backend and frontend after health
checks. Migrations are deliberately manual so a failed schema change cannot
silently alter a production database. Watch logs:

```bash
docker compose logs -f
```

## 3. Run migrations

The Python migrations are idempotent — safe to re-run on every deploy.

```bash
docker compose exec backend sh -c 'for f in migrations/*.py; do python "$f"; done'
```

To run a single migration:

```bash
docker compose exec backend python migrations/2026_05_26_140000_add_username_and_seed_super_admin.py
```

## 4. Health checks

```bash
curl http://localhost:7070/                 # frontend
curl http://127.0.0.1:7071/up               # backend health
```

`docker compose ps` shows the per-container healthcheck status. The database
is not published to the host; backend is loopback-only for the TLS proxy.

## Common operations

| Task                          | Command                                                |
|-------------------------------|--------------------------------------------------------|
| Tail backend logs             | `docker compose logs -f backend`                       |
| Open a shell in the backend   | `docker compose exec backend bash`                     |
| Open a MySQL shell            | `docker compose exec db mysql -u${DB_USERNAME} -p ${DB_DATABASE}` |
| Rebuild after deps change     | `docker compose build --no-cache backend`              |
| Reset DB (DESTRUCTIVE)        | `docker compose down -v`                               |
| Stop everything               | `docker compose down`                                  |

> Tip: Docker Compose loads `.env` automatically for interpolation — no
> extra `--env-file` flag is needed.

## File / volume layout

- `mysql_data` — persistent MySQL data dir.
- Uploads at `/app/uploads` inside the backend container, served at `/uploads/*`:
  - **Local:** named volume `backend_uploads` (default when `UPLOADS_HOST_PATH` is unset).
  - **Prod (merchants.dukai.app):** bind mount `UPLOADS_HOST_PATH=/home/ubuntu/agents/uploads`.

Named volumes survive `docker compose down`. Use `-v` to wipe them. Bind-mounted
host folders are not removed by Compose.

## Troubleshooting

**Backend can't reach MySQL.** The backend's `DB_HOST` is hardcoded to `db`
(the compose service name) in `docker-compose.yml`. Don't override it in
`.env`.

**Compose exits: `DB_PASSWORD must be set`.** Docker no longer defaults MySQL
to `dukai` / `root`. Put strong `DB_PASSWORD` and `DB_ROOT_PASSWORD` values
in `.env`.

**Backend exits: `SESSION_SECRET is missing or too weak`.** Replace the
`.env.example` placeholder with a long random string. `APP_ENV=production`
(Compose) will not start with `change-me-*` secrets.

**Instagram OAuth loops or fails.** `INSTAGRAM_REDIRECT_URI` in `.env`
must exactly match what's registered in the Meta app, including scheme, host,
port, and path.

**`/uploads/...` returns 404 in the browser.** Check the volume is mounted:
`docker compose exec backend ls /app/uploads`. New uploads land there and are
proxied through Next at `/uploads/*`. On merchants.dukai.app, confirm
`UPLOADS_HOST_PATH=/home/ubuntu/agents/uploads` and that
`APP_URL` / `FRONTEND_URL` are `https://merchants.dukai.app`.

**Port 7070 already in use.** Stop the host-side Next dev server (`npm run
dev` on :7000 won't clash, but a previous container will). `docker compose
down` clears it.

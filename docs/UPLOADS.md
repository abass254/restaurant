# DukAI Merchants uploads

Platform media from **https://merchants.dukai.app** is stored here.

| | |
|---|---|
| **Host folder** | `/home/ubuntu/agents/uploads` |
| **Public base URL** | https://merchants.dukai.app/uploads/ |
| **Example** | https://merchants.dukai.app/uploads/products/\<id\>/\<sha\>.png |

Layout written by the FastAPI backend:

- `products/<product_id>/…` — inventory photos/videos
- `feed/<account_id>/…` — feed posts
- `logos/<account_id>/…` — store logos

In production the backend pod mounts this directory at `/app/uploads`. Files are
served at `https://merchants.dukai.app/uploads/...` via the Next.js → FastAPI
`/uploads` proxy (or Apache `ProxyPass /uploads` → backend `:7071`).

## Production data on a laptop

If the API/DB is production data but `APP_URL` / `FRONTEND_URL` stay on
localhost, set:

```env
UPLOADS_PUBLIC_BASE_URL=https://merchants.dukai.app
```

The DB still stores relative `/uploads/...` paths; browsers and Instagram
resolve them against that public host. New files written under
`backend/uploads/` must also land on the server:

```bash
./scripts/push-uploads-to-prod.sh
# or dry-run:
DRY_RUN=1 ./scripts/push-uploads-to-prod.sh
```

## Production setup

On the Ubuntu host:

```bash
sudo mkdir -p /home/ubuntu/agents/uploads/{products,feed,logos}
sudo chown -R 1000:1000 /home/ubuntu/agents/uploads   # matches container `app` uid
```

In the server `.env`:

```env
APP_URL=https://merchants.dukai.app
FRONTEND_URL=https://merchants.dukai.app
CORS_ALLOWED_ORIGINS=https://merchants.dukai.app
UPLOADS_HOST_PATH=/home/ubuntu/agents/uploads
UPLOADS_PUBLIC_BASE_URL=https://merchants.dukai.app
```

Then:

```bash
docker compose up -d --build
```

Compose bind-mounts `UPLOADS_HOST_PATH` → `/app/uploads`. The DB keeps relative
paths like `/uploads/products/...`; browsers and Instagram resolve them against
`UPLOADS_PUBLIC_BASE_URL` when set, otherwise `APP_URL` / `FRONTEND_URL`.

Bare metal (no Docker): set `UPLOADS_DIR=/home/ubuntu/agents/uploads` instead
of `UPLOADS_HOST_PATH`, or symlink that folder to `backend/uploads/`.

## Localhost (separate from production)

Local/dev does **not** write into the production folder. Use the app’s normal
local stack:

```bash
cp .env.example .env   # if needed
# Keep APP_URL / FRONTEND_URL on localhost — do not point them at merchants.dukai.app
docker compose up -d --build
```

- Files land in the Docker volume `backend_uploads` → container `/app/uploads`
  (leave `UPLOADS_HOST_PATH` unset)
- Browser URLs look like `http://localhost:7070/uploads/products/...`
- Phone QR upload pages use `FRONTEND_URL` → e.g. `http://localhost:7070/m/upload/<token>`

For bare-metal backend (no Docker), files go to `backend/uploads/`.

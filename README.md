# DukAI Merchants

Retail commerce product for shops: inventory, POS, orders, delivery, riders, Instagram/WhatsApp tools, and M-Pesa.

The merchant app opens at **`/sign-in`**. `/` sends signed-in users to their dashboard (or onboarding), and everyone else to `/sign-in`. Legacy `/login` redirects to `/sign-in`.

This repo is the **merchants / retail** vertical. Services and appointments live in the sibling repo [`../dukai_services`](../dukai_services) (local Docker ports `7080` / `7081` / MySQL `3308`).

Stack: FastAPI backend (`backend/`), Next.js frontend (`frontend/`), MySQL. Each product runs its own Compose stack and database — they are separate entities.

## Local development

### 0) Shared env

```bash
cp .env.example .env
# edit secrets in .env — used by both frontend and backend
```

### 1) Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 7001 --reload
```

Or use the helper script:

```bash
cd backend
./run.sh
```

### 2) Run backend migrations

```bash
bash scripts/backend-migrate.sh
```

### 3) Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Set `BACKEND_URL` in the repo-root `.env` (loaded automatically by Next.js).

### Backend runtime (fixed)

`backend/run.sh` always starts FastAPI:

```bash
cd backend && APP_PORT=7001 ./run.sh
```

The script rejects `BACKEND_RUNTIME` values other than `fastapi`.

Development ports: frontend `7100` (`npm run dev`), backend `7001`. Open [http://127.0.0.1:7100/sign-in](http://127.0.0.1:7100/sign-in).

## Docker

```bash
docker compose up -d --build
docker compose exec backend sh -c 'for f in migrations/*.py; do python "$f"; done'
```

Frontend runs on `http://localhost:7070`, backend on `http://127.0.0.1:7071`.

## API notes

- CSRF cookie endpoint: `GET /sanctum/csrf-cookie`
- API routes: `/api/v1/*`
- OAuth + webhooks: `/auth/*`, `/webhooks/*`

See `docs/ARCHITECTURE.md` for full route and deployment details.

## Move from server to desktop (no git)

Two options — both skip `node_modules`, `.venv`, and `.next` (reinstalled by `local-setup.sh`).

### Option A — rsync pull (best for ongoing sync)

Run **on your desktop**:

```bash
# Clone this repo once (or copy scripts/sync-from-server.sh), then:
./scripts/sync-from-server.sh ubuntu@YOUR_SERVER /home/ubuntu/new_ig ~/projects/new_ig

# Include secrets + DB/uploads (recommended first time):
INCLUDE_ENV=1 INCLUDE_DATA=1 ./scripts/sync-from-server.sh ubuntu@YOUR_SERVER /home/ubuntu/new_ig ~/projects/new_ig

cd ~/projects/new_ig && bash scripts/local-setup.sh
```

### Option B — tarball (best for one-off / slow networks)

Run **on the server**:

```bash
./scripts/export-for-transfer.sh --include-env
# → ~/dukai-transfer-YYYYMMDD-HHMMSS.tar.gz
```

Download and set up **on your desktop**:

```bash
scp ubuntu@YOUR_SERVER:~/dukai-transfer-*.tar.gz .
./scripts/import-from-transfer.sh dukai-transfer-*.tar.gz ~/projects/new_ig
```

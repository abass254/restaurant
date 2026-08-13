# DukAI Merchants Frontend

Next.js merchant portal for DukAI Merchants. The primary route is **`/sign-in`**. All UI lives here; FastAPI is the API backend.

## Development

```bash
cd frontend
npm install
npm run dev
```

Reads the shared repo-root `../.env` for `BACKEND_URL` etc.

Runs at **http://127.0.0.1:7100** — open `/sign-in`.

Production (container / server mode):

- `npm run build`
- `npm start` (runs on **http://127.0.0.1:7070**)

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:7001` | FastAPI API (dev fallback) |
| `NEXT_PUBLIC_APP_URL` | `http://127.0.0.1:7100` | This frontend |

## FastAPI API

- OAuth: `{API_URL}/auth/instagram`
- JSON: `{API_URL}/api/v1/*`
- See [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

Run API + frontend together from repo root. The merchant UI starts at `/sign-in`.

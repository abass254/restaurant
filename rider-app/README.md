# DukAI Rider (Expo)

DoorDash Dasher–style rider app with **rich green** branding (`#0B7A3E`).

Talks to the same FastAPI rider endpoints as the Next.js `/r` PWA (`/api/v1/rider/*`), using a Bearer `session_token` (no cookie jar required on device).

## Configure

In `rider-app/.env`:

```bash
# Phone / Expo Go (recommended): public HTTPS host
EXPO_PUBLIC_API_URL=https://uat.dukai.app

# Local web only (same machine as the API):
# EXPO_PUBLIC_API_URL=http://127.0.0.1:7001

EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_key
```

On a physical phone, `127.0.0.1` is the phone itself — it will never reach your laptop/server. Use `https://uat.dukai.app` (or another public URL). Restart Expo after changing env.

CORS for Expo web includes `http://localhost:8081` / `http://127.0.0.1:8081` in `.env`.

## Screens

- Login (phone / email OTP via API; echoed code in dev when SMS is unavailable)
- Tabs: **Stores** (local pause UI seeded from linked merchant) · **Home** (Go Online) · **Earnings**
- Online (heartbeat) → New Order offer (Accept / Reject)
- Trip: To store → Arrived → Pickup → To customer → Deliver → Complete

## Run

```bash
cd rider-app
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press `w` for web.

### Demo path

1. Ensure backend is running and you have an onboarded rider phone/email
2. Login → Send code → Verify (use echoed code if shown)
3. **Go Online** → accept a real ready-order offer
4. Walk the trip CTAs → **Back online**

## Stack

Expo SDK 57 · Expo Router · TypeScript · React Native

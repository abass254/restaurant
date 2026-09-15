# DukAI WhatsApp agent (openWA)

Platform-level WhatsApp Web session for **order notifications and alerts**.
Merchants do not connect their own numbers — super admins link one DukAI
account from **Admin → WhatsApp**.

## Run

1. Set in repo-root `.env`:

```bash
OPENWA_AGENT_TOKEN=some-long-random-string
OPENWA_AGENT_URL=http://127.0.0.1:7010
OPENWA_AGENT_PORT=7010
OPENWA_ENABLED=true    # primary customer order notifier (requires linked session)
```

2. Start the agent:

```bash
./run.sh
```

3. Open Admin → WhatsApp. On first link, leave `OPENWA_HEADLESS=false` so a
   Chrome window opens — scan that QR (or the ASCII QR in the agent terminal).
   Prefer a dedicated business number. Keep the session up ~5 minutes after scanning.

Requires Node 18+, **Google Chrome** installed, and a machine that can keep
the process running.

`postinstall` patches `@open-wa/wa-automate@4.76` for:
- removed `window.Debug` hang after “Page loaded”
- Docker-only `customUserAgent` bug that forced Chrome/104 (WhatsApp’s
  “update Chrome” / no-QR screen)

Delete `.wa-session/` and restart after pulling these patches.

## Notes

- Unofficial client — ban risk; use a dedicated number when possible.
- Optional `OPENWA_LICENSE_KEY` if you have an openWA commercial license.
- Replace with Meta Cloud API later without merchant WhatsApp setup.

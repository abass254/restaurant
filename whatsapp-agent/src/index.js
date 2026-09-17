/**
 * DukAI platform WhatsApp agent (openWA).
 *
 * Holds one WhatsApp Web session for outbound notifications/alerts.
 * Merchants do not connect their own numbers — admins scan QR once here.
 *
 * Endpoints (Authorization: Bearer <AGENT_TOKEN>):
 *   GET  /health
 *   GET  /status
 *   POST /send          { to, text }
 *   POST /logout
 *   POST /restart
 */

"use strict";

const path = require("path");
const express = require("express");
const { create, ev } = require("@open-wa/wa-automate");

const PORT = Number(process.env.PORT || process.env.OPENWA_AGENT_PORT || 7010);
// 127.0.0.1 for local-only; 0.0.0.0 when the k8s backend must reach this host agent.
const BIND_HOST = (process.env.OPENWA_BIND_HOST || process.env.BIND_HOST || "127.0.0.1").trim() || "127.0.0.1";
const AGENT_TOKEN = (process.env.AGENT_TOKEN || process.env.OPENWA_AGENT_TOKEN || "").trim();
const SESSION_ID = (process.env.SESSION_ID || "dukai").trim() || "dukai";
const SESSION_DATA_PATH = path.resolve(
  process.env.SESSION_DATA_PATH || path.join(__dirname, "..", ".wa-session"),
);
const LICENSE_KEY = (process.env.OPENWA_LICENSE_KEY || "").trim() || undefined;
// Visible Chrome is more reliable for first-time QR (WhatsApp often stalls headless).
const HEADLESS = String(process.env.HEADLESS || "false").toLowerCase() === "true";
const USE_CHROME = String(process.env.USE_CHROME || "true").toLowerCase() !== "false";
const CHROME_PATH = (
  process.env.CHROME_PATH ||
  process.env.OPENWA_CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "")
).trim();
const PROTOCOL_TIMEOUT_MS = Number(process.env.PROTOCOL_TIMEOUT_MS || 180000);
// open-wa's default UA is Chrome/104 + WhatsApp/2.2147 — WhatsApp Web now shows
// "update Chrome" instead of a QR. Use a current desktop Chrome UA.
const CUSTOM_USER_AGENT = (
  process.env.OPENWA_USER_AGENT ||
  process.env.CUSTOM_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
).trim();

/** @type {import('@open-wa/wa-automate').Client | null} */
let client = null;
let starting = false;
let lastError = null;
/** @type {string | null} data-URL PNG */
let lastQr = null;
let connectedAt = null;
let hostNumber = null;

ev.on("qr.**", (qr, sessionId, namespace) => {
  if (typeof qr !== "string" || !qr) return;
  // Prefer PNG data-URLs for the admin <img>; ignore raw qrData strings that are not images.
  if (qr.startsWith("data:image") || qr.startsWith("http")) {
    lastQr = qr;
    console.log(`[whatsapp-agent] QR ready (${namespace || "qr"} session=${sessionId || SESSION_ID})`);
  } else if (!lastQr) {
    // Raw payload arrived before PNG — mark that auth QR exists even if UI image isn't ready yet.
    console.log(
      `[whatsapp-agent] QR payload received (${qr.length} chars). Waiting for PNG for Admin UI…`,
    );
  }
});

function requireAuth(req, res, next) {
  if (!AGENT_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: "AGENT_TOKEN is not set on the WhatsApp agent.",
    });
  }
  const header = req.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (req.get("x-agent-token") || "").trim();
  if (!token || token !== AGENT_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }
  return next();
}

function toChatId(to) {
  const digits = String(to || "").replace(/\D/g, "");
  if (!digits || digits.length < 8) return null;
  return `${digits}@c.us`;
}

function statusPayload() {
  const ready = Boolean(client);
  return {
    ok: true,
    ready,
    starting,
    // Prefer qr over starting so Admin can show the code while create() is still awaiting scan.
    state: ready ? "ready" : lastQr ? "qr" : starting ? "starting" : "offline",
    host_number: hostNumber,
    connected_at: connectedAt,
    has_qr: Boolean(lastQr),
    qr: lastQr,
    error: lastError,
    session_id: SESSION_ID,
    headless: HEADLESS,
  };
}

async function startClient() {
  if (client || starting) return;
  starting = true;
  lastError = null;
  try {
    const created = await create({
      sessionId: SESSION_ID,
      sessionDataPath: SESSION_DATA_PATH,
      multiDevice: true,
      headless: HEADLESS,
      useChrome: USE_CHROME,
      ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
      customUserAgent: CUSTOM_USER_AGENT,
      // Puppeteer merges unknown ConfigObject keys into launch(); raise CDP timeout.
      protocolTimeout: Number.isFinite(PROTOCOL_TIMEOUT_MS) ? PROTOCOL_TIMEOUT_MS : 180000,
      qrTimeout: 0,
      authTimeout: 0,
      cacheEnabled: false,
      disableSpins: true,
      // Print ASCII QR in this terminal as a fallback when Admin has no PNG yet.
      qrLogSkip: false,
      killProcessOnBrowserClose: true,
      throwErrorOnTosBlock: false,
      ...(LICENSE_KEY ? { licenseKey: LICENSE_KEY } : {}),
    });
    client = created;
    lastQr = null;
    connectedAt = new Date().toISOString();
    try {
      const host = await client.getHostNumber();
      hostNumber = host ? String(host).replace(/\D/g, "") : null;
    } catch {
      hostNumber = null;
    }
    client.onStateChanged((state) => {
      if (state === "CONFLICT" || state === "UNLAUNCHED") {
        lastError = `WhatsApp state: ${state}`;
      }
      if (state === "UNPAIRED" || state === "UNPAIRED_IDLE") {
        client = null;
        connectedAt = null;
        hostNumber = null;
        lastError = "Session unpaired. Scan the QR code again.";
      }
    });
    console.log(`[whatsapp-agent] ready session=${SESSION_ID} host=${hostNumber || "?"}`);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    client = null;
    console.error("[whatsapp-agent] failed to start:", lastError);
  } finally {
    starting = false;
  }
}

async function stopClient() {
  const current = client;
  client = null;
  connectedAt = null;
  hostNumber = null;
  if (!current) return;
  try {
    await current.kill();
  } catch (err) {
    console.warn("[whatsapp-agent] kill:", err instanceof Error ? err.message : err);
  }
}

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "dukai-whatsapp-agent" });
});

app.get("/status", requireAuth, (_req, res) => {
  res.json(statusPayload());
});

app.post("/send", requireAuth, async (req, res) => {
  if (!client) {
    return res.status(503).json({
      ok: false,
      error: lastQr
        ? "WhatsApp session waiting for QR scan."
        : "WhatsApp agent is not connected.",
    });
  }
  const text = String(req.body?.text || "").trim();
  const chatId = toChatId(req.body?.to);
  if (!chatId) {
    return res.status(422).json({ ok: false, error: "A valid WhatsApp number is required." });
  }
  if (!text) {
    return res.status(422).json({ ok: false, error: "Message text is required." });
  }
  try {
    const messageId = await client.sendText(chatId, text);
    return res.json({
      ok: true,
      message_id: messageId != null ? String(messageId) : null,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[whatsapp-agent] send failed:", error);
    return res.status(502).json({ ok: false, error });
  }
});

app.post("/check-number", requireAuth, async (req, res) => {
  if (!client) {
    return res.status(503).json({
      ok: false,
      error: lastQr
        ? "WhatsApp session waiting for QR scan."
        : "WhatsApp agent is not connected.",
    });
  }
  const chatId = toChatId(req.body?.phone || req.body?.to);
  if (!chatId) {
    return res.status(422).json({ ok: false, error: "A valid phone number is required." });
  }
  try {
    const registered = await client.isRegisteredUser(chatId);
    return res.json({
      ok: true,
      registered: Boolean(registered),
      jid: registered ? chatId : null,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[whatsapp-agent] check-number failed:", error);
    return res.status(502).json({ ok: false, error });
  }
});

app.post("/logout", requireAuth, async (_req, res) => {
  try {
    if (client) {
      try {
        await client.logout();
      } catch {
        /* ignore — kill below */
      }
    }
    await stopClient();
    lastQr = null;
    lastError = null;
    res.json({ ok: true, message: "Logged out." });
    setTimeout(() => {
      void startClient();
    }, 500);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, error });
  }
});

app.post("/restart", requireAuth, async (_req, res) => {
  await stopClient();
  lastQr = null;
  lastError = null;
  res.json({ ok: true, message: "Restarting session." });
  setTimeout(() => {
    void startClient();
  }, 300);
});

app.listen(PORT, BIND_HOST, () => {
  console.log(`[whatsapp-agent] listening on http://${BIND_HOST}:${PORT}`);
  if (!AGENT_TOKEN) {
    console.warn("[whatsapp-agent] AGENT_TOKEN is empty — API will reject requests.");
  }
  void startClient();
});

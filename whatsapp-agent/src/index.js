/**
 * TransChap platform WhatsApp agent (openWA).
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
const SESSION_ID = (process.env.SESSION_ID || "TransChap").trim() || "TransChap";
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
let hostUsername = null;

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
    host_name: hostUsername,
    host_username: hostUsername,
    connected_at: connectedAt,
    has_qr: Boolean(lastQr),
    qr: lastQr,
    error: lastError,
    session_id: SESSION_ID,
    headless: HEADLESS,
  };
}

async function fetchHostIdentity() {
  if (!client) return;
  try {
    const host = await client.getHostNumber();
    hostNumber = host ? String(host).replace(/\D/g, "") : null;
  } catch {
    // ignore
  }

  function isPhone(val) {
    if (!val) return false;
    const digits = String(val).replace(/\D/g, "");
    // If it consists almost entirely of digits, spaces, plus, dashes, parentheses
    return digits.length >= 7 && String(val).replace(/[\d\s+\-()]/g, "").length === 0;
  }

  try {
    const me = await client.getMe();
    console.log("[whatsapp-agent] getMe raw:", JSON.stringify(me));

    let directEval = null;
    try {
      directEval = await client.getPage().evaluate(() => {
        const conn = window.Store?.Conn;
        const pushname = conn?.pushname;
        const meObj = window.Store?.Me;
        const contact = meObj?.wid ? window.Store?.Contact?.get(meObj.wid) : null;
        return {
          connPushname: pushname || null,
          mePushname: meObj?.pushname || meObj?.attributes?.pushname || null,
          contactPushname: contact?.pushname || null,
          contactName: contact?.name || null,
          contactVerifiedName: contact?.verifiedName || null,
        };
      });
      console.log("[whatsapp-agent] directEval:", JSON.stringify(directEval));
    } catch (evalErr) {
      console.warn("[whatsapp-agent] directEval failed:", evalErr?.message || evalErr);
    }

    const candidates = [
      directEval?.connPushname,
      directEval?.contactPushname,
      directEval?.contactVerifiedName,
      directEval?.contactName,
      directEval?.mePushname,
      me?.pushname,
      me?.verifiedName,
      me?.name,
    ];

    let found = null;
    for (const c of candidates) {
      const s = String(c || "").trim();
      if (s && !isPhone(s)) {
        found = s;
        break;
      }
    }

    if (!found && hostNumber) {
      try {
        const contact = await client.getContact(`${hostNumber}@c.us`);
        console.log("[whatsapp-agent] contact raw:", JSON.stringify({
          pushname: contact?.pushname,
          name: contact?.name,
          verifiedName: contact?.verifiedName,
          formattedName: contact?.formattedName,
        }));
        for (const c of [contact?.pushname, contact?.verifiedName, contact?.name]) {
          const s = String(c || "").trim();
          if (s && !isPhone(s)) {
            found = s;
            break;
          }
        }
      } catch {}
    }

    hostUsername = found || null;
    console.log(`[whatsapp-agent] resolved hostUsername="${hostUsername}" hostNumber="${hostNumber}"`);
  } catch (err) {
    console.warn("[whatsapp-agent] error fetching host username:", err instanceof Error ? err.message : err);
  }
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
      killProcessOnBrowserClose: false,
      throwErrorOnTosBlock: false,
      ...(LICENSE_KEY ? { licenseKey: LICENSE_KEY } : {}),
    });
    client = created;
    lastQr = null;
    connectedAt = new Date().toISOString();
    await fetchHostIdentity();
    client.onStateChanged((state) => {
      if (state === "CONFLICT" || state === "UNLAUNCHED") {
        lastError = `WhatsApp state: ${state}`;
      }
      if (state === "UNPAIRED" || state === "UNPAIRED_IDLE") {
        client = null;
        connectedAt = null;
        hostNumber = null;
        hostUsername = null;
        lastError = "Session unpaired. Scan the QR code again.";
      }
    });
    console.log(`[whatsapp-agent] ready session=${SESSION_ID} host=${hostUsername || hostNumber || "?"}`);
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
  hostUsername = null;
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
  res.json({ ok: true, service: "TransChap-whatsapp-agent" });
});

app.get("/status", requireAuth, async (_req, res) => {
  if (client && !hostUsername) {
    await fetchHostIdentity();
  }
  res.json(statusPayload());
});

async function injectWapiBypass(c) {
  if (!c) return;
  try {
    const page = c.getPage();
    if (!page) return;
    await page.evaluate(() => {
      if (!window.WAPI) return;
      window.WAPI.sendMessage = async function (id, message) {
        if (id === "status@broadcast") return "Not able to send message to broadcast";
        let chat = window.WAPI.getChat(id);
        if (!chat || !chat.msgs || chat.msgs.models.length === 0) {
          try {
            const contactObj = window.Store?.Contact ? window.Store.Contact.get(id) : null;
            const targetWid = (contactObj && contactObj.id) || (window.Store?.WidFactory && window.Store.WidFactory.createWid(id)) || id;
            if (window.Store?.Chat && window.Store.Chat.find) {
              await window.Store.Chat.find(targetWid);
            }
            chat = window.WAPI.getChat(id);
          } catch (e) {
            console.warn("[wapi bypass] Chat.find failed:", e);
          }
        }
        if (chat !== undefined && chat.sendMessage) {
          return await chat.sendMessage(message).then((_) => chat.lastReceivedKey?._serialized || true);
        }
        return false;
      };
    });
  } catch (err) {
    console.warn("[whatsapp-agent] injectWapiBypass error:", err?.message || err);
  }
}

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

  await injectWapiBypass(client);

  try {
    const messageId = await client.sendText(chatId, text);
    if (!messageId || (typeof messageId === "string" && messageId.toLowerCase().includes("error"))) {
      const err = typeof messageId === "string" ? messageId : "Failed to deliver WhatsApp message.";
      console.warn(`[whatsapp-agent] sendText failed for ${chatId}: ${err}`);
      return res.status(422).json({ ok: false, error: err });
    }
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

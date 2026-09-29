"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { Skeleton } from "@/components/app/Skeleton";
import type {
  AdminWhatsappActionResponse,
  AdminWhatsappStatus,
  AdminWhatsappTestSendResponse,
} from "@/lib/types";

const DEFAULT_TEST_TEXT =
  "DukAI test message from Admin → WhatsApp (platform openWA session).";

const MESSAGE_TEMPLATES = [
  {
    label: "🛒 Order Confirmation",
    text: "Hello! Your DukAI order #1042 has been confirmed by the merchant. We will notify you when it ships!",
  },
  {
    label: "🚚 Delivery Notice",
    text: "Good news! Your DukAI delivery #1042 is on its way with rider Alex. Contact: 0712 345 678.",
  },
  {
    label: "⚡ System Heartbeat",
    text: "DukAI platform WhatsApp notification agent heartbeat test.",
  },
  {
    label: "💬 Customer Support",
    text: "Hi! This is a test message from DukAI Admin Support team.",
  },
];

export default function AdminWhatsappPage() {
  const [status, setStatus] = useState<AdminWhatsappStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"logout" | "restart" | null>(null);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState(DEFAULT_TEST_TEXT);
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    message: string;
    messageId?: string;
  } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const reloadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<AdminWhatsappStatus>(apiRoutes.adminWhatsappStatus);
      setStatus(data);
    } catch (err) {
      await showError(
        "Could not load WhatsApp status",
        extractErrorMessage(err, "Could not load WhatsApp agent status."),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadStatus();
  }, [reloadStatus]);

  useEffect(() => {
    if (!status) return;
    const needsPoll =
      status.starting || status.state === "qr" || (status.has_qr && !status.ready);
    if (!needsPoll) return;
    const id = window.setInterval(() => {
      void reloadStatus();
    }, 2500);
    return () => window.clearInterval(id);
  }, [status, reloadStatus]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const to = phone.trim();
    const body = text.trim();
    if (!to || !body) {
      await showError("Missing fields", "Enter a phone number and a message.");
    }
    setSending(true);
    setLastResult(null);
    try {
      const result = await apiFetch<AdminWhatsappTestSendResponse>(
        apiRoutes.adminWhatsappSend,
        {
          method: "POST",
          body: JSON.stringify({ phone: to, text: body }),
        },
      );
      setLastResult({
        ok: true,
        message: result.message,
        messageId: result.message_id || undefined,
      });
      await toastSuccess("WhatsApp test message sent!");
    } catch (err) {
      const message = extractErrorMessage(err, "WhatsApp agent did not send the message.");
      setLastResult({
        ok: false,
        message,
      });
      await showError("Send failed", message);
    } finally {
      setSending(false);
    }
  }

  async function runAction(kind: "logout" | "restart") {
    const ok = await confirmAction(
      kind === "logout" ? "Log out WhatsApp?" : "Restart session?",
      kind === "logout"
        ? "This unpairs the current number. You will need to scan a new QR code."
        : "The openWA agent will restart and may show a QR if the session is gone.",
      kind === "logout" ? "Log out" : "Restart",
    );
    if (!ok) return;
    setActing(kind);
    try {
      const route =
        kind === "logout" ? apiRoutes.adminWhatsappLogout : apiRoutes.adminWhatsappRestart;
      const result = await apiFetch<AdminWhatsappActionResponse>(route, { method: "POST" });
      await toastSuccess(result.message || (kind === "logout" ? "Logged out" : "Restarting"));
      setLoading(true);
      await reloadStatus();
    } catch (err) {
      await showError(
        kind === "logout" ? "Logout failed" : "Restart failed",
        err instanceof ApiError
          ? err.message
          : extractErrorMessage(err, "Action failed."),
      );
    } finally {
      setActing(null);
    }
  }

  function handleCopyScript() {
    void navigator.clipboard.writeText("cd whatsapp-agent && ./run.sh");
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  }

  // Derive status states for clean UI rendering
  const isReady = Boolean(status?.ready);
  const isQR = Boolean(status?.qr || status?.has_qr || status?.state === "qr");
  const isStarting = Boolean(status?.starting);
  const isOffline = !status?.reachable;

  let statusBadgeClass = "is-offline";
  let statusText = "Offline";
  let pulseClass = "is-offline";

  if (isReady) {
    statusBadgeClass = "is-online";
    statusText = "Connected & Ready";
    pulseClass = "is-online";
  } else if (isQR) {
    statusBadgeClass = "is-warning";
    statusText = "Scan QR Code";
    pulseClass = "is-warning";
  } else if (isStarting) {
    statusBadgeClass = "is-warning";
    statusText = "Starting Agent...";
    pulseClass = "is-warning";
  }

  const formattedTime = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="admin-page">
      {/* Executive Hero Banner */}
      <div className="admin-wa-hero">
        <div className="admin-wa-hero__head">
          <div className="admin-wa-hero__title-group">
            <div className="admin-wa-hero__icon">
              <i className="fa-brands fa-whatsapp" aria-hidden="true" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
                <h1 className="admin-page__title" style={{ margin: 0 }}>WhatsApp Gateway</h1>
                <span className={`admin-wa-hero__status-badge ${statusBadgeClass}`}>
                  <span className={`admin-wa-pulse ${pulseClass}`} />
                  {statusText}
                </span>
              </div>
              <p className="admin-page__lead" style={{ margin: 0 }}>
                Primary platform notification service for customer orders (openWA). Link one DukAI business phone number here.
              </p>
            </div>
          </div>

          <div className="admin-wa-hero__actions">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => {
                setLoading(true);
                void reloadStatus();
              }}
              disabled={loading}
            >
              <i className={`fa-solid fa-arrows-rotate ${loading ? "fa-spin" : ""}`} aria-hidden="true" />
              Refresh
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={acting !== null || loading}
              onClick={() => void runAction("restart")}
            >
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
              {acting === "restart" ? "Restarting…" : "Restart"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              disabled={acting !== null || loading || !isReady}
              onClick={() => void runAction("logout")}
            >
              <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
              {acting === "logout" ? "Logging out…" : "Unpair Device"}
            </button>
          </div>
        </div>
      </div>

      {/* System Health Metric Cards */}
      {loading && !status ? (
        <div className="admin-wa-health-grid">
          <Skeleton variant="text" height={90} />
          <Skeleton variant="text" height={90} />
          <Skeleton variant="text" height={90} />
          <Skeleton variant="text" height={90} />
        </div>
      ) : (
        <div className="admin-wa-health-grid">
          <div className="admin-wa-card">
            <div className="admin-wa-card__header">
              <p className="admin-wa-card__label">Agent Gateway</p>
              <i className="fa-solid fa-server admin-wa-card__icon" aria-hidden="true" />
            </div>
            <p className="admin-wa-card__value">{status?.agent_url || "http://localhost:7010"}</p>
            <p className="admin-wa-card__sub">
              {status?.reachable ? (
                <>
                  <i className="fa-solid fa-circle-check" style={{ color: "#25d366" }} /> Service Reachable
                </>
              ) : (
                <>
                  <i className="fa-solid fa-circle-xmark" style={{ color: "#ef4444" }} /> Agent Unreachable
                </>
              )}
            </p>
          </div>

          <div className="admin-wa-card">
            <div className="admin-wa-card__header">
              <p className="admin-wa-card__label">WhatsApp Username</p>
              <i className="fa-brands fa-whatsapp admin-wa-card__icon" aria-hidden="true" />
            </div>
            <p className="admin-wa-card__value">
              {status?.host_username || status?.host_name || (status?.ready ? "Connected User" : "Not linked")}
            </p>
            <p className="admin-wa-card__sub">
              <i className="fa-solid fa-shield-halved" /> {status?.configured ? "Token Authenticated" : "Token missing"}
            </p>
          </div>

          <div className="admin-wa-card">
            <div className="admin-wa-card__header">
              <p className="admin-wa-card__label">Order Alerts Engine</p>
              <i className="fa-solid fa-bell admin-wa-card__icon" aria-hidden="true" />
            </div>
            <p className="admin-wa-card__value">
              {status?.enabled ? "OPENWA_ENABLED=true" : "Disabled (Test Only)"}
            </p>
            <p className="admin-wa-card__sub">
              <i className="fa-solid fa-bolt" /> {status?.enabled ? "Live order alerts on" : "Alerts off"}
            </p>
          </div>

          <div className="admin-wa-card">
            <div className="admin-wa-card__header">
              <p className="admin-wa-card__label">Session Status</p>
              <i className="fa-solid fa-signal admin-wa-card__icon" aria-hidden="true" />
            </div>
            <p className="admin-wa-card__value" style={{ textTransform: "capitalize" }}>
              {status?.state || "offline"}
            </p>
            <p className="admin-wa-card__sub">
              <i className="fa-solid fa-clock" /> {status?.connected_at ? `Linked ${status.connected_at}` : "No active session"}
            </p>
          </div>
        </div>
      )}

      {/* Warnings & Notices */}
      {(status?.agent_error || status?.error) && (
        <div className="admin-wa-result-card is-error" style={{ marginBottom: "1.5rem" }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ color: "#dc2626", fontSize: "1.25rem" }} />
          <div>
            <strong style={{ display: "block", marginBottom: "0.2rem" }}>WhatsApp Agent Issue</strong>
            <p style={{ margin: 0, fontSize: "0.88rem" }}>{status.agent_error || status.error}</p>
          </div>
        </div>
      )}

      {/* QR Code Onboarding Section (When scanning is required) */}
      {status?.qr && !status.ready ? (
        <section className="admin-section" style={{ marginBottom: "1.5rem" }}>
          <div className="admin-section__head">
            <h2 className="admin-section__title">
              <i className="fa-solid fa-qrcode" style={{ color: "#128c7e", marginRight: "0.5rem" }} />
              Link WhatsApp Business Account
            </h2>
          </div>
          <div className="admin-wa-qr-container">
            <div className="admin-wa-qr__code-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={status.qr}
                alt="WhatsApp QR code"
                width={240}
                height={240}
                className="admin-wa-qr__image"
              />
              <span className="admin-chip" style={{ background: "rgba(37, 211, 102, 0.15)", color: "#128c7e" }}>
                <i className="fa-solid fa-spin fa-circle-notch" style={{ marginRight: "0.35rem" }} />
                Listening for scan...
              </span>
            </div>

            <div className="admin-wa-qr__steps">
              <div className="admin-wa-qr__step">
                <div className="admin-wa-qr__step-num">1</div>
                <div className="admin-wa-qr__step-content">
                  <h4>Open WhatsApp on your phone</h4>
                  <p>Open WhatsApp or WhatsApp Business on your primary platform device.</p>
                </div>
              </div>

              <div className="admin-wa-qr__step">
                <div className="admin-wa-qr__step-num">2</div>
                <div className="admin-wa-qr__step-content">
                  <h4>Navigate to Linked Devices</h4>
                  <p>Tap <strong>Menu</strong> (Android three dots) or <strong>Settings</strong> (iOS) → <strong>Linked Devices</strong>.</p>
                </div>
              </div>

              <div className="admin-wa-qr__step">
                <div className="admin-wa-qr__step-num">3</div>
                <div className="admin-wa-qr__step-content">
                  <h4>Scan this QR Code</h4>
                  <p>Tap <strong>Link a Device</strong> and point your phone camera at this screen to pair.</p>
                </div>
              </div>

              <div className="admin-wa-qr__step">
                <div className="admin-wa-qr__step-num">4</div>
                <div className="admin-wa-qr__step-content">
                  <h4>Automatic Synchronization</h4>
                  <p>The system will automatically recognize the pairing and unlock live order notifications.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Interactive Test Sender + Live WhatsApp Chat Bubble Preview */}
      <section className="admin-section" style={{ marginBottom: "1.5rem" }}>
        <div className="admin-section__head">
          <h2 className="admin-section__title">
            <i className="fa-solid fa-paper-plane" style={{ color: "#128c7e", marginRight: "0.5rem" }} />
            Test Message Composer
          </h2>
        </div>

        <div className="admin-wa-composer-layout">
          {/* Left Column: Form & Presets */}
          <form className="admin-wa-form" onSubmit={(event) => void onSubmit(event)}>
            <label className="admin-whatsapp-form__field">
              <span className="admin-field-label">
                Recipient Phone Number <span style={{ color: "#dc2626" }}>*</span>
              </span>
              <div style={{ position: "relative" }}>
                <i
                  className="fa-solid fa-phone"
                  style={{
                    position: "absolute",
                    left: "1rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--color-text-subtle)",
                    fontSize: "0.85rem",
                  }}
                />
                <input
                  className="admin-input"
                  style={{ paddingLeft: "2.5rem" }}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0712 345 678 or +254712345678"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                />
              </div>
            </label>

            <div>
              <span className="admin-field-label">Quick Message Presets</span>
              <div className="admin-wa-template-chips">
                {MESSAGE_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.label}
                    type="button"
                    className="admin-wa-chip-btn"
                    onClick={() => setText(tmpl.text)}
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="admin-whatsapp-form__field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="admin-field-label">Message Content</span>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-subtle)" }}>
                  {text.length} characters
                </span>
              </div>
              <textarea
                className="admin-input"
                rows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
              />
            </label>

            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={sending || !isReady}
              style={{
                background: isReady ? "linear-gradient(135deg, #25d366 0%, #128c7e 100%)" : undefined,
                border: "none",
                fontWeight: 700,
                padding: "0.75rem 1.5rem",
              }}
            >
              {sending ? (
                <>
                  <i className="fa-solid fa-spin fa-circle-notch" aria-hidden="true" />
                  Sending Test Message...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-paper-plane" aria-hidden="true" />
                  Send Test WhatsApp Message
                </>
              )}
            </button>

            {!isReady && (
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-subtle)" }}>
                <i className="fa-solid fa-info-circle" /> Connect WhatsApp agent first to enable live message dispatch.
              </p>
            )}
          </form>

          {/* Right Column: Live WhatsApp Chat Preview */}
          <div className="admin-wa-preview-card">
            <div className="admin-wa-preview-card__header">
              <div className="admin-wa-preview-card__avatar">
                <i className="fa-solid fa-store" />
              </div>
              <div className="admin-wa-preview-card__name-box">
                <span className="admin-wa-preview-card__name">DukAI Merchant Notifier</span>
                <span className="admin-wa-preview-card__status">Official WhatsApp Business</span>
              </div>
            </div>

            <div className="admin-wa-preview-card__body">
              <div className="admin-wa-chat-bubble">
                {text || "Type a message on the left to see live preview..."}
                <div className="admin-wa-chat-bubble__meta">
                  <span>{formattedTime}</span>
                  <i className="fa-solid fa-check-double" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Send Result Banner */}
        {lastResult && (
          <div
            className={`admin-wa-result-card ${lastResult.ok ? "is-success" : "is-error"}`}
            style={{ marginTop: "1.25rem" }}
          >
            <i
              className={`fa-solid ${lastResult.ok ? "fa-circle-check" : "fa-triangle-exclamation"}`}
              style={{ color: lastResult.ok ? "#25d366" : "#dc2626", fontSize: "1.25rem", marginTop: "0.1rem" }}
            />
            <div>
              <strong style={{ display: "block", marginBottom: "0.2rem" }}>
                {lastResult.ok ? "Message Sent Successfully" : "Send Failed"}
              </strong>
              <p style={{ margin: 0, fontSize: "0.88rem" }}>{lastResult.message}</p>
              {lastResult.messageId && (
                <code
                  style={{
                    display: "inline-block",
                    marginTop: "0.4rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "6px",
                    background: "rgba(0,0,0,0.06)",
                    fontSize: "0.78rem",
                  }}
                >
                  ID: {lastResult.messageId}
                </code>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Diagnostics & Terminal Instructions Drawer */}
      <section className="admin-section">
        <div className="admin-section__head" style={{ cursor: "pointer" }} onClick={() => setShowDiagnostics((prev) => !prev)}>
          <h2 className="admin-section__title">
            <i className="fa-solid fa-terminal" style={{ marginRight: "0.5rem", color: "var(--color-text-subtle)" }} />
            Developer & Terminal Diagnostics
          </h2>
          <button type="button" className="admin-btn admin-btn--ghost" style={{ padding: "0.2rem 0.6rem" }}>
            <i className={`fa-solid ${showDiagnostics ? "fa-chevron-up" : "fa-chevron-down"}`} />
          </button>
        </div>

        {showDiagnostics && (
          <div className="admin-wa-diag">
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
              To start or restart the local openWA agent manually from your shell:
            </p>
            <div className="admin-wa-code-snippet">
              <code>cd whatsapp-agent && ./run.sh</code>
              <button type="button" className="admin-wa-copy-btn" onClick={handleCopyScript}>
                <i className={`fa-solid ${copiedScript ? "fa-check" : "fa-copy"}`} />
                {copiedScript ? " Copied!" : " Copy"}
              </button>
            </div>
            <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.2rem", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
              <li>Default Agent Port: <code>7010</code> (Configured via <code>OPENWA_URL</code> in <code>.env</code>).</li>
              <li>QR Headless Mode: Set <code>OPENWA_HEADLESS=false</code> to view Chrome window during debugging.</li>
              <li>Order Alerts Toggle: Set <code>OPENWA_ENABLED=true</code> to dispatch automatic SMS/WhatsApp alerts on new checkout.</li>
            </ul>
          </div>
        )}
      </section>
    </section>
  );
}

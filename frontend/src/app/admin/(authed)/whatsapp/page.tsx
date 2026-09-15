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

export default function AdminWhatsappPage() {
  const [status, setStatus] = useState<AdminWhatsappStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"logout" | "restart" | null>(null);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState(DEFAULT_TEST_TEXT);
  const [lastResult, setLastResult] = useState<string | null>(null);

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
      return;
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
      const extra = result.message_id ? ` Message id ${result.message_id}.` : "";
      setLastResult(`${result.message}${extra}`);
      await toastSuccess("WhatsApp test sent");
    } catch (err) {
      const message = extractErrorMessage(err, "WhatsApp agent did not send the message.");
      setLastResult(message);
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

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">WhatsApp</h1>
          <p className="admin-page__lead">
            Primary customer order WhatsApp notifier (openWA) until Meta Cloud API.
            Merchants do not connect their own WhatsApp — link one DukAI number here.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">{status?.state ?? "…"}</span>
          <span className="admin-chip">
            {status?.enabled ? "Alerts on" : "Alerts off"}
          </span>
          <span className="admin-chip">
            {status?.configured ? "Token set" : "Token missing"}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => {
              setLoading(true);
              void reloadStatus();
            }}
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={acting !== null}
            onClick={() => void runAction("restart")}
          >
            {acting === "restart" ? "Restarting…" : "Restart"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            disabled={acting !== null}
            onClick={() => void runAction("logout")}
          >
            {acting === "logout" ? "Logging out…" : "Log out"}
          </button>
        </div>
      </header>

      <section className="admin-section">
        <div className="admin-section__head">
          <h2 className="admin-section__title">Session</h2>
        </div>
        {loading && !status ? (
          <Skeleton variant="text" height={96} />
        ) : (
          <>
            <div className="admin-kv">
              <div>
                <p className="admin-field-label">Agent URL</p>
                <code>{status?.agent_url || "—"}</code>
              </div>
              <div>
                <p className="admin-field-label">Host number</p>
                <code>{status?.host_number || "not linked"}</code>
              </div>
              <div>
                <p className="admin-field-label">Connected at</p>
                <code>{status?.connected_at || "—"}</code>
              </div>
              <div>
                <p className="admin-field-label">Order alerts</p>
                <code>
                  {status?.enabled
                    ? "OPENWA_ENABLED=true"
                    : "OPENWA_ENABLED=false (test send still works when ready)"}
                </code>
              </div>
            </div>
            {(status?.agent_error || status?.error) && (
              <p className="admin-tigo-notice" role="status">
                {status.agent_error || status.error}
              </p>
            )}
            {!status?.reachable && status?.configured ? (
              <p className="admin-tigo-notice" role="status">
                Start the agent with <code>whatsapp-agent/run.sh</code> (default port 7010).
              </p>
            ) : null}
            {status?.reachable && status?.starting && !status?.qr && !status?.ready ? (
              <p className="admin-tigo-notice" role="status">
                Agent is starting WhatsApp Web. With{" "}
                <code>OPENWA_HEADLESS=false</code>, scan the QR in the Chrome window
                that opens (or the ASCII QR in the agent terminal). Free RAM if the
                agent times out before a code appears.
              </p>
            ) : null}
            {status?.qr && !status.ready ? (
              <div className="admin-whatsapp-qr">
                <h3 className="admin-section__title">Scan to link WhatsApp</h3>
                <p className="admin-section__lead">
                  Open WhatsApp → Linked devices → Link a device, then scan this code.
                  Prefer a dedicated business number.
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={status.qr}
                  alt="WhatsApp QR code"
                  width={280}
                  height={280}
                  className="admin-whatsapp-qr__image"
                />
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section__head">
          <h2 className="admin-section__title">Test send</h2>
        </div>
        <form className="admin-whatsapp-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="admin-whatsapp-form__field">
            <span className="admin-field-label">Recipient number</span>
            <input
              className="admin-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0712 345 678 or +254712345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
          </label>
          <label className="admin-whatsapp-form__field">
            <span className="admin-field-label">Message</span>
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
            disabled={sending || !status?.ready}
          >
            {sending ? "Sending…" : "Send test message"}
          </button>
          {lastResult ? <p className="admin-page__footnote">{lastResult}</p> : null}
        </form>
      </section>
    </section>
  );
}

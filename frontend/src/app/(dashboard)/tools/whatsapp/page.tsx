"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { isInternalToolsUser } from "@/lib/internal-tools-access";
import { Skeleton } from "@/components/app/Skeleton";
import type { WhatsappTestSendResponse, WhatsappToolsStatus } from "@/lib/types";

const DEFAULT_TEST_TEXT = "DukAI test message from Tools → WhatsApp.";

export default function ToolsWhatsappPage() {
  const user = useAuthUser();
  const router = useRouter();
  const allowed = isInternalToolsUser(user);
  const [status, setStatus] = useState<WhatsappToolsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState(DEFAULT_TEST_TEXT);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const reloadStatus = useCallback(async () => {
    if (!allowed) return;
    try {
      const data = await apiFetch<WhatsappToolsStatus>(apiRoutes.whatsappToolsStatus);
      setStatus(data);
    } catch (err) {
      await showError(
        "Could not load Wasender status",
        extractErrorMessage(err, "Could not load Wasender status."),
      );
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) {
      router.replace("/tools/starters");
    }
  }, [allowed, router]);

  useEffect(() => {
    void reloadStatus();
  }, [reloadStatus]);

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
      const result = await apiFetch<WhatsappTestSendResponse>(apiRoutes.whatsappToolsSend, {
        method: "POST",
        body: JSON.stringify({ phone: to, text: body }),
      });
      const extra = result.message_id ? ` Message id ${result.message_id}.` : "";
      setLastResult(`${result.message}${extra}`);
      await toastSuccess("WhatsApp test sent");
    } catch (err) {
      const message = extractErrorMessage(err, "Wasender did not send the message.");
      setLastResult(message);
      await showError("Send failed", message);
    } finally {
      setSending(false);
    }
  }

  if (!allowed) return null;

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">WhatsApp</h1>
          <p className="app-lead">
            Send a test message through WasenderAPI. Order alerts use the same
            session when WASENDER_ENABLED is on.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setLoading(true);
            void reloadStatus();
          }}
          title="Refresh Wasender status"
        >
          <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          Refresh
        </button>
      </header>

      {loading && !status ? (
        <Skeleton variant="rect" className="inventory-skeleton" height={180} />
      ) : (
        <dl className="whatsapp-tools-status">
          <div>
            <dt>Session key</dt>
            <dd>
              <span
                className={`payment-status-pill ${status?.configured ? "is-success" : "is-pending"}`}
              >
                {status?.configured ? "Configured" : "Missing WASENDER_API_KEY"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Order alerts</dt>
            <dd>
              <span
                className={`payment-status-pill ${status?.enabled ? "is-success" : "is-pending"}`}
              >
                {status?.enabled ? "On" : "Off — test send still works if configured"}
              </span>
            </dd>
          </div>
        </dl>
      )}

      <form
        className="settings-form settings-form--compact whatsapp-tools-form"
        onSubmit={(event) => void onSubmit(event)}
      >
        <label className="settings-field">
          <span>Customer WhatsApp number</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0712 345 678 or +254712345678"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />
        </label>
        <label className="settings-field">
          <span>Message</span>
          <textarea
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
            maxLength={2000}
          />
        </label>
        <div className="settings-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={sending || !status?.ready}
          >
            {sending ? "Sending…" : "Send test message"}
          </button>
        </div>
      </form>

      {lastResult ? <p className="app-muted whatsapp-tools-result">{lastResult}</p> : null}
    </section>
  );
}

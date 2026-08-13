"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";

type TestEmailResponse = {
  message: string;
  recipient: string;
  from_address: string;
};

export function EmailTestSection() {
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      const data = await apiFetch<TestEmailResponse>(apiRoutes.adminTestEmail, {
        method: "POST",
        body: JSON.stringify({ recipient: recipient.trim() || null }),
      });
      await toastSuccess(data.message);
    } catch (err) {
      await showError("Could not send test email", extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-envelope settings-card__icon" aria-hidden="true" />
          <h2>Email (Mailtrap)</h2>
        </div>
        <span className="settings-pill settings-pill--neutral">no-reply@dukai.app</span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Send a test email from <code>no-reply@dukai.app</code> to confirm Mailtrap delivery is
          working. Leave the field blank to send to your own admin email.
        </p>
        <form
          className="settings-form settings-form--compact"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <label className="settings-field">
            <span>Recipient (optional)</span>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
            />
          </label>
          <div className="settings-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={sending}>
              <i className="fa-solid fa-paper-plane" aria-hidden="true" />
              {sending ? "Sending…" : "Send test email"}
            </button>
          </div>
        </form>
      </div>
    </article>
  );
}

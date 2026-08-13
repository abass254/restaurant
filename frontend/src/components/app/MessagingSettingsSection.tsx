"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { MessagingSettingsResponse } from "@/lib/types";
import { Skeleton } from "./Skeleton";

export function MessagingSettingsSection() {
  const [waitDmTimeSeconds, setWaitDmTimeSeconds] = useState("10");
  const [allowAutoResponses, setAllowAutoResponses] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggleSaving, setToggleSaving] = useState(false);

  useEffect(() => {
    void apiFetch<MessagingSettingsResponse>(apiRoutes.messagingSettings)
      .then((data) => {
        setWaitDmTimeSeconds(String(data.settings.wait_dm_time_seconds));
        setAllowAutoResponses(!(data.settings.pause_auto_responses ?? false));
      })
      .catch(() => {
        setWaitDmTimeSeconds("10");
        setAllowAutoResponses(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  async function persistSettings(
    waitSeconds: number,
    allowAuto: boolean,
    options?: { toast?: boolean },
  ) {
    const data = await apiFetch<MessagingSettingsResponse>(apiRoutes.messagingSettings, {
      method: "PUT",
      body: JSON.stringify({
        wait_dm_time_seconds: waitSeconds,
        pause_auto_responses: !allowAuto,
      }),
    });
    setWaitDmTimeSeconds(String(data.settings.wait_dm_time_seconds));
    setAllowAutoResponses(!(data.settings.pause_auto_responses ?? false));
    if (options?.toast) {
      toastSuccess(allowAuto ? "Auto-replies enabled." : "Auto-replies disabled.");
    }
  }

  async function handleAutoResponsesToggle(enabled: boolean) {
    const parsed = Number(waitDmTimeSeconds.trim());
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3600) {
      showError("Enter a valid wait time before changing auto-replies.");
      return;
    }

    setAllowAutoResponses(enabled);
    setToggleSaving(true);
    try {
      await persistSettings(parsed, enabled, { toast: true });
    } catch (err) {
      setAllowAutoResponses(!enabled);
      showError(extractErrorMessage(err, "Could not update auto-replies setting."));
    } finally {
      setToggleSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(waitDmTimeSeconds.trim());
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3600) {
      showError("Enter a wait time between 1 and 3600 seconds.");
      return;
    }

    setSaving(true);
    try {
      await persistSettings(parsed, allowAutoResponses, { toast: true });
    } catch (err) {
      showError(extractErrorMessage(err, "Could not save messaging settings."));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div className="settings-card">
        <Skeleton variant="text" width="60%" height={20} />
        <Skeleton variant="text" width="40%" height={36} />
      </div>
    );
  }

  return (
    <article className="settings-card">
      <div className="settings-card__body">
        <div className="settings-toggle settings-toggle--compact admin-messaging-toggle">
          <div className="settings-toggle__copy">
            <strong>Allow auto-replies</strong>
            <span>
              {allowAutoResponses
                ? "The selected DM bot, auto-replies, and conversation starters are active."
                : "Only the ticket greeting and inactivity close message are sent."}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={allowAutoResponses}
            className={`settings-toggle__switch${allowAutoResponses ? " is-on" : ""}`}
            disabled={toggleSaving || saving}
            onClick={() => void handleAutoResponsesToggle(!allowAutoResponses)}
          >
            <span className="settings-toggle__thumb" aria-hidden="true" />
            <span className="sr-only">
              {allowAutoResponses ? "Disable auto-replies" : "Enable auto-replies"}
            </span>
          </button>
        </div>

        <p className="settings-card__lead">
          When someone DMs on Instagram, the selected bot sends your greeting and waits for a
          reply. If they stay silent for this long, the close message is sent and the ticket is
          marked closed until they message again.
        </p>
        <form className="settings-form settings-form--compact" onSubmit={handleSubmit}>
          <div className="settings-form__row">
            <label className="settings-field">
              <span>Wait time after greeting (seconds)</span>
              <input
                type="number"
                min={1}
                max={3600}
                step={1}
                value={waitDmTimeSeconds}
                onChange={(event) => setWaitDmTimeSeconds(event.target.value)}
                disabled={saving || toggleSaving}
              />
            </label>
          </div>
          <p className="settings-card__hint">
            <i className="fas fa-circle-info" aria-hidden="true" />
            Default is 10 seconds. Use a higher value in production so customers have time to
            type a reply.
          </p>
          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving || toggleSaving}
            >
              {saving ? "Saving…" : "Save wait time"}
            </button>
          </div>
        </form>
      </div>
    </article>
  );
}

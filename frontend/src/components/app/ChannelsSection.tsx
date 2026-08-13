"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { SettingsCardSkeleton } from "@/components/app/LoadingStates";
import { apiRoutes, resolveSameOriginUrl } from "@/lib/config";
import type {
  Channel,
  ChannelsResponse,
  ConnectChannelResponse,
  InstagramBetaEvent,
} from "@/lib/types";
import { ApiError } from "@/lib/api";

type Props = {
  /** Optional: filter to a single platform's card (used elsewhere). */
  onlyPlatform?: string;
};

export function ChannelsSection({ onlyPlatform }: Props) {
  const [data, setData] = useState<ChannelsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeForm, setActiveForm] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await apiFetch<ChannelsResponse>(apiRoutes.channels);
      setData(res);
    } catch (err) {
      await showError("Could not load channels", extractErrorMessage(err));
    } finally {
      setLoaded(true);
    }
  }

  async function handleDisconnect(channel: Channel) {
    const confirmed = await confirmAction(
      `Remove ${channel.label}?`,
      "This will detach the account from your platform. You can reconnect any time.",
      "Yes, remove",
    );
    if (!confirmed) return;

    try {
      await apiFetch(apiRoutes.disconnectChannel(channel.platform), {
        method: "DELETE",
      });
      await toastSuccess(`${channel.label} removed`);
      await load();
    } catch (err) {
      await showError("Could not remove", extractErrorMessage(err));
    }
  }

  if (!loaded) {
    return <SettingsCardSkeleton />;
  }

  if (!data) return null;

  const channels = onlyPlatform
    ? data.channels.filter((c) => c.platform === onlyPlatform)
    : data.channels;

  return (
    <article className="settings-card" id="channels">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-plug settings-card__icon" aria-hidden="true" />
          <h2>Channels</h2>
        </div>
        <span
          className={`settings-pill ${
            data.any_connected ? "settings-pill--ok" : "settings-pill--warn"
          }`}
        >
          {data.connected_count} connected
        </span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Connect the social channels you want to manage. Instagram supports
          full live messaging today; others can be saved as a placeholder until
          their integrations launch.
        </p>

        <div className="channels-grid">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.platform}
              channel={channel}
              canManage={data.can_manage}
              officialInstagramUsername={data.official_instagram_username ?? null}
              betaEvents={data.instagram_beta_events ?? []}
              pendingChallenge={data.instagram_beta_pending_challenge ?? null}
              isFormOpen={activeForm === channel.platform}
              onOpenForm={() => setActiveForm(channel.platform)}
              onCloseForm={() => setActiveForm(null)}
              onConnected={() => {
                setActiveForm(null);
                void load();
              }}
              onDisconnect={() => void handleDisconnect(channel)}
            />
          ))}
        </div>

        {!data.can_manage ? (
          <p className="settings-muted settings-card__hint">
            <i className="fa-solid fa-lock" aria-hidden="true" /> Only platform
            admins can connect or remove channels.
          </p>
        ) : null}
      </div>
    </article>
  );
}

type CardProps = {
  channel: Channel;
  canManage: boolean;
  officialInstagramUsername: string | null;
  betaEvents: InstagramBetaEvent[];
  pendingChallenge: InstagramBetaEvent | null;
  isFormOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  onConnected: () => void;
  onDisconnect: () => void;
};

function betaEventLabel(event: InstagramBetaEvent): string {
  switch (event.event_type) {
    case "connect_started":
      return "Connect started";
    case "challenge_required":
      return "Verification code sent";
    case "challenge_submitted":
      return "Code submitted";
    case "connect_succeeded":
      return "Connected";
    case "connect_failed":
      return "Connect failed";
    case "outbound_sent":
      return "Message sent";
    case "outbound_failed":
      return "Message failed";
    case "session_invalid":
      return "Session expired";
    default:
      return event.event_type.replaceAll("_", " ");
  }
}

function BetaEventLog({
  events,
  pendingChallenge,
}: {
  events: InstagramBetaEvent[];
  pendingChallenge: InstagramBetaEvent | null;
}) {
  if (!events.length && !pendingChallenge) {
    return null;
  }

  return (
    <div className="channel-card__events">
      {pendingChallenge ? (
        <p className="channel-card__event channel-card__event--pending" role="status">
          <i className="fa-solid fa-shield-halved" aria-hidden="true" />
          Instagram sent a verification code
          {pendingChallenge.metadata?.challenge_type === "two_factor"
            ? " (authenticator app)"
            : ""}
          . Enter it below to finish connecting.
        </p>
      ) : null}
      {events.length > 0 ? (
        <ul className="channel-card__event-list">
          {events.slice(0, 5).map((event) => (
            <li key={event.id} className={`channel-card__event is-${event.status}`}>
              <span>{betaEventLabel(event)}</span>
              {event.message ? <span>{event.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChannelCard({
  channel,
  canManage,
  officialInstagramUsername,
  betaEvents,
  pendingChallenge,
  isFormOpen,
  onOpenForm,
  onCloseForm,
  onConnected,
  onDisconnect,
}: CardProps) {
  const isBeta = channel.platform === "instagram_beta";
  const betaUsername =
    channel.linked_instagram_username ??
    officialInstagramUsername ??
    channel.account?.username ??
    "";
  const [username, setUsername] = useState(betaUsername);
  const [displayName, setDisplayName] = useState(channel.account?.name ?? "");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [needsChallenge, setNeedsChallenge] = useState(
    pendingChallenge?.event_type === "challenge_required",
  );
  const [challengeEventId, setChallengeEventId] = useState<string | null>(
    pendingChallenge?.id ?? null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isBeta && betaUsername) {
      setUsername(betaUsername);
    }
  }, [isBeta, betaUsername, isFormOpen]);

  useEffect(() => {
    if (pendingChallenge?.event_type === "challenge_required") {
      setNeedsChallenge(true);
      setChallengeEventId(pendingChallenge.id);
    }
  }, [pendingChallenge]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (isBeta) {
        await apiFetch<ConnectChannelResponse>(apiRoutes.connectInstagramBeta, {
          method: "POST",
          body: JSON.stringify({
            password,
            username: betaUsername || undefined,
            verification_code: verificationCode || undefined,
          }),
        });
      } else {
        await apiFetch<ConnectChannelResponse>(
          apiRoutes.connectChannel(channel.platform),
          {
            method: "POST",
            body: JSON.stringify({
              username: username.replace(/^@/, ""),
              display_name: displayName || undefined,
            }),
          },
        );
      }
      setPassword("");
      setVerificationCode("");
      setNeedsChallenge(false);
      await toastSuccess(`${channel.label} saved`);
      onConnected();
    } catch (err) {
      if (isBeta && err instanceof ApiError && err.status === 428) {
        setNeedsChallenge(true);
        const payload = err.payload as { detail?: { event_id?: string; message?: string } } | undefined;
        const detail = payload?.detail;
        if (detail && typeof detail === "object" && detail.event_id) {
          setChallengeEventId(detail.event_id);
        }
        await showError(
          "Verification required",
          detail && typeof detail === "object" && detail.message
            ? detail.message
            : "Instagram sent a verification code. Enter it below and submit again.",
        );
        onConnected();
        return;
      }
      const message = extractErrorMessage(err);
      await showError("Could not save", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`channel-card${channel.connected ? " is-connected" : ""}`}
      data-platform={channel.platform}
    >
      <div
        className="channel-card__logo"
        style={{ background: channel.color }}
        aria-hidden="true"
      >
        <i className={channel.icon} />
      </div>
      <div className="channel-card__body">
        <div className="channel-card__head">
          <h3 className="channel-card__title">{channel.label}</h3>
          <span
            className={`settings-pill ${
              channel.connected ? "settings-pill--ok" : "settings-pill--off"
            }`}
          >
            {channel.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="channel-card__tagline">{channel.tagline}</p>

        {channel.connected && channel.account ? (
          <p className="channel-card__handle">
            <i className="fa-solid fa-circle-user" aria-hidden="true" />
            <strong>@{channel.account.username ?? "—"}</strong>
            {channel.account.name ? <span>{channel.account.name}</span> : null}
          </p>
        ) : (
          <p className="channel-card__status">{channel.status_text}</p>
        )}

        {isBeta ? (
          <BetaEventLog events={betaEvents} pendingChallenge={pendingChallenge} />
        ) : null}

        {isFormOpen ? (
          <form
            className="channel-card__form"
            onSubmit={(e) => void handleSubmit(e)}
          >
            {isBeta ? (
              <p className="settings-muted channel-card__status">
                Sign in with the password for{" "}
                <strong>@{betaUsername || "your connected Instagram account"}</strong>.
                Used only to send replies until Meta App Review completes.
              </p>
            ) : null}
            {!isBeta ? (
              <label className="settings-field">
                <span>{channel.label} username / handle</span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/^@/, ""))}
                  placeholder={
                    channel.platform === "whatsapp"
                      ? "+254712345678"
                      : "your_handle"
                  }
                />
              </label>
            ) : betaUsername ? (
              <label className="settings-field">
                <span>Instagram account</span>
                <input type="text" value={`@${betaUsername}`} readOnly disabled />
              </label>
            ) : (
              <p className="settings-muted channel-card__status">
                Connect your official Instagram account via Meta first, then return here.
              </p>
            )}
            {isBeta ? (
              <>
                {betaUsername ? (
                  <label className="settings-field">
                    <span>Instagram password</span>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                ) : null}
                {needsChallenge ? (
                  <label className="settings-field">
                    <span>Verification code</span>
                    <input
                      type="text"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      placeholder="6-digit code from Instagram"
                    />
                    {challengeEventId ? (
                      <span className="settings-muted">
                        Tracking event {challengeEventId.slice(0, 8)}…
                      </span>
                    ) : null}
                  </label>
                ) : null}
              </>
            ) : (
              <label className="settings-field">
                <span>Display name (optional)</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Business name"
                />
              </label>
            )}
            <div className="channel-card__actions">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={saving || (isBeta && !betaUsername)}
              >
                {saving ? "Saving…" : channel.connected ? "Update" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onCloseForm}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="channel-card__actions">
            {channel.connected ? (
              <>
                {channel.supports_oauth && channel.connect_url ? (
                  <a
                    href={resolveSameOriginUrl(channel.connect_url)}
                    className="btn btn-primary btn-sm"
                  >
                    <i className="fa-solid fa-rotate" aria-hidden="true" />
                    Reconnect via OAuth
                  </a>
                ) : (
                  canManage && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={onOpenForm}
                    >
                      <i className="fa-solid fa-pen" aria-hidden="true" />
                      Edit
                    </button>
                  )
                )}
                {canManage ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={onDisconnect}
                  >
                    <i className="fa-solid fa-trash" aria-hidden="true" />
                    Remove
                  </button>
                ) : null}
              </>
            ) : (
              <>
                {channel.supports_oauth && channel.connect_url ? (
                  <a
                    href={resolveSameOriginUrl(channel.connect_url)}
                    className="btn btn-primary btn-sm"
                  >
                    <i className="fa-brands fa-meta" aria-hidden="true" />
                    Connect with Meta
                  </a>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    className={`btn ${
                      channel.supports_oauth ? "btn-ghost" : "btn-primary"
                    } btn-sm`}
                    onClick={onOpenForm}
                  >
                    <i className="fa-solid fa-link" aria-hidden="true" />
                    {isBeta
                      ? "Connect with password"
                      : channel.supports_oauth
                        ? "Link by username"
                        : "Link account"}
                  </button>
                ) : (
                  <span className="settings-muted channel-card__readonly">
                    Ask an admin to connect.
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

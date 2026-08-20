"use client";

import { useEffect, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { TransChapInstallPanel } from "@/components/trans-chap/TransChapInstallPanel";
import { TransChapMpesaSettings } from "@/components/trans-chap/TransChapMpesaSettings";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { MerchantMpesaConfigResponse, SettingsResponse } from "@/lib/types";

const SIGN_IN_PATH = "/trans-chap/sign-in";

type SettingsPane = "list" | "mpesa" | "download";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "T";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function TransChapSettingsPage() {
  const user = useAuthUser();
  const [pane, setPane] = useState<SettingsPane>("list");
  const [loggingOut, setLoggingOut] = useState(false);
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);
  const [hasInstagram, setHasInstagram] = useState(Boolean(user.instagram_account));
  const [canManageInstagram, setCanManageInstagram] = useState(false);
  const [autoRepliesEnabled, setAutoRepliesEnabled] = useState(
    Boolean(user.instagram_account?.auto_replies_enabled),
  );
  const [autoRepliesSaving, setAutoRepliesSaving] = useState(false);

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "Trans Chap";

  useEffect(() => {
    let cancelled = false;
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        if (!cancelled) setMpesaReady(Boolean(data.config));
      })
      .catch(() => {
        if (!cancelled) setMpesaReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pane]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        if (cancelled) return;
        setCanManageInstagram(data.can_manage_instagram);
        const ig = data.user.instagram_account;
        setHasInstagram(Boolean(ig));
        if (typeof ig?.auto_replies_enabled === "boolean") {
          setAutoRepliesEnabled(ig.auto_replies_enabled);
        }
      })
      .catch(() => {
        /* keep defaults from auth user */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAutoRepliesToggle(enabled: boolean) {
    if (autoRepliesSaving || !canManageInstagram) return;
    setAutoRepliesSaving(true);
    try {
      const data = await apiFetch<{ auto_replies_enabled: boolean }>(
        apiRoutes.autoRepliesSettings,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
      setAutoRepliesEnabled(data.auto_replies_enabled);
      await toastSuccess(enabled ? "AI auto-reply enabled" : "AI auto-reply disabled");
    } catch (err) {
      await showError("Could not update setting", extractErrorMessage(err));
    } finally {
      setAutoRepliesSaving(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.assign(SIGN_IN_PATH);
  }

  if (pane === "mpesa") {
    return (
      <div className="ios-settings">
        <button
          type="button"
          className="ios-settings__back"
          onClick={() => setPane("list")}
        >
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">M-PESA</h2>
        <TransChapMpesaSettings />
      </div>
    );
  }

  if (pane === "download") {
    return (
      <div className="ios-settings">
        <button
          type="button"
          className="ios-settings__back"
          onClick={() => setPane("list")}
        >
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Add to Home Screen</h2>
        <TransChapInstallPanel showOpenLink={false} />
      </div>
    );
  }

  return (
    <div className="ios-settings">
      <section className="ios-settings__profile" aria-label="Account">
        <span className="ios-settings__avatar" aria-hidden>
          {initials(user.name || shopName)}
        </span>
        <div className="ios-settings__profile-copy">
          <strong>{user.name || "Merchant"}</strong>
          <span>{shopName}</span>
        </div>
      </section>

      <section className="ios-settings__group" aria-label="Payments">
        <h3 className="ios-settings__caption">Payments</h3>
        <div className="ios-settings__card">
          <button
            type="button"
            className="ios-settings__row"
            onClick={() => setPane("mpesa")}
          >
            <span className="ios-settings__icon ios-settings__icon--mpesa" aria-hidden>
              <i className="fa-solid fa-mobile-screen" />
            </span>
            <span className="ios-settings__label">M-PESA</span>
            <span className="ios-settings__value">
              {mpesaReady == null ? "" : mpesaReady ? "Set" : "Not Set"}
            </span>
            <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
          </button>
        </div>
        <p className="ios-settings__footer">
          Where customer M-PESA payments are sent for this shop.
        </p>
      </section>

      <section className="ios-settings__group" aria-label="Messaging">
        <h3 className="ios-settings__caption">Messaging</h3>
        <div className="ios-settings__card">
          <div
            className={`ios-settings__row ios-settings__row--static${
              !hasInstagram ? " is-disabled" : ""
            }`}
          >
            <span className="ios-settings__icon ios-settings__icon--ai" aria-hidden>
              <i className="fa-solid fa-robot" />
            </span>
            <span className="ios-settings__label">AI Auto-Reply</span>
            <span className="ios-settings__trailing">
              {!hasInstagram ? (
                <span className="ios-settings__value">Connect IG</span>
              ) : canManageInstagram ? (
                <button
                  type="button"
                  role="switch"
                  className={`theme-switch${autoRepliesEnabled ? " is-on" : ""}`}
                  aria-checked={autoRepliesEnabled}
                  aria-label="AI auto-reply"
                  disabled={autoRepliesSaving}
                  onClick={() => void handleAutoRepliesToggle(!autoRepliesEnabled)}
                >
                  <span className="theme-switch__thumb" aria-hidden />
                </button>
              ) : (
                <span className="ios-settings__value">Admin only</span>
              )}
            </span>
          </div>
        </div>
        <p className="ios-settings__footer">
          {!hasInstagram
            ? "Connect Instagram to enable chats, feeds, and AI auto-reply."
            : autoRepliesEnabled
              ? "DukAI replies to matching customer DMs automatically."
              : "Automatic replies are off. Customers won’t get AI responses."}
        </p>
      </section>

      <section className="ios-settings__group" aria-label="App">
        <h3 className="ios-settings__caption">App</h3>
        <div className="ios-settings__card">
          <button
            type="button"
            className="ios-settings__row"
            onClick={() => setPane("download")}
          >
            <span className="ios-settings__icon ios-settings__icon--download" aria-hidden>
              <i className="fa-solid fa-download" />
            </span>
            <span className="ios-settings__label">Add to Home Screen</span>
            <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
          </button>
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--theme" aria-hidden>
              <i className="fa-solid fa-moon" />
            </span>
            <span className="ios-settings__label">Dark Mode</span>
            <span className="ios-settings__trailing">
              <ThemeToggle variant="switch" />
            </span>
          </div>
        </div>
      </section>

      <section className="ios-settings__group" aria-label="Account">
        <div className="ios-settings__card">
          <button
            type="button"
            className="ios-settings__row ios-settings__row--danger"
            onClick={() => void logout()}
            disabled={loggingOut}
            aria-busy={loggingOut}
          >
            <span className="ios-settings__label ios-settings__label--center">
              {loggingOut ? "Logging Out…" : "Log Out"}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

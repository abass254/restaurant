"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  extractErrorMessage,
  showError,
  showSuccess,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { useAuthUser } from "@/components/app/AuthProvider";
import { accountNeedsLocationSetup } from "@/lib/account-location";
import { ChannelsSection } from "@/components/app/ChannelsSection";
import { InventoryIntegrationSection } from "@/components/app/InventoryIntegrationSection";
import { KraSettingsSection } from "@/components/app/KraSettingsSection";
import { MpesaSettingsSection } from "@/components/app/MpesaSettingsSection";
import type { ChannelsResponse, MerchantKraConfigResponse, SettingsResponse } from "@/lib/types";

type SectionId = "business" | "channels" | "auto-replies" | "inventory" | "mpesa" | "kra";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useAuthUser();
  const [canManageInstagram, setCanManageInstagram] = useState(
    user.user_role === "system_admin",
  );
  const [autoRepliesEnabled, setAutoRepliesEnabled] = useState(true);
  const [autoRepliesSaving, setAutoRepliesSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("business");
  const [channelSummary, setChannelSummary] = useState<{
    connected: number;
    total: number;
  } | null>(null);
  const [hasInstagram, setHasInstagram] = useState<boolean>(
    !!user.instagram_account,
  );
  const [kraStatus, setKraStatus] = useState<string | undefined>(undefined);
  const [kraTone, setKraTone] = useState<"ok" | "warn" | "off" | undefined>(undefined);

  const scrollToSection = useCallback((id: SectionId) => {
    requestAnimationFrame(() => {
      document.getElementById(`section-${id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const navigateSection = useCallback(
    (id: SectionId, event?: MouseEvent) => {
      event?.preventDefault();
      setActiveSection(id);
      window.history.replaceState(null, "", `#section-${id}`);
      scrollToSection(id);
    },
    [scrollToSection],
  );

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      void showSuccess("Instagram connected", "Your account was linked successfully via Meta.");
      router.replace("/tools/onboarding");
      return;
    }
    const err = searchParams.get("error");
    if (err) {
      const messages: Record<string, string> = {
        cancelled: "Instagram authorization was cancelled.",
        invalid_state: "This Instagram connection link expired. Please try again.",
      };
      void showError("Connection failed", messages[err] ?? err);
    }

    const hash = window.location.hash.replace("#", "").replace("section-", "") as SectionId;
    if (["business", "channels", "auto-replies", "inventory", "mpesa", "kra"].includes(hash)) {
      setActiveSection(hash);
      scrollToSection(hash);
    }
  }, [searchParams, router, scrollToSection]);

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace("#", "").replace("section-", "") as SectionId;
      if (["business", "channels", "auto-replies", "inventory", "mpesa", "kra"].includes(hash)) {
        setActiveSection(hash);
        scrollToSection(hash);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [scrollToSection]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void apiFetch<SettingsResponse>(apiRoutes.settings).then((data) => {
      setCanManageInstagram(data.can_manage_instagram);
      const ig = data.user.instagram_account;
      setHasInstagram(!!ig);
      if (typeof ig?.auto_replies_enabled === "boolean") {
        setAutoRepliesEnabled(ig.auto_replies_enabled);
      }
    });

    function refreshAutoReplies() {
      void apiFetch<SettingsResponse>(apiRoutes.settings).then((data) => {
        const enabled = data.user.instagram_account?.auto_replies_enabled;
        if (typeof enabled === "boolean") {
          setAutoRepliesEnabled(enabled);
        }
      });
    }

    window.addEventListener("focus", refreshAutoReplies);
    return () => window.removeEventListener("focus", refreshAutoReplies);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void apiFetch<ChannelsResponse>(apiRoutes.channels).then((data) => {
      setChannelSummary({
        connected: data.connected_count,
        total: data.channels.length,
      });
    });

    void apiFetch<MerchantKraConfigResponse>(apiRoutes.kraBusinessConfig)
      .then((data) => {
        if (!data.config) {
          setKraStatus("Off");
          setKraTone("off");
          return;
        }
        if (data.config.is_configured) {
          setKraStatus("Ready");
          setKraTone("ok");
        } else if (data.config.enabled) {
          setKraStatus("Incomplete");
          setKraTone("warn");
        } else {
          setKraStatus("Off");
          setKraTone("off");
        }
      })
      .catch(() => {
        setKraStatus(undefined);
        setKraTone(undefined);
      });

  }, [user]);

  async function handleAutoRepliesToggle(enabled: boolean) {
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
      await toastSuccess(enabled ? "Auto-replies enabled" : "Auto-replies disabled");
    } catch (err) {
      await showError("Could not update setting", extractErrorMessage(err));
    } finally {
      setAutoRepliesSaving(false);
    }
  }

  const business = user.account;
  const locationIncomplete = accountNeedsLocationSetup(business);

  const sections: {
    id: SectionId;
    label: string;
    icon: string;
    status?: string;
    tone?: "ok" | "warn" | "off";
  }[] = [
    { id: "business", label: "Business", icon: "fa-briefcase",
      status: business
        ? locationIncomplete
          ? "Set map pin"
          : "Ready"
        : undefined,
      tone: business ? (locationIncomplete ? "warn" : "ok") : undefined,
    },
    {
      id: "channels",
      label: "Channels",
      icon: "fa-plug",
      status: channelSummary
        ? `${channelSummary.connected}/${channelSummary.total}`
        : undefined,
      tone: channelSummary && channelSummary.connected > 0 ? "ok" : "warn",
    },
    {
      id: "auto-replies",
      label: "Auto-replies",
      icon: "fa-robot",
      status: hasInstagram ? (autoRepliesEnabled ? "On" : "Off") : "—",
      tone: hasInstagram ? (autoRepliesEnabled ? "ok" : "off") : undefined,
    },
    {
      id: "inventory",
      label: "Inventory",
      icon: "fa-boxes-stacked",
      status: hasInstagram ? "duKAi" : "—",
      tone: hasInstagram ? "ok" : undefined,
    },
    { id: "mpesa", label: "M-PESA", icon: "fa-mobile-screen" },
    {
      id: "kra",
      label: "KRA ETR",
      icon: "fa-file-invoice",
      status: kraStatus,
      tone: kraTone,
    },
  ];

  return (
    <section className="settings-shell">
      <header className="settings-shell__header">
        <div>
          <h1 className="settings-shell__title">Settings</h1>
          <p className="settings-shell__lead">
            Manage your business profile, connected channels, automations and
            payments. Only platform admins can connect or remove channels.
          </p>
        </div>
      </header>

      <div className="settings-shell__layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#section-${s.id}`}
              className={`settings-nav__item${activeSection === s.id ? " is-active" : ""}`}
              onClick={(event) => navigateSection(s.id, event)}
            >
              <span className="settings-nav__icon">
                <i className={`fa-solid ${s.icon}`} aria-hidden="true" />
              </span>
              <span className="settings-nav__label">{s.label}</span>
              {s.status ? (
                <span
                  className={`settings-nav__pill settings-nav__pill--${s.tone ?? "neutral"}`}
                >
                  {s.status}
                </span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className="settings-shell__content">
          {/* Business — summary + link to Basics */}
          <article id="section-business" className="settings-card">
            <header className="settings-card__head">
              <div className="settings-card__title">
                <i className="fa-solid fa-briefcase settings-card__icon" aria-hidden="true" />
                <h2>Business</h2>
              </div>
            </header>
            <div className="settings-card__body">
              <dl className="settings-grid">
                <div className="settings-grid__cell">
                  <dt>Name</dt>
                  <dd>{business?.business_name ?? "—"}</dd>
                </div>
                <div className="settings-grid__cell">
                  <dt>Category</dt>
                  <dd>{business?.business_category ?? "—"}</dd>
                </div>
                <div className="settings-grid__cell">
                  <dt>Location</dt>
                  <dd>
                    {business?.business_location ?? "—"}
                    {locationIncomplete ? (
                      <span className="settings-grid__sub">Map pin needed</span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              <p className="settings-muted settings-card__footer">
                <Link href="/basics">
                  <i className="fa-solid fa-store" aria-hidden="true" /> Edit on Basics →
                </Link>
              </p>
            </div>
          </article>

          {/* Channels: IG, FB, WA, TT */}
          <div id="section-channels">
            <ChannelsSection />
          </div>

          {/* Auto-replies — only when Instagram is connected (real messaging) */}
          {hasInstagram ? (
            <article id="section-auto-replies" className="settings-card">
              <header className="settings-card__head">
                <div className="settings-card__title">
                  <i className="fa-solid fa-robot settings-card__icon" aria-hidden="true" />
                  <h2>Auto-replies</h2>
                </div>
                <span
                  className={`settings-pill ${
                    autoRepliesEnabled ? "settings-pill--ok" : "settings-pill--off"
                  }`}
                >
                  {autoRepliesEnabled ? "Enabled" : "Disabled"}
                </span>
              </header>
              <div className="settings-card__body">
                <div className="settings-toggle settings-toggle--compact">
                  <div className="settings-toggle__copy">
                    <strong>Automatic replies</strong>
                    <span>
                      {autoRepliesEnabled
                        ? "Matching inbound DMs will receive automatic responses."
                        : "No automatic responses will be sent."}
                    </span>
                  </div>
                  {canManageInstagram ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoRepliesEnabled}
                      className={`settings-toggle__switch${
                        autoRepliesEnabled ? " is-on" : ""
                      }`}
                      disabled={autoRepliesSaving}
                      onClick={() => void handleAutoRepliesToggle(!autoRepliesEnabled)}
                    >
                      <span className="settings-toggle__thumb" aria-hidden="true" />
                      <span className="sr-only">
                        {autoRepliesEnabled ? "Disable auto-replies" : "Enable auto-replies"}
                      </span>
                    </button>
                  ) : (
                    <span className="settings-muted settings-toggle__readonly">
                      Admin only
                    </span>
                  )}
                </div>
                <p className="settings-muted settings-card__footer">
                  <Link href="/tools/auto-reply">
                    <i className="fa-solid fa-sliders" aria-hidden="true" /> Manage auto-reply rules
                  </Link>
                </p>
              </div>
            </article>
          ) : null}

          {hasInstagram ? <InventoryIntegrationSection /> : null}

          {/* M-PESA */}
          <div id="section-mpesa">
            <MpesaSettingsSection mode="merchant" />
          </div>

          {/* KRA ETR / TIMS */}
          <div id="section-kra">
            <KraSettingsSection />
          </div>

          {hasInstagram ? (
            <p className="settings-muted settings-shell__footer">
              <Link href="/tickets">
                <i className="fa-solid fa-inbox" aria-hidden="true" /> Go to inbox →
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

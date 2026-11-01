"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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
import { storeTypeLabel } from "@/lib/onboarding";
import { ChannelsSection } from "@/components/app/ChannelsSection";
import { InventoryIntegrationSection } from "@/components/app/InventoryIntegrationSection";
import { KraSettingsSection } from "@/components/app/KraSettingsSection";
import { MpesaSettingsSection } from "@/components/app/MpesaSettingsSection";
import type { ChannelsResponse, MerchantKraConfigResponse, SettingsResponse } from "@/lib/types";

export type SectionId = "business" | "channels" | "auto-replies" | "inventory" | "mpesa" | "kra";

interface SectionMeta {
  id: SectionId;
  group: "general" | "automation" | "finance";
  label: string;
  description: string;
  icon: string;
  status?: string;
  tone?: "ok" | "warn" | "off";
  keywords: string;
}

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
  const [viewMode, setViewMode] = useState<"tabs" | "all">("tabs");
  const [searchQuery, setSearchQuery] = useState("");
  const [channelSummary, setChannelSummary] = useState<{
    connected: number;
    total: number;
  } | null>(null);
  const [hasInstagram, setHasInstagram] = useState<boolean>(
    !!user.instagram_account,
  );
  const [kraStatus, setKraStatus] = useState<string | undefined>(undefined);
  const [kraTone, setKraTone] = useState<"ok" | "warn" | "off" | undefined>(undefined);
  const [mpesaConfigured, setMpesaConfigured] = useState<boolean | null>(null);

  const isManualScrolling = useRef(false);

  const scrollToSection = useCallback((id: SectionId) => {
    isManualScrolling.current = true;
    requestAnimationFrame(() => {
      const el = document.getElementById(`section-${id}`);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
      setTimeout(() => {
        isManualScrolling.current = false;
      }, 700);
    });
  }, []);

  const navigateSection = useCallback(
    (id: SectionId, event?: MouseEvent) => {
      event?.preventDefault();
      setActiveSection(id);
      window.history.replaceState(null, "", `#${id}`);
      if (viewMode === "all") {
        scrollToSection(id);
      }
    },
    [viewMode, scrollToSection],
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

    const rawHash = window.location.hash.replace("#", "").replace("section-", "") as SectionId;
    if (["business", "channels", "auto-replies", "inventory", "mpesa", "kra"].includes(rawHash)) {
      setActiveSection(rawHash);
      if (viewMode === "all") {
        scrollToSection(rawHash);
      }
    }
  }, [searchParams, router, scrollToSection, viewMode]);

  useEffect(() => {
    function onHashChange() {
      const rawHash = window.location.hash.replace("#", "").replace("section-", "") as SectionId;
      if (["business", "channels", "auto-replies", "inventory", "mpesa", "kra"].includes(rawHash)) {
        setActiveSection(rawHash);
        if (viewMode === "all") {
          scrollToSection(rawHash);
        }
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [scrollToSection, viewMode]);

  // Sync active section when scrolling in "all" viewMode
  useEffect(() => {
    if (viewMode !== "all") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualScrolling.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("section-", "") as SectionId;
            if (["business", "channels", "auto-replies", "inventory", "mpesa", "kra"].includes(id)) {
              setActiveSection(id);
              window.history.replaceState(null, "", `#${id}`);
              break;
            }
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );

    const sectionElements = document.querySelectorAll('[id^="section-"]');
    sectionElements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    if (!user) return;

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
    if (!user) return;

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

    void apiFetch<{ config: unknown }>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        setMpesaConfigured(!!data.config);
      })
      .catch(() => {
        setMpesaConfigured(false);
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

  const sections: SectionMeta[] = useMemo(
    () => [
      {
        id: "business",
        group: "general",
        label: "Business Profile",
        description: "Store name, category, location and branding",
        icon: "fa-store",
        status: business ? (locationIncomplete ? "Location needed" : "Ready") : undefined,
        tone: business ? (locationIncomplete ? "warn" : "ok") : undefined,
        keywords: "business profile store name location address category shop details logo branding",
      },
      {
        id: "channels",
        group: "general",
        label: "Channels & Integrations",
        description: "Instagram, WhatsApp, Facebook, TikTok",
        icon: "fa-plug",
        status: channelSummary ? `${channelSummary.connected}/${channelSummary.total} Connected` : undefined,
        tone: channelSummary && channelSummary.connected > 0 ? "ok" : "warn",
        keywords: "channels social instagram facebook whatsapp tiktok chat messaging dms meta connect",
      },
      {
        id: "auto-replies",
        group: "automation",
        label: "Auto-Replies",
        description: "Automated responses for inbound customer chats",
        icon: "fa-robot",
        status: hasInstagram ? (autoRepliesEnabled ? "On" : "Off") : "Connect IG",
        tone: hasInstagram ? (autoRepliesEnabled ? "ok" : "off") : "warn",
        keywords: "auto reply bot automation answers dm replies instant hours message",
      },
      {
        id: "inventory",
        group: "automation",
        label: "Inventory Source",
        description: "Catalog source: TransChap Platform vs External API",
        icon: "fa-boxes-stacked",
        status: "Platform",
        tone: "ok",
        keywords: "inventory source catalog external api webhook sync stock products",
      },
      {
        id: "mpesa",
        group: "finance",
        label: "M-PESA Settlement",
        description: "Configure phone / Till / Paybill for store payouts",
        icon: "fa-mobile-screen",
        status: mpesaConfigured ? "Configured" : "Setup needed",
        tone: mpesaConfigured ? "ok" : "warn",
        keywords: "mpesa m-pesa payment payout settlement till paybill phone cash money safaricom",
      },
      {
        id: "kra",
        group: "finance",
        label: "KRA ETR / TIMS",
        description: "Fiscal compliance, PIN and electronic tax invoices",
        icon: "fa-file-invoice",
        status: kraStatus,
        tone: kraTone,
        keywords: "kra etr tims tax vat fiscal invoice compliance pin e-tims kenya revenue",
      },
    ],
    [business, locationIncomplete, channelSummary, hasInstagram, autoRepliesEnabled, mpesaConfigured, kraStatus, kraTone],
  );

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keywords.toLowerCase().includes(q),
    );
  }, [sections, searchQuery]);

  const activeSectionMeta = sections.find((s) => s.id === activeSection) ?? sections[0];

  return (
    <section className="settings-shell fb-settings-v2">
      {/* Top Header & Search Bar */}
      <header className="settings-shell__header settings-v2__header">
        <div className="settings-v2__header-text">
          <div className="settings-v2__title-row">
            <h1 className="settings-shell__title">Settings</h1>
            <div className="settings-v2__view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`settings-v2__view-btn${viewMode === "tabs" ? " is-active" : ""}`}
                onClick={() => setViewMode("tabs")}
                title="Focus on one setting at a time"
              >
                <i className="fa-solid fa-table-columns" aria-hidden="true" />
                <span>Focused Tabs</span>
              </button>
              <button
                type="button"
                className={`settings-v2__view-btn${viewMode === "all" ? " is-active" : ""}`}
                onClick={() => setViewMode("all")}
                title="View all settings on a single page"
              >
                <i className="fa-solid fa-bars-staggered" aria-hidden="true" />
                <span>All Sections</span>
              </button>
            </div>
          </div>
          <p className="settings-shell__lead">
            Manage your store identity, social channels, chat automations, M-PESA payouts, and tax compliance.
          </p>
        </div>

        <div className="settings-v2__search-wrap">
          <div className="settings-v2__search-bar">
            <i className="fa-solid fa-magnifying-glass settings-v2__search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search settings (e.g. M-PESA, WhatsApp, Auto-reply, Tax)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search settings"
            />
            {searchQuery ? (
              <button
                type="button"
                className="settings-v2__search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Store Readiness Quick Strip */}
      <div className="settings-v2__readiness-bar" aria-label="Store configuration status">
        <div className="settings-v2__readiness-title">
          <i className="fa-solid fa-circle-check" aria-hidden="true" />
          <span>Readiness:</span>
        </div>
        <div className="settings-v2__readiness-chips">
          <button
            type="button"
            className="settings-v2__chip"
            onClick={() => navigateSection("business")}
          >
            <span className="settings-v2__chip-dot is-ok" />
            <span className="settings-v2__chip-label">Store:</span>
            <strong>{business?.business_name ?? "Nextverse"}</strong>
          </button>

          <button
            type="button"
            className="settings-v2__chip"
            onClick={() => navigateSection("channels")}
          >
            <span
              className={`settings-v2__chip-dot ${
                channelSummary && channelSummary.connected > 0 ? "is-ok" : "is-warn"
              }`}
            />
            <span className="settings-v2__chip-label">Channels:</span>
            <strong>
              {channelSummary ? `${channelSummary.connected}/${channelSummary.total}` : "1/5"} Connected
            </strong>
          </button>

          <button
            type="button"
            className="settings-v2__chip"
            onClick={() => navigateSection("auto-replies")}
          >
            <span
              className={`settings-v2__chip-dot ${
                hasInstagram && autoRepliesEnabled ? "is-ok" : "is-off"
              }`}
            />
            <span className="settings-v2__chip-label">Auto-Replies:</span>
            <strong>{hasInstagram ? (autoRepliesEnabled ? "Active" : "Paused") : "Setup"}</strong>
          </button>

          <button
            type="button"
            className="settings-v2__chip"
            onClick={() => navigateSection("mpesa")}
          >
            <span
              className={`settings-v2__chip-dot ${
                mpesaConfigured ? "is-ok" : "is-warn"
              }`}
            />
            <span className="settings-v2__chip-label">M-PESA:</span>
            <strong>{mpesaConfigured ? "Configured" : "Action Needed"}</strong>
          </button>

          <button
            type="button"
            className="settings-v2__chip"
            onClick={() => navigateSection("kra")}
          >
            <span
              className={`settings-v2__chip-dot ${
                kraTone === "ok" ? "is-ok" : kraTone === "warn" ? "is-warn" : "is-off"
              }`}
            />
            <span className="settings-v2__chip-label">KRA ETR:</span>
            <strong>{kraStatus ?? "Off"}</strong>
          </button>
        </div>
      </div>

      <div className="settings-shell__layout settings-v2__layout">
        {/* Navigation Sidebar */}
        <aside className="settings-v2__sidebar">
          <nav className="settings-nav settings-v2__nav" aria-label="Settings sections">
            {filteredSections.length === 0 ? (
              <div className="settings-v2__nav-empty">
                <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                <p>No settings matching &quot;{searchQuery}&quot;</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSearchQuery("")}
                >
                  Clear search
                </button>
              </div>
            ) : null}

            {/* General Group */}
            {filteredSections.some((s) => s.group === "general") ? (
              <div className="settings-v2__nav-group">
                <span className="settings-v2__group-title">General & Presence</span>
                {filteredSections
                  .filter((s) => s.group === "general")
                  .map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className={`settings-nav__item settings-v2__nav-item${
                        activeSection === s.id ? " is-active" : ""
                      }`}
                      onClick={(e) => navigateSection(s.id, e)}
                    >
                      <span className="settings-nav__icon">
                        <i className={`fa-solid ${s.icon}`} aria-hidden="true" />
                      </span>
                      <div className="settings-v2__nav-text">
                        <span className="settings-nav__label">{s.label}</span>
                      </div>
                      {s.status ? (
                        <span
                          className={`settings-nav__pill settings-nav__pill--${
                            s.tone ?? "neutral"
                          }`}
                        >
                          {s.status}
                        </span>
                      ) : null}
                    </a>
                  ))}
              </div>
            ) : null}

            {/* Automation Group */}
            {filteredSections.some((s) => s.group === "automation") ? (
              <div className="settings-v2__nav-group">
                <span className="settings-v2__group-title">Automations</span>
                {filteredSections
                  .filter((s) => s.group === "automation")
                  .map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className={`settings-nav__item settings-v2__nav-item${
                        activeSection === s.id ? " is-active" : ""
                      }`}
                      onClick={(e) => navigateSection(s.id, e)}
                    >
                      <span className="settings-nav__icon">
                        <i className={`fa-solid ${s.icon}`} aria-hidden="true" />
                      </span>
                      <div className="settings-v2__nav-text">
                        <span className="settings-nav__label">{s.label}</span>
                      </div>
                      {s.status ? (
                        <span
                          className={`settings-nav__pill settings-nav__pill--${
                            s.tone ?? "neutral"
                          }`}
                        >
                          {s.status}
                        </span>
                      ) : null}
                    </a>
                  ))}
              </div>
            ) : null}

            {/* Finance Group */}
            {filteredSections.some((s) => s.group === "finance") ? (
              <div className="settings-v2__nav-group">
                <span className="settings-v2__group-title">Finance & Compliance</span>
                {filteredSections
                  .filter((s) => s.group === "finance")
                  .map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className={`settings-nav__item settings-v2__nav-item${
                        activeSection === s.id ? " is-active" : ""
                      }`}
                      onClick={(e) => navigateSection(s.id, e)}
                    >
                      <span className="settings-nav__icon">
                        <i className={`fa-solid ${s.icon}`} aria-hidden="true" />
                      </span>
                      <div className="settings-v2__nav-text">
                        <span className="settings-nav__label">{s.label}</span>
                      </div>
                      {s.status ? (
                        <span
                          className={`settings-nav__pill settings-nav__pill--${
                            s.tone ?? "neutral"
                          }`}
                        >
                          {s.status}
                        </span>
                      ) : null}
                    </a>
                  ))}
              </div>
            ) : null}
          </nav>
        </aside>

        {/* Content Workspace */}
        <main className="settings-shell__content settings-v2__content">
          {/* If Tabs Mode: Show focused banner */}
          {viewMode === "tabs" ? (
            <div className="settings-v2__tab-banner">
              <div className="settings-v2__tab-banner-left">
                <span className="settings-v2__tab-badge">
                  <i className={`fa-solid ${activeSectionMeta.icon}`} aria-hidden="true" />
                </span>
                <div>
                  <h2 className="settings-v2__tab-title">{activeSectionMeta.label}</h2>
                  <p className="settings-v2__tab-desc">{activeSectionMeta.description}</p>
                </div>
              </div>
              {activeSectionMeta.status ? (
                <span className={`settings-pill settings-pill--${activeSectionMeta.tone ?? "neutral"}`}>
                  {activeSectionMeta.status}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Section 1: Business Profile */}
          {(viewMode === "all" || activeSection === "business") ? (
            <article id="section-business" className="settings-card settings-v2__business-card">
              <header className="settings-card__head">
                <div className="settings-card__title">
                  <i className="fa-solid fa-store settings-card__icon" aria-hidden="true" />
                  <h2>Business Profile</h2>
                </div>
                <div className="settings-card__head-meta">
                  <span className="settings-pill settings-pill--ok">
                    <i className="fa-solid fa-badge-check" aria-hidden="true" /> Active Merchant
                  </span>
                </div>
              </header>

              <div className="settings-card__body">
                {/* Hero profile row */}
                <div className="settings-v2__profile-hero">
                  <div className="settings-v2__profile-avatar">
                    <span>
                      {(business?.business_name ?? "D").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="settings-v2__profile-info">
                    <div className="settings-v2__profile-name-row">
                      <h3 className="settings-v2__profile-name">
                        {business?.business_name ?? "Your Store Name"}
                      </h3>
                      <span className="settings-v2__badge">
                        {business ? storeTypeLabel(business.store_type) : "Retail shop"}
                      </span>
                      {business?.business_category ? (
                        <span className="settings-v2__badge settings-v2__badge--secondary">
                          {business.business_category}
                        </span>
                      ) : null}
                    </div>
                    <p className="settings-v2__profile-location">
                      <i className="fa-solid fa-location-dot" aria-hidden="true" />
                      <span>{business?.business_location ?? "Location not specified"}</span>
                    </p>
                  </div>
                  <div className="settings-v2__profile-actions">
                    <Link href="/basics" className="btn btn-primary btn-sm">
                      <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                      Edit Profile & Logo
                    </Link>
                  </div>
                </div>

                {/* Details grid */}
                <div className="settings-grid settings-v2__details-grid">
                  <div className="settings-grid__cell">
                    <dt>Store Name</dt>
                    <dd>{business?.business_name ?? "—"}</dd>
                  </div>
                  <div className="settings-grid__cell">
                    <dt>Business Type</dt>
                    <dd>{business ? storeTypeLabel(business.store_type) : "—"}</dd>
                  </div>
                  <div className="settings-grid__cell">
                    <dt>Category</dt>
                    <dd>{business?.business_category ?? "—"}</dd>
                  </div>
                  <div className="settings-grid__cell">
                    <dt>Operating Address</dt>
                    <dd>
                      {business?.business_location ?? "—"}
                    </dd>
                  </div>
                </div>

                {/* Location dispatch status */}
                <div className={`settings-v2__status-callout ${locationIncomplete ? "is-warn" : "is-ok"}`}>
                  <div className="settings-v2__status-icon">
                    <i
                      className={`fa-solid ${
                        locationIncomplete ? "fa-map-pin" : "fa-circle-check"
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="settings-v2__status-text">
                    <strong>
                      {locationIncomplete
                        ? "Rider Delivery Pin Needed"
                        : "Rider Delivery Location Configured"}
                    </strong>
                    <p>
                      {locationIncomplete
                        ? "Pin your exact physical store coordinates so dispatch riders can automatically navigate and pick up customer orders."
                        : "Your store GPS coordinates are pinned for seamless automated delivery dispatch."}
                    </p>
                  </div>
                  <Link
                    href="/delivery#section-store-location"
                    className={`btn btn-sm ${
                      locationIncomplete ? "btn-primary" : "btn-ghost"
                    }`}
                  >
                    <i className="fa-solid fa-map-location-dot" aria-hidden="true" />
                    {locationIncomplete ? "Pin Location Now →" : "View Map Pin →"}
                  </Link>
                </div>
              </div>
            </article>
          ) : null}

          {/* Section 2: Channels */}
          {(viewMode === "all" || activeSection === "channels") ? (
            <div id="section-channels" className="settings-v2__section-block">
              <ChannelsSection />
            </div>
          ) : null}

          {/* Section 3: Auto-replies */}
          {(viewMode === "all" || activeSection === "auto-replies") ? (
            <article id="section-auto-replies" className="settings-card settings-v2__auto-reply-card">
              <header className="settings-card__head">
                <div className="settings-card__title">
                  <i className="fa-solid fa-robot settings-card__icon" aria-hidden="true" />
                  <h2>Inbound Chat Auto-Replies</h2>
                </div>
                <span
                  className={`settings-pill ${
                    hasInstagram && autoRepliesEnabled
                      ? "settings-pill--ok"
                      : "settings-pill--off"
                  }`}
                >
                  {hasInstagram
                    ? autoRepliesEnabled
                      ? "Active & Replying"
                      : "Paused"
                    : "Channel Required"}
                </span>
              </header>

              <div className="settings-card__body">
                {hasInstagram ? (
                  <>
                    <div className="settings-v2__auto-reply-hero">
                      <div className="settings-v2__auto-reply-info">
                        <h3>Automated Customer Conversations</h3>
                        <p>
                          Instantly greet prospective buyers, answer FAQs, lookup product stock and pricing,
                          and capture delivery details directly in customer DMs.
                        </p>
                        <div className="settings-v2__feature-pills">
                          <span><i className="fa-solid fa-bolt" /> Instant greetings</span>
                          <span><i className="fa-solid fa-box-open" /> Catalog lookups</span>
                          <span><i className="fa-solid fa-clock" /> 24/7 coverage</span>
                        </div>
                      </div>

                      <div className="settings-v2__toggle-box">
                        <div className="settings-v2__toggle-label">
                          <strong>{autoRepliesEnabled ? "Auto-replies Active" : "Auto-replies Paused"}</strong>
                          <span>
                            {autoRepliesEnabled
                              ? "TransChap answers matching messages"
                              : "No automated messages sent"}
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
                    </div>

                    <div className="settings-v2__actions-footer">
                      <Link href="/tools/auto-reply" className="btn btn-ghost btn-sm">
                        <i className="fa-solid fa-sliders" aria-hidden="true" />
                        Manage Auto-Reply Rules
                      </Link>
                      <Link href="/bot" className="btn btn-ghost btn-sm">
                        <i className="fa-solid fa-flask" aria-hidden="true" />
                        Test in Bot Sandbox
                      </Link>
                      <Link href="/tickets" className="btn btn-ghost btn-sm">
                        <i className="fa-solid fa-inbox" aria-hidden="true" />
                        Go to Conversations Inbox
                      </Link>
                    </div>
                  </>
                ) : (
                  <div className="settings-v2__empty-connect">
                    <div className="settings-v2__empty-icon">
                      <i className="fa-brands fa-instagram" aria-hidden="true" />
                    </div>
                    <h3>Connect Instagram to activate auto-replies</h3>
                    <p>
                      Automated responses respond to inbound customer DMs and story mentions on your connected Instagram account.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => navigateSection("channels")}
                    >
                      <i className="fa-solid fa-plug" aria-hidden="true" />
                      Go to Channels to Connect Instagram
                    </button>
                  </div>
                )}
              </div>
            </article>
          ) : null}

          {/* Section 4: Inventory Integration */}
          {(viewMode === "all" || activeSection === "inventory") ? (
            <div id="section-inventory" className="settings-v2__section-block">
              <InventoryIntegrationSection />
            </div>
          ) : null}

          {/* Section 5: M-PESA */}
          {(viewMode === "all" || activeSection === "mpesa") ? (
            <div id="section-mpesa" className="settings-v2__section-block">
              <MpesaSettingsSection mode="merchant" />
            </div>
          ) : null}

          {/* Section 6: KRA ETR / TIMS */}
          {(viewMode === "all" || activeSection === "kra") ? (
            <div id="section-kra" className="settings-v2__section-block">
              <KraSettingsSection />
            </div>
          ) : null}
        </main>
      </div>
    </section>
  );
}

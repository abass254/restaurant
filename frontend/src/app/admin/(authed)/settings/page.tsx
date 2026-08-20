"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { MpesaSettingsSection } from "@/components/app/MpesaSettingsSection";
import { GoogleMapsSettingsSection } from "@/components/app/GoogleMapsSettingsSection";
import { AiAgentSettingsSection } from "@/components/app/AiAgentSettingsSection";
import { EmailTestSection } from "@/components/app/EmailTestSection";
import { PaymentSimulationSection } from "@/components/app/PaymentSimulationSection";
import { MerchantPayoutSection } from "@/components/app/MerchantPayoutSection";
import { MessagingSettingsSection } from "@/components/app/MessagingSettingsSection";
import { PlatformModeToggle } from "@/components/app/PlatformModeToggle";
import { MotionFade, MotionItem, MotionList } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import type { AdminStatsResponse } from "@/lib/types";
import { apiRoutes } from "@/lib/config";

type SectionId =
  | "overview"
  | "messaging"
  | "ai-agent"
  | "mpesa"
  | "payment-sim"
  | "merchant-payout"
  | "google-maps"
  | "email";

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "fa-chart-pie" },
  { id: "messaging", label: "Messaging", icon: "fa-comments" },
  { id: "ai-agent", label: "AI agent", icon: "fa-robot" },
  { id: "mpesa", label: "M-PESA", icon: "fa-mobile-screen" },
  { id: "payment-sim", label: "Payment sim", icon: "fa-arrows-rotate" },
  { id: "merchant-payout", label: "Send payout", icon: "fa-paper-plane" },
  { id: "google-maps", label: "Google Maps", icon: "fa-map-location-dot" },
  { id: "email", label: "Email", icon: "fa-envelope" },
];

export default function AdminSettingsPage() {
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

  useEffect(() => {
    let cancelled = false;
    void apiFetch<AdminStatsResponse>(apiRoutes.adminStats)
      .then((data) => {
        if (cancelled) return;
        setStats(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load settings status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "").replace("section-", "") as SectionId;
    if (SECTIONS.some((s) => s.id === hash)) {
      setActiveSection(hash);
    }
  }, []);

  function navigateSection(id: SectionId, event?: MouseEvent) {
    event?.preventDefault();
    setActiveSection(id);
    window.history.replaceState(null, "", `#section-${id}`);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const darajaReady = stats?.mpesa_daraja_configured ?? false;
  const mapsReady = stats?.google_maps_configured ?? false;
  const aiReady = stats?.ai_agent_configured ?? false;
  const merchantsReady = stats?.merchants_mpesa_configured ?? 0;
  const merchantsTotal = stats?.merchants ?? 0;
  const platformReadyCount = (darajaReady ? 1 : 0) + (mapsReady ? 1 : 0);
  const merchantAdoption =
    merchantsTotal > 0 ? Math.round((merchantsReady / merchantsTotal) * 100) : 0;

  const navStatus: Record<SectionId, { text: string; tone: "ok" | "warn" | "neutral" } | undefined> =
    loading
      ? {
          overview: undefined,
          messaging: { text: "DM tickets", tone: "neutral" },
          "ai-agent": undefined,
          mpesa: undefined,
          "payment-sim": { text: "Test", tone: "neutral" },
          "merchant-payout": { text: "Send", tone: "neutral" },
          "google-maps": undefined,
          email: undefined,
        }
      : {
          overview: {
            text: `${platformReadyCount}/2`,
            tone: platformReadyCount === 2 ? "ok" : "warn",
          },
          messaging: { text: "DM tickets", tone: "neutral" },
          "ai-agent": {
            text: aiReady ? "Ready" : "Setup",
            tone: aiReady ? "ok" : "warn",
          },
          mpesa: {
            text: darajaReady ? "Ready" : "Setup",
            tone: darajaReady ? "ok" : "warn",
          },
          "payment-sim": { text: "Test", tone: "neutral" },
          "merchant-payout": { text: "Send", tone: "neutral" },
          "google-maps": {
            text: mapsReady ? "Ready" : "Setup",
            tone: mapsReady ? "ok" : "warn",
          },
          email: { text: "Test", tone: "neutral" },
        };

  return (
    <section className="admin-page admin-settings-page">
      <header className="admin-page__header admin-settings-page__header">
        <div className="admin-settings-page__intro">
          <span className="admin-chip admin-settings-page__chip">
            <i className="fas fa-sliders" aria-hidden="true" />
            Platform
          </span>
          <h1 className="admin-page__title">Settings</h1>
          <p className="admin-page__lead">
            Configure payments, maps, AI, and email for every merchant on the platform.
          </p>
        </div>

        {!loading && !error ? (
          <div
            className={`admin-settings-health ${
              platformReadyCount === 2
                ? "admin-settings-health--ok"
                : "admin-settings-health--warn"
            }`}
            aria-label={`${platformReadyCount} of 2 core integrations configured`}
          >
            <span className="admin-settings-health__ring" aria-hidden="true">
              <svg viewBox="0 0 36 36" className="admin-settings-health__svg">
                <circle
                  className="admin-settings-health__track"
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                />
                <circle
                  className="admin-settings-health__fill"
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  strokeDasharray={`${(platformReadyCount / 2) * 97.4} 97.4`}
                />
              </svg>
              <span className="admin-settings-health__count">{platformReadyCount}/2</span>
            </span>
            <div className="admin-settings-health__copy">
              <strong>Platform readiness</strong>
              <span>
                {platformReadyCount === 2
                  ? "Daraja and Google Maps are configured"
                  : "Complete Daraja and Google Maps to go live"}
              </span>
            </div>
          </div>
        ) : null}
      </header>

      {error ? (
        <MotionFade>
          <p className="admin-error" role="alert">
            {error}
          </p>
        </MotionFade>
      ) : null}

      <div className="admin-settings-page__layout">
        <nav className="admin-settings-nav" aria-label="Settings sections">
          {SECTIONS.map((section) => {
            const status = navStatus[section.id];
            return (
              <a
                key={section.id}
                href={`#section-${section.id}`}
                className={`admin-settings-nav__item${
                  activeSection === section.id ? " is-active" : ""
                }`}
                onClick={(e) => navigateSection(section.id, e)}
              >
                <span className="admin-settings-nav__icon">
                  <i className={`fa-solid ${section.icon}`} aria-hidden="true" />
                </span>
                <span className="admin-settings-nav__label">{section.label}</span>
                {status ? (
                  <span
                    className={`admin-settings-nav__pill admin-settings-nav__pill--${status.tone}`}
                  >
                    {status.text}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        <div className="admin-settings-page__main">
          <section id="section-overview" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">At a glance</p>
                <h2 className="admin-settings-block__title">Platform status</h2>
              </div>
              <PlatformModeToggle />
            </header>

            <p className="admin-settings-block__desc">
              Dev mode uses Daraja sandbox credentials and lets merchants edit POS
              prices. Production uses live M-PESA and locked catalog prices.
            </p>

            <MotionList as="div" className="admin-settings-overview">
              <StatusMetric
                icon="fa-key"
                tone="amber"
                label="Daraja API"
                hint="Safaricom platform credentials"
                value={darajaReady ? "Configured" : "Not set"}
                loading={loading}
                status={darajaReady ? "ok" : "warn"}
              />
              <StatusMetric
                icon="fa-store"
                tone="indigo"
                label="Merchant M-PESA"
                hint="Shops with Paybill or Till"
                value={
                  loading
                    ? "—"
                    : `${merchantsReady} of ${merchantsTotal}`
                }
                loading={loading}
                status={merchantsReady > 0 ? "ok" : "neutral"}
                sub={loading ? undefined : `${merchantAdoption}% adoption`}
              />
              <StatusMetric
                icon="fa-robot"
                tone="indigo"
                label="ChatGPT agent"
                hint="DM and comment AI replies"
                value={aiReady ? "Configured" : "Not set"}
                loading={loading}
                status={aiReady ? "ok" : "warn"}
              />
              <StatusMetric
                icon="fa-map-location-dot"
                tone="emerald"
                label="Google Maps"
                hint="Location pickers platform-wide"
                value={mapsReady ? "Configured" : "Not set"}
                loading={loading}
                status={mapsReady ? "ok" : "warn"}
              />
            </MotionList>
          </section>

          <section id="section-messaging" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Instagram</p>
                <h2 className="admin-settings-block__title">DM tickets</h2>
                <p className="admin-settings-block__desc">
                  Greeting wait time and ticket auto-close when the customer does not reply.
                </p>
              </div>
            </header>
            <MessagingSettingsSection />
          </section>

          <section id="section-ai-agent" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Intelligence</p>
                <h2 className="admin-settings-block__title">ChatGPT (AI agent)</h2>
                <p className="admin-settings-block__desc">
                  OpenAI API key for Instagram DM and comment auto-replies. When set, agents use
                  ChatGPT instead of Gemini.
                </p>
              </div>
              {!loading ? (
                <span
                  className={`admin-pill ${
                    aiReady ? "admin-pill--success" : "admin-pill--warning"
                  }`}
                >
                  {aiReady ? "Configured" : "Action needed"}
                </span>
              ) : null}
            </header>
            <AiAgentSettingsSection />
          </section>

          <section id="section-mpesa" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Payments</p>
                <h2 className="admin-settings-block__title">M-PESA (Daraja)</h2>
                <p className="admin-settings-block__desc">
                  Client → DukAI → Merchant. Hub credentials power the middle step. Test connection
                  here; edit keys in <code>.env</code> and restart the backend.
                </p>
              </div>
              {!loading ? (
                <span
                  className={`admin-pill ${
                    darajaReady ? "admin-pill--success" : "admin-pill--warning"
                  }`}
                >
                  {darajaReady ? "Configured" : "Action needed"}
                </span>
              ) : null}
            </header>
            <MpesaSettingsSection mode="admin" />
          </section>

          <section id="section-payment-sim" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Payments</p>
                <h2 className="admin-settings-block__title">Payment simulation</h2>
                <p className="admin-settings-block__desc">
                  Run the full Client → DukAI → Merchant path with a real phone or an instant Dev
                  simulation.
                </p>
              </div>
            </header>
            <PaymentSimulationSection />
          </section>

          <section id="section-merchant-payout" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Payments</p>
                <h2 className="admin-settings-block__title">Send to merchant</h2>
                <p className="admin-settings-block__desc">
                  DukAI → Merchant only — B2B payout when the hub already holds funds from a prior
                  Client → DukAI collection.
                </p>
              </div>
            </header>
            <MerchantPayoutSection />
          </section>

          <section id="section-google-maps" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Location</p>
                <h2 className="admin-settings-block__title">Google Maps</h2>
                <p className="admin-settings-block__desc">
                  API key and map defaults for location pickers across registration, POS, and
                  order tracking.
                </p>
              </div>
              {!loading ? (
                <span
                  className={`admin-pill ${
                    mapsReady ? "admin-pill--success" : "admin-pill--warning"
                  }`}
                >
                  {mapsReady ? "Configured" : "Action needed"}
                </span>
              ) : null}
            </header>
            <GoogleMapsSettingsSection />
          </section>

          <section id="section-email" className="admin-settings-block">
            <header className="admin-settings-block__head">
              <div>
                <p className="admin-settings-block__eyebrow">Delivery</p>
                <h2 className="admin-settings-block__title">Email</h2>
                <p className="admin-settings-block__desc">
                  Send a test message to confirm Mailtrap delivery is working.
                </p>
              </div>
            </header>
            <EmailTestSection />
          </section>
        </div>
      </div>
    </section>
  );
}

function StatusMetric({
  icon,
  tone,
  label,
  hint,
  value,
  sub,
  loading,
  status,
}: {
  icon: string;
  tone: "indigo" | "emerald" | "amber";
  label: string;
  hint: string;
  value: string;
  sub?: string;
  loading: boolean;
  status: "ok" | "warn" | "neutral";
}) {
  return (
    <MotionItem
      as="article"
      className={`admin-settings-metric admin-settings-metric--${tone} admin-settings-metric--${status}`}
    >
      <span className="admin-settings-metric__icon" aria-hidden="true">
        <i className={`fas ${icon}`} />
      </span>
      <div className="admin-settings-metric__body">
        <span className="admin-settings-metric__label">{label}</span>
        <span className="admin-settings-metric__hint">{hint}</span>
        {loading ? (
          <Skeleton variant="text" width={120} height={22} />
        ) : (
          <strong className="admin-settings-metric__value">{value}</strong>
        )}
        {sub && !loading ? (
          <span className="admin-settings-metric__sub">{sub}</span>
        ) : null}
      </div>
      {!loading ? (
        <span
          className={`admin-settings-metric__flag fas ${
            status === "ok"
              ? "fa-circle-check"
              : status === "warn"
                ? "fa-circle-exclamation"
                : "fa-circle"
          }`}
          aria-hidden="true"
        />
      ) : null}
    </MotionItem>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { MotionFade, MotionItem, MotionList } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import type { DmBotOption, MessagingSettingsResponse } from "@/lib/types";

export default function AdminBotsPage() {
  const [bots, setBots] = useState<DmBotOption[]>([]);
  const [selected, setSelected] = useState<string>("ai_agent");
  const [waitDmTimeSeconds, setWaitDmTimeSeconds] = useState(10);
  const [pauseAutoResponses, setPauseAutoResponses] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<MessagingSettingsResponse>(apiRoutes.messagingSettings)
      .then((data) => {
        if (cancelled) return;
        setBots(data.available_bots ?? []);
        setSelected(data.settings.dm_bot ?? "ai_agent");
        setWaitDmTimeSeconds(data.settings.wait_dm_time_seconds);
        setPauseAutoResponses(data.settings.pause_auto_responses ?? false);
        setExpandedId(data.settings.dm_bot ?? "ai_agent");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load bots.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function activateBot(botId: string) {
    if (botId === selected || savingId) {
      return;
    }

    setSavingId(botId);
    const previous = selected;
    setSelected(botId);
    try {
      const data = await apiFetch<MessagingSettingsResponse>(apiRoutes.messagingSettings, {
        method: "PUT",
        body: JSON.stringify({
          wait_dm_time_seconds: waitDmTimeSeconds,
          pause_auto_responses: pauseAutoResponses,
          dm_bot: botId,
        }),
      });
      setSelected(data.settings.dm_bot);
      toastSuccess(`${bots.find((b) => b.id === botId)?.label ?? "Bot"} is now active.`);
    } catch (err) {
      setSelected(previous);
      showError(extractErrorMessage(err, "Could not activate bot."));
    } finally {
      setSavingId(null);
    }
  }

  function toggleExpanded(botId: string) {
    setExpandedId((current) => (current === botId ? null : botId));
  }

  return (
    <section className="admin-page admin-bots-page">
      <header className="admin-page__header">
        <div>
          <span className="admin-chip admin-bots-page__chip">
            <i className="fas fa-robot" aria-hidden="true" />
            Instagram DMs
          </span>
          <h1 className="admin-page__title">Bots &amp; AI</h1>
          <p className="admin-page__lead">
            Compare how each engine handles customer DMs, then pick the one that runs
            platform-wide for every merchant.
          </p>
        </div>
        {!loading ? (
          <div className="admin-bots-page__header-actions">
            <div className="admin-bots-page__active-pill" aria-live="polite">
              <span className="admin-bots-page__active-label">Active</span>
              <strong>{bots.find((b) => b.id === selected)?.label ?? selected}</strong>
            </div>
            <Link href="/admin/bot-test" className="admin-btn admin-btn--ghost">
              <i className="fa-solid fa-flask" aria-hidden="true" />
              Test bot
            </Link>
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

      {loading ? (
        <div className="admin-bots-page__list">
          {[1, 2, 3].map((n) => (
            <div key={n} className="admin-bots-card admin-bots-card--loading">
              <Skeleton variant="text" width="40%" height={24} />
              <Skeleton variant="text" width="100%" height={48} />
            </div>
          ))}
        </div>
      ) : (
        <MotionList as="div" className="admin-bots-page__list">
          {bots.map((bot) => {
            const isActive = selected === bot.id;
            const isExpanded = expandedId === bot.id;
            const isSaving = savingId === bot.id;

            return (
              <MotionItem
                key={bot.id}
                as="article"
                className={`admin-bots-card${isActive ? " is-active" : ""}${
                  isExpanded ? " is-expanded" : ""
                }`}
              >
                <header className="admin-bots-card__head">
                  <button
                    type="button"
                    className="admin-bots-card__toggle"
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(bot.id)}
                  >
                    <span className="admin-bots-card__icon" aria-hidden="true">
                      <i className={`fa-solid ${bot.icon}`} />
                    </span>
                    <span className="admin-bots-card__titles">
                      <strong>{bot.label}</strong>
                      {bot.tagline ? <span>{bot.tagline}</span> : null}
                    </span>
                    <i
                      className={`fas fa-chevron-down admin-bots-card__chevron${
                        isExpanded ? " is-open" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  <div className="admin-bots-card__actions">
                    {isActive ? (
                      <span className="admin-bots-card__status">In use</span>
                    ) : (
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary admin-btn--sm"
                        disabled={isSaving || savingId !== null}
                        onClick={() => void activateBot(bot.id)}
                      >
                        {isSaving ? "Activating…" : "Use this bot"}
                      </button>
                    )}
                  </div>
                </header>

                {isExpanded ? (
                  <div className="admin-bots-card__body">
                    <p className="admin-bots-card__description">{bot.description}</p>

                    {bot.capabilities?.length ? (
                      <section className="admin-bots-card__section">
                        <h3>What it can do</h3>
                        <ul>
                          {bot.capabilities.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {bot.flow_steps?.length ? (
                      <section className="admin-bots-card__section">
                        <h3>Conversation flow</h3>
                        <ol>
                          {bot.flow_steps.map((step, index) => (
                            <li key={step}>
                              <span className="admin-bots-card__step-num">{index + 1}</span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </section>
                    ) : null}

                    <div className="admin-bots-card__meta">
                      {bot.best_for ? (
                        <div className="admin-bots-card__meta-block admin-bots-card__meta-block--ok">
                          <h4>Best for</h4>
                          <p>{bot.best_for}</p>
                        </div>
                      ) : null}
                      {bot.limitations ? (
                        <div className="admin-bots-card__meta-block admin-bots-card__meta-block--warn">
                          <h4>Limitations</h4>
                          <p>{bot.limitations}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </MotionItem>
            );
          })}
        </MotionList>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import type { OnboardingCheck, OnboardingChecklist } from "@/lib/types";

const INTERNAL_ACTIONS: Record<string, { href: string; label: string }> = {
  instagram_connected: { href: "/settings#section-channels", label: "Connect in Settings" },
  webhooks_subscribed: { href: "/settings#section-channels", label: "Reconnect Instagram" },
};

type Props = {
  data: OnboardingChecklist;
  refreshing?: boolean;
  onRefresh?: () => void;
};

function accountTypeLabel(accountType: string | null | undefined): string {
  switch (accountType) {
    case "BUSINESS":
      return "Business";
    case "MEDIA_CREATOR":
      return "Creator";
    case "PERSONAL":
      return "Personal";
    default:
      return accountType ? accountType.replaceAll("_", " ") : "Not detected";
  }
}

function CheckRow({ check }: { check: OnboardingCheck }) {
  const action = !check.passed ? INTERNAL_ACTIONS[check.key] : undefined;

  return (
    <li className={`onboarding-check ${check.passed ? "onboarding-check--done" : "onboarding-check--pending"}`}>
      <span className="onboarding-check__icon" aria-hidden="true">
        {check.passed ? "✓" : "○"}
      </span>
      <div className="onboarding-check__body">
        <strong>{check.label}</strong>
        <p>{check.description}</p>
        {!check.passed ? (
          <div className="onboarding-check__actions">
            {action ? (
              <Link href={action.href} className="onboarding-check__link">
                {action.label} →
              </Link>
            ) : null}
            {check.help_url ? (
              <a
                href={check.help_url}
                target="_blank"
                rel="noopener noreferrer"
                className="onboarding-check__link"
              >
                How to fix →
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function OnboardingChecklistPanel({ data, refreshing = false, onRefresh }: Props) {
  const passedCount = data.checks.filter((check) => check.passed).length;
  const totalCount = data.checks.length;
  const progress = totalCount ? Math.round((passedCount / totalCount) * 100) : 0;

  return (
    <div className="onboarding-page">
      <header className="onboarding-page__header">
        <div>
          <p className="onboarding-page__eyebrow">Setup checklist</p>
          <h1 className="app-title">Complete your setup</h1>
          <p className="app-lead">
            Finish every step for{" "}
            <strong>@{data.account.username ?? "your account"}</strong> before opening the inbox.
          </p>
        </div>
        <div className="onboarding-page__progress" aria-label={`${passedCount} of ${totalCount} steps complete`}>
          <span className="onboarding-page__progress-value">{passedCount}/{totalCount}</span>
          <div className="onboarding-page__progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      <section className="onboarding-card">
        <h2>Your account</h2>
        <dl className="onboarding-meta">
          <div>
            <dt>Username</dt>
            <dd>{data.account.username ? `@${data.account.username}` : "Not available yet"}</dd>
          </div>
          <div>
            <dt>Account type</dt>
            <dd>{accountTypeLabel(data.account.account_type)}</dd>
          </div>
        </dl>
      </section>

      {data.permissions?.requested?.length ? (
        <section className="onboarding-card">
          <h2>Permissions granted</h2>
          <ul className="onboarding-permissions">
            {data.permissions.requested.map((scope) => {
              const granted = data.permissions.granted.includes(scope);
              return (
                <li key={scope} className={granted ? "granted" : "missing"}>
                  <span aria-hidden="true">{granted ? "✓" : "○"}</span>
                  <code>{scope}</code>
                </li>
              );
            })}
          </ul>
          {data.permissions.missing.length ? (
            <p className="app-muted onboarding-permissions__hint">
              Reconnect and approve: {data.permissions.missing.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="onboarding-card">
        <h2>Requirements</h2>
        <ul className="onboarding-checklist">
          {data.checks.map((check) => (
            <CheckRow key={check.key} check={check} />
          ))}
        </ul>
      </section>

      <div className="onboarding-page__footer">
        {onRefresh ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? "Re-checking…" : "Re-check requirements"}
          </button>
        ) : null}
        {data.onboarding_complete ? (
          <Link href="/messages" className="btn btn-primary">
            Open inbox
          </Link>
        ) : (
          <p className="app-muted">
            After updating Instagram or Meta settings, click re-check to refresh your status.
          </p>
        )}
      </div>
    </div>
  );
}

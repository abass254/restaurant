"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastError,
  toastSuccess,
} from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import { apiRoutes, isDebugMode } from "@/lib/config";

type Starter = {
  id: number;
  question: string;
  reply_text: string | null;
  is_active: boolean;
};

type StartersResponse = {
  starters: Starter[];
  max_starters: number;
  max_persistent_menu: number;
  max_quick_replies: number;
  meta_ice_breaker_questions: string[];
  meta_persistent_menu_titles: string[];
  webhook_fields: string[];
  connection_warnings: string[];
  sync_error: string | null;
};

const QUESTION_LIMIT = 80;
const REPLY_LIMIT = 1000;

export default function ConversationStartersPage() {
  const [data, setData] = useState<StartersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const [newQuestion, setNewQuestion] = useState("");
  const [newReply, setNewReply] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [creating, setCreating] = useState(false);

  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await apiFetch<StartersResponse>(
        apiRoutes.conversationStarters,
      );
      setData(next);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load starters."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const starters = data?.starters ?? [];
  const max = data?.max_starters ?? 4;
  const activeCount = starters.filter((s) => s.is_active).length;
  const atLimit = activeCount >= max;

  const metaIceCount = data?.meta_ice_breaker_questions.length ?? 0;
  const metaMenuCount = data?.meta_persistent_menu_titles.length ?? 0;
  const webhookOk =
    data?.webhook_fields?.includes("messaging_postbacks") ?? false;

  // Sync detection: compare local active starters against BOTH live surfaces
  // on Meta (ice breakers + persistent menu). A drift on either one is enough
  // to surface the "Push now" banner so the user never has to wonder which
  // surface is stale. The persistent-menu title gets shortened to 30 chars on
  // push (see backend), so we mirror that here to avoid false positives.
  const inSync = useMemo(() => {
    if (!data) return true;
    const local = starters
      .filter((s) => s.is_active)
      .map((s) => s.question);
    const localIce = [...local].sort();
    const metaIce = [...data.meta_ice_breaker_questions].sort();
    if (localIce.length !== metaIce.length) return false;
    if (!localIce.every((q, i) => q === metaIce[i])) return false;

    const localMenu = local
      .slice(0, data.max_persistent_menu)
      .map((q) => (q.length <= 30 ? q : q.slice(0, 29).trimEnd() + "…"))
      .sort();
    const metaMenu = [...data.meta_persistent_menu_titles].sort();
    if (localMenu.length !== metaMenu.length) return false;
    return localMenu.every((q, i) => q === metaMenu[i]);
  }, [data, starters]);

  const setBusy = useCallback((id: number, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const q = newQuestion.trim();
    if (!q) return;
    setCreating(true);
    try {
      await apiFetch(apiRoutes.conversationStarters, {
        method: "POST",
        body: JSON.stringify({
          question: q,
          reply_text: newReply.trim() || null,
        }),
      });
      setNewQuestion("");
      setNewReply("");
      setShowReply(false);
      await reload();
      await toastSuccess("Chip added. Push to Instagram to apply.");
    } catch (err) {
      await showError("Couldn't add chip", extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(starter: Starter) {
    setBusy(starter.id, true);
    try {
      await apiFetch(
        `${apiRoutes.conversationStarters}/${starter.id}/toggle`,
        { method: "POST" },
      );
      await reload();
    } catch (err) {
      await toastError(extractErrorMessage(err, "Could not update chip."));
    } finally {
      setBusy(starter.id, false);
    }
  }

  async function handleDelete(starter: Starter) {
    const ok = await confirmAction(
      "Remove this chip?",
      `"${starter.question}" will no longer appear in customer DMs.`,
      "Remove",
    );
    if (!ok) return;
    setBusy(starter.id, true);
    try {
      await apiFetch(
        `${apiRoutes.conversationStarters}/${starter.id}`,
        { method: "DELETE" },
      );
      await reload();
      await toastSuccess("Chip removed.");
    } catch (err) {
      await toastError(extractErrorMessage(err, "Could not remove chip."));
    } finally {
      setBusy(starter.id, false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await apiFetch(`${apiRoutes.conversationStarters}/sync`, {
        method: "POST",
      });
      await reload();
      await toastSuccess("Pushed to Instagram.");
    } catch (err) {
      await showError(
        "Could not push to Instagram",
        extractErrorMessage(err),
      );
    } finally {
      setSyncing(false);
    }
  }

  const warnings = data?.connection_warnings ?? [];
  const warningCount = warnings.length + (data?.sync_error ? 1 : 0);
  // Any warning whose remedy is "Push to Instagram" gets an inline button so
  // the user doesn't have to scroll back up to the header to act on it.
  const hasPushableWarning = warnings.some((w) => /push to instagram/i.test(w));

  return (
    <section className="cs-shell">
      <header className="cs-header">
        <div className="cs-header__title">
          <h1>Conversation chips</h1>
          <button
            type="button"
            className={`cs-iconbtn${showInfo ? " is-on" : ""}`}
            aria-label="About conversation chips"
            aria-pressed={showInfo}
            onClick={() => setShowInfo((v) => !v)}
          >
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm cs-push"
          onClick={() => void handleSync()}
          disabled={syncing || starters.length === 0}
        >
          {syncing ? (
            <>
              <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
              Pushing…
            </>
          ) : (
            <>
              <i className="fa-brands fa-instagram" aria-hidden="true" />
              Push to Instagram
            </>
          )}
        </button>
      </header>

      {showInfo ? (
        <div className="cs-info">
          <p>Tappable buttons shown to customers in three places:</p>
          <ul>
            <li>
              <strong>Ice breakers</strong> — when someone opens a brand-new DM
              (max {max}).
            </li>
            <li>
              <strong>Persistent menu</strong> — pinned in existing threads
              (max {data?.max_persistent_menu ?? 5}).
            </li>
            <li>
              <strong>Welcome chips</strong> — quick replies attached to your
              first auto-reply (max {data?.max_quick_replies ?? 13}).
            </li>
          </ul>
        </div>
      ) : null}

      <div className="cs-stats">
        <span className={`cs-stat${atLimit ? " is-full" : ""}`}>
          <i className="fa-solid fa-comment-dots" aria-hidden="true" />
          <strong>
            {activeCount}/{max}
          </strong>
          <small>active</small>
        </span>
        <span
          className={`cs-stat ${metaIceCount > 0 ? "is-ok" : "is-warn"}`}
          title="Ice breakers currently visible on Meta"
        >
          <i className="fa-solid fa-comments" aria-hidden="true" />
          <strong>{metaIceCount}</strong>
          <small>ice breakers</small>
        </span>
        <span
          className={`cs-stat ${metaMenuCount > 0 ? "is-ok" : "is-warn"}`}
          title="Persistent menu items currently visible on Meta"
        >
          <i className="fa-solid fa-bars" aria-hidden="true" />
          <strong>{metaMenuCount}</strong>
          <small>menu items</small>
        </span>
        <span
          className={`cs-stat ${webhookOk ? "is-ok" : "is-warn"}`}
          title="messaging_postbacks webhook"
        >
          <i
            className={`fa-solid ${
              webhookOk ? "fa-link" : "fa-link-slash"
            }`}
            aria-hidden="true"
          />
          <small>{webhookOk ? "webhook on" : "webhook off"}</small>
        </span>
      </div>

      {isDebugMode && data ? (
        <details className="cs-debug">
          <summary>
            <i className="fa-solid fa-bug" aria-hidden="true" />
            What Meta sees
            <span className="cs-debug__summary-meta">
              ice {data.meta_ice_breaker_questions.length} · menu{" "}
              {data.meta_persistent_menu_titles.length} · webhook{" "}
              {webhookOk ? "on" : "off"}
            </span>
          </summary>
          <div className="cs-debug__body">
            <section>
              <h4>
                Ice breakers
                <span>{data.meta_ice_breaker_questions.length}</span>
              </h4>
              {data.meta_ice_breaker_questions.length === 0 ? (
                <p className="cs-debug__empty">
                  None — Meta has no ice breakers for this account.
                </p>
              ) : (
                <ul>
                  {data.meta_ice_breaker_questions.map((q, i) => (
                    <li key={`ice-${i}-${q}`}>
                      <code>{q}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4>
                Persistent menu
                <span>{data.meta_persistent_menu_titles.length}</span>
              </h4>
              {data.meta_persistent_menu_titles.length === 0 ? (
                <p className="cs-debug__empty">
                  None — Meta has no persistent menu for this account.
                </p>
              ) : (
                <ul>
                  {data.meta_persistent_menu_titles.map((t, i) => (
                    <li key={`menu-${i}-${t}`}>
                      <code>{t}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4>
                Webhook fields
                <span>{data.webhook_fields.length}</span>
              </h4>
              {data.webhook_fields.length === 0 ? (
                <p className="cs-debug__empty">
                  None — app is not subscribed to any Instagram webhooks.
                </p>
              ) : (
                <ul className="cs-debug__chips">
                  {data.webhook_fields.map((f) => (
                    <li
                      key={f}
                      className={
                        f === "messaging_postbacks" ? "is-required" : ""
                      }
                    >
                      <code>{f}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="cs-debug__hint">
              <i className="fa-solid fa-circle-info" aria-hidden="true" />
              Live data from <code>GET /me/messenger_profile</code>. Visible
              because <code>NEXT_PUBLIC_DEBUG</code> is on (auto in dev).
            </p>
          </div>
        </details>
      ) : null}

      {!loading && data && !inSync ? (
        <div className="cs-banner">
          <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          <span>Local changes aren&apos;t live on Instagram yet.</span>
          <button
            type="button"
            className="cs-banner__action"
            onClick={() => void handleSync()}
            disabled={syncing}
          >
            {syncing ? "Pushing…" : "Push now"}
          </button>
        </div>
      ) : null}

      {error ? <p className="cs-error">{error}</p> : null}

      {warningCount > 0 ? (
        <details className="cs-details">
          <summary>
            <i
              className="fa-solid fa-triangle-exclamation"
              aria-hidden="true"
            />
            {warningCount} setup {warningCount === 1 ? "note" : "notes"}
          </summary>
          <ul>
            {data?.sync_error ? (
              <li>Sync warning: {data.sync_error}</li>
            ) : null}
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {hasPushableWarning ? (
            <div className="cs-details__action">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSync()}
                disabled={syncing || starters.length === 0}
              >
                <i className="fa-brands fa-instagram" aria-hidden="true" />
                {syncing ? "Pushing…" : "Push to Instagram"}
              </button>
            </div>
          ) : null}
        </details>
      ) : null}

      <div className="cs-list">
        {loading ? (
          <>
            <Skeleton variant="rect" height={72} />
            <Skeleton variant="rect" height={72} />
            <Skeleton variant="rect" height={72} />
          </>
        ) : starters.length === 0 ? (
          <p className="cs-empty">
            No chips yet — add your first one below.
          </p>
        ) : (
          starters.map((s) => (
            <StarterRow
              key={s.id}
              starter={s}
              busy={busyIds.has(s.id)}
              onToggle={() => void handleToggle(s)}
              onDelete={() => void handleDelete(s)}
            />
          ))
        )}
      </div>

      <form
        className={`cs-add${atLimit ? " is-disabled" : ""}`}
        onSubmit={handleCreate}
      >
        <div className="cs-add__row">
          <i className="fa-solid fa-plus cs-add__icon" aria-hidden="true" />
          <input
            type="text"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder={
              atLimit
                ? "Pause a chip to add another"
                : "Add a chip (e.g. View today's offers)"
            }
            maxLength={QUESTION_LIMIT}
            disabled={atLimit || creating}
          />
          {newQuestion ? (
            <small className="cs-add__count">
              {newQuestion.length}/{QUESTION_LIMIT}
            </small>
          ) : null}
        </div>

        {newQuestion ? (
          <>
            <button
              type="button"
              className="cs-add__optional"
              onClick={() => setShowReply((v) => !v)}
            >
              <i
                className={`fa-solid ${
                  showReply ? "fa-chevron-up" : "fa-chevron-down"
                }`}
                aria-hidden="true"
              />
              {showReply ? "Hide instant reply" : "Add an instant reply (optional)"}
            </button>
            {showReply ? (
              <div className="cs-add__row cs-add__row--reply">
                <textarea
                  value={newReply}
                  onChange={(e) => setNewReply(e.target.value)}
                  rows={2}
                  maxLength={REPLY_LIMIT}
                  placeholder="What we send when a customer taps this chip"
                />
                <small className="cs-add__count">
                  {newReply.length}/{REPLY_LIMIT}
                </small>
              </div>
            ) : null}
            <div className="cs-add__actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setNewQuestion("");
                  setNewReply("");
                  setShowReply(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!newQuestion.trim() || creating || atLimit}
              >
                {creating ? "Adding…" : "Add chip"}
              </button>
            </div>
          </>
        ) : null}
      </form>
    </section>
  );
}

function StarterRow({
  starter,
  busy,
  onToggle,
  onDelete,
}: {
  starter: Starter;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasReply = !!starter.reply_text?.trim();

  return (
    <article
      className={`cs-row${starter.is_active ? " is-active" : " is-paused"}`}
    >
      <div className="cs-row__main">
        <button
          type="button"
          className="cs-row__title"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`Open chip "${starter.question}"`}
        >
          <span className="cs-row__chip">
            <i
              className={`fa-solid ${
                starter.is_active ? "fa-circle-check" : "fa-circle-pause"
              }`}
              aria-hidden="true"
            />
          </span>
          <span className="cs-row__question">{starter.question}</span>
          {hasReply ? (
            <span className="cs-row__badge" title="Instant reply set">
              <i className="fa-solid fa-reply" aria-hidden="true" />
              reply
            </span>
          ) : null}
          <i
            className={`fa-solid fa-chevron-${
              expanded ? "up" : "down"
            } cs-row__caret`}
            aria-hidden="true"
          />
        </button>
        <div className="cs-row__actions">
          <button
            type="button"
            role="switch"
            aria-checked={starter.is_active}
            aria-label={starter.is_active ? "Pause chip" : "Activate chip"}
            className={`settings-toggle__switch${
              starter.is_active ? " is-on" : ""
            }`}
            disabled={busy}
            onClick={onToggle}
          >
            <span className="settings-toggle__thumb" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cs-iconbtn cs-iconbtn--danger"
            aria-label="Delete chip"
            onClick={onDelete}
            disabled={busy}
          >
            <i className="fa-solid fa-trash" aria-hidden="true" />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="cs-row__detail">
          {hasReply ? (
            <p className="cs-row__reply">
              <span className="cs-row__reply-label">Instant reply</span>
              {starter.reply_text}
            </p>
          ) : (
            <p className="cs-row__reply cs-row__reply--empty">
              No instant reply set for this chip.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

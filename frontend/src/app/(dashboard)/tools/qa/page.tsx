"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { MotionModal } from "@/components/app/MotionModal";
import { Skeleton } from "@/components/app/Skeleton";
import { ListLoadError } from "@/components/app/ListLoadError";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  QA_COMPONENTS,
  QA_ISSUE_TYPES,
  QA_PRIORITIES,
  QA_STATUSES,
  isInternalToolsUser,
  type QaComponent,
  type QaIssueType,
  type QaPriority,
  type QaStatus,
} from "@/lib/qa-access";
import type {
  QaAssigneeRecord,
  QaAssigneesListResponse,
  QaIssueRecord,
  QaIssuesListResponse,
} from "@/lib/types";

type ViewMode = "list" | "kanban";
type ScopeFilter = "all" | "mine" | "assigned";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return formatNairobiDateTime(iso) || "—";
}

function labelFor(
  options: readonly { value: string; label: string }[],
  value: string,
): string {
  return options.find((item) => item.value === value)?.label ?? value;
}

function issueTypePill(type: string): string {
  return `qa-issue-pill is-${type.replace(/_/g, "-")}`;
}

function priorityPill(priority: string): string {
  return `qa-issue-pill is-priority-${priority.replace(/_/g, "-")}`;
}

function assigneeLabel(issue: QaIssueRecord): string {
  return issue.assignee_name ?? issue.assignee_email ?? "Unassigned";
}

function patchIssueInList(
  issues: QaIssueRecord[],
  updated: QaIssueRecord,
): QaIssueRecord[] {
  return issues.map((row) => (row.id === updated.id ? updated : row));
}

export default function ToolsQaPage() {
  const user = useAuthUser();
  const router = useRouter();
  const allowed = isInternalToolsUser(user);

  const [issues, setIssues] = useState<QaIssueRecord[]>([]);
  const [assignees, setAssignees] = useState<QaAssigneeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("kanban");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailIssue, setDetailIssue] = useState<QaIssueRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<QaStatus | null>(null);

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<QaIssueType>("bug");
  const [priority, setPriority] = useState<QaPriority>("medium");
  const [component, setComponent] = useState<QaComponent>("general");
  const [pageUrl, setPageUrl] = useState("");
  const [steps, setSteps] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    if (!allowed) router.replace("/tools/starters");
  }, [allowed, router]);

  useEffect(() => {
    if (typeof window !== "undefined" && !pageUrl) {
      setPageUrl(window.location.pathname);
    }
  }, [pageUrl]);

  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (scope === "mine") params.set("mine", "1");
      if (scope === "assigned") params.set("assigned", "me");
      const data = await apiFetch<QaIssuesListResponse>(
        `${apiRoutes.qaIssues}?${params.toString()}`,
      );
      setIssues(data.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err, "Could not load issues."));
    } finally {
      setLoading(false);
    }
  }, [allowed, scope]);

  useEffect(() => {
    if (!allowed) return;
    void apiFetch<QaAssigneesListResponse>(apiRoutes.qaAssignees)
      .then((data) => setAssignees(data.data))
      .catch((err) => console.error(err));
  }, [allowed]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((issue) =>
      [
        issue.key,
        issue.summary,
        issue.description ?? "",
        issue.component,
        issue.reporter_name ?? "",
        issue.reporter_email ?? "",
        issue.assignee_name ?? "",
        issue.assignee_email ?? "",
        issue.account_name ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [issues, search]);

  const issuesByStatus = useMemo(() => {
    const grouped = Object.fromEntries(
      QA_STATUSES.map((item) => [item.value, [] as QaIssueRecord[]]),
    ) as Record<QaStatus, QaIssueRecord[]>;
    for (const issue of filtered) {
      const status = issue.status as QaStatus;
      if (grouped[status]) grouped[status].push(issue);
    }
    return grouped;
  }, [filtered]);

  function resetCreateForm() {
    setSummary("");
    setDescription("");
    setIssueType("bug");
    setPriority("medium");
    setComponent("general");
    setSteps("");
    setAssigneeId("");
    setPageUrl(typeof window !== "undefined" ? window.location.pathname : "");
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (submitting || !summary.trim()) return;
    setSubmitting(true);
    try {
      const created = await apiFetch<QaIssueRecord>(apiRoutes.qaIssues, {
        method: "POST",
        body: JSON.stringify({
          summary: summary.trim(),
          description: description.trim() || null,
          issue_type: issueType,
          priority,
          component,
          page_url: pageUrl.trim() || null,
          steps_to_reproduce: steps.trim() || null,
          assignee_id: assigneeId || null,
        }),
      });
      await toastSuccess(`${created.key} created`);
      resetCreateForm();
      setCreateOpen(false);
      setDetailIssue(created);
      setIssues((rows) => [created, ...rows]);
    } catch (err) {
      await showError("Could not create issue", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function patchIssue(
    issue: QaIssueRecord,
    payload: Record<string, string | null>,
  ) {
    if (updatingId) return null;
    setUpdatingId(issue.id);
    try {
      const updated = await apiFetch<QaIssueRecord>(apiRoutes.qaIssue(issue.id), {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setIssues((rows) => patchIssueInList(rows, updated));
      setDetailIssue((current) => (current?.id === updated.id ? updated : current));
      return updated;
    } catch (err) {
      await showError("Could not update issue", extractErrorMessage(err));
      return null;
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateIssueStatus(issue: QaIssueRecord, status: QaStatus) {
    if (issue.status === status) return;
    const updated = await patchIssue(issue, { status });
    if (updated) await toastSuccess(`${updated.key} moved to ${labelFor(QA_STATUSES, status)}`);
  }

  async function updateIssueAssignee(issue: QaIssueRecord, nextAssigneeId: string) {
    const updated = await patchIssue(issue, { assignee_id: nextAssigneeId || null });
    if (updated) await toastSuccess(`${updated.key} assignee updated`);
  }

  function onCardDragStart(event: DragEvent, issueId: string) {
    setDraggingId(issueId);
    event.dataTransfer.setData("text/plain", issueId);
    event.dataTransfer.effectAllowed = "move";
  }

  function onColumnDragOver(event: DragEvent, status: QaStatus) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropStatus(status);
  }

  async function onColumnDrop(event: DragEvent, status: QaStatus) {
    event.preventDefault();
    setDropStatus(null);
    const issueId = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (!issueId) return;
    const issue = issues.find((row) => row.id === issueId);
    if (!issue || issue.status === status) return;
    await updateIssueStatus(issue, status);
  }

  if (!allowed) return null;

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">QA</h1>
          <p className="app-lead">
            Track bugs and improvements found while testing the merchant app.
          </p>
        </div>
        <div className="inventory-header__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setCreateOpen(true)}
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            Create issue
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setLoading(true);
              void reload();
            }}
            title="Refresh issues"
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      <div className="inventory-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search issues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <div className="inventory-toolbar__filters" role="group" aria-label="Scope">
          {(
            [
              ["all", "All"],
              ["mine", "Reported by me"],
              ["assigned", "Assigned to me"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm ${scope === value ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
                setLoading(true);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="inventory-toolbar__view" role="group" aria-label="View">
          <button
            type="button"
            className={view === "list" ? "is-active" : ""}
            aria-pressed={view === "list"}
            title="List view"
            onClick={() => setView("list")}
          >
            <i className="fa-solid fa-list" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={view === "kanban" ? "is-active" : ""}
            aria-pressed={view === "kanban"}
            title="Kanban view"
            onClick={() => setView("kanban")}
          >
            <i className="fa-solid fa-table-columns" aria-hidden="true" />
          </button>
        </div>
      </div>

      {loading ? (
        <QaSkeleton view={view} />
      ) : loadError && issues.length === 0 ? (
        <ListLoadError
          title="Could not load issues"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void reload();
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="inventory-empty">
          <i className="fa-solid fa-bug" aria-hidden="true" />
          <h2>{issues.length === 0 ? "No issues yet" : "No matches"}</h2>
          <p>
            {issues.length === 0
              ? "Create an issue when you spot something that needs fixing."
              : "Try a different search or filter."}
          </p>
        </div>
      ) : view === "kanban" ? (
        <div className="qa-kanban" aria-label="QA kanban board">
          {QA_STATUSES.map((column) => (
            <div
              key={column.value}
              className={`qa-kanban__column${dropStatus === column.value ? " is-drop-target" : ""}`}
              onDragOver={(event) => onColumnDragOver(event, column.value)}
              onDragLeave={() => setDropStatus(null)}
              onDrop={(event) => void onColumnDrop(event, column.value)}
            >
              <div className="qa-kanban__column-head">
                <span className="qa-kanban__column-title">{column.label}</span>
                <span className="qa-kanban__column-count">
                  {issuesByStatus[column.value].length}
                </span>
              </div>
              <div className="qa-kanban__cards">
                {issuesByStatus[column.value].map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    draggable
                    className={`qa-kanban__card${draggingId === issue.id ? " is-dragging" : ""}`}
                    onDragStart={(event) => onCardDragStart(event, issue.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropStatus(null);
                    }}
                    onClick={() => setDetailIssue(issue)}
                  >
                    <span className="qa-kanban__card-key">{issue.key}</span>
                    <span className="qa-kanban__card-summary">{issue.summary}</span>
                    <span className="qa-kanban__card-meta">
                      <span className={issueTypePill(issue.issue_type)}>
                        {labelFor(QA_ISSUE_TYPES, issue.issue_type)}
                      </span>
                      <span className={priorityPill(issue.priority)}>
                        {labelFor(QA_PRIORITIES, issue.priority)}
                      </span>
                      <span>{assigneeLabel(issue)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="inventory-table-wrap">
          <table className="inventory-table payment-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Component</th>
                <th>Reporter</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => (
                <tr
                  key={issue.id}
                  className="qa-table-row"
                  onClick={() => setDetailIssue(issue)}
                >
                  <td>
                    <strong>{issue.key}</strong>
                  </td>
                  <td>{issue.summary}</td>
                  <td>
                    <span className={issueTypePill(issue.issue_type)}>
                      {labelFor(QA_ISSUE_TYPES, issue.issue_type)}
                    </span>
                  </td>
                  <td>
                    <span className={priorityPill(issue.priority)}>
                      {labelFor(QA_PRIORITIES, issue.priority)}
                    </span>
                  </td>
                  <td>{labelFor(QA_STATUSES, issue.status)}</td>
                  <td>{assigneeLabel(issue)}</td>
                  <td>{labelFor(QA_COMPONENTS, issue.component)}</td>
                  <td>{issue.reporter_name ?? issue.reporter_email ?? "—"}</td>
                  <td>{formatWhen(issue.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MotionModal
        open={createOpen}
        onClose={() => {
          if (submitting) return;
          setCreateOpen(false);
          resetCreateForm();
        }}
        ariaLabel="Create QA issue"
        closeOnBackdrop={!submitting}
        closeOnEscape={!submitting}
      >
        <div className="inventory-modal__header">
          <h2 id="qa-create-title">Create issue</h2>
        </div>
        <form className="inventory-modal__body" onSubmit={(e) => void handleCreate(e)}>
          <label className="settings-field">
            <span>Summary</span>
            <input
              required
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short description of the issue"
            />
          </label>

          <div className="qa-create-panel__grid">
            <label className="settings-field">
              <span>Issue type</span>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as QaIssueType)}
              >
                {QA_ISSUE_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Priority</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as QaPriority)}
              >
                {QA_PRIORITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Component</span>
              <select
                value={component}
                onChange={(e) => setComponent(e.target.value as QaComponent)}
              >
                {QA_COMPONENTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="settings-field">
            <span>Assign to</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.email ? ` (${person.email})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>Page URL</span>
            <input
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              placeholder="/delivery"
            />
          </label>

          <label className="settings-field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? What did you expect?"
            />
          </label>

          <label className="settings-field">
            <span>Steps to reproduce</span>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder={"1. Go to …\n2. Click …\n3. See error"}
            />
          </label>

          <div className="inventory-modal__footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !summary.trim()}
            >
              {submitting ? "Creating…" : "Create issue"}
            </button>
          </div>
        </form>
      </MotionModal>

      <MotionModal
        open={Boolean(detailIssue)}
        onClose={() => setDetailIssue(null)}
        ariaLabel="Issue details"
        closeOnBackdrop={!updatingId}
        closeOnEscape={!updatingId}
      >
        {detailIssue ? (
          <>
            <div className="inventory-modal__header">
              <h2>
                {detailIssue.key} · {detailIssue.summary}
              </h2>
            </div>
            <div className="inventory-modal__body qa-detail-grid">
              <div className="qa-detail-body">
                <p className="app-muted">
                  Reported by {detailIssue.reporter_name ?? detailIssue.reporter_email ?? "Unknown"}
                  {detailIssue.account_name ? ` · ${detailIssue.account_name}` : ""}
                  {" · "}
                  {formatWhen(detailIssue.created_at)}
                </p>

                {detailIssue.description ? (
                  <div className="qa-detail-section">
                    <h4>Description</h4>
                    <p>{detailIssue.description}</p>
                  </div>
                ) : null}

                {detailIssue.steps_to_reproduce ? (
                  <div className="qa-detail-section">
                    <h4>Steps to reproduce</h4>
                    <pre>{detailIssue.steps_to_reproduce}</pre>
                  </div>
                ) : null}

                {detailIssue.page_url ? (
                  <div className="qa-detail-section">
                    <h4>Page</h4>
                    <p>
                      <a href={detailIssue.page_url}>{detailIssue.page_url}</a>
                    </p>
                  </div>
                ) : null}
              </div>

              <aside className="qa-detail-aside">
                <label className="settings-field">
                  <span>Status</span>
                  <select
                    value={detailIssue.status}
                    disabled={updatingId === detailIssue.id}
                    onChange={(e) =>
                      void updateIssueStatus(detailIssue, e.target.value as QaStatus)
                    }
                  >
                    {QA_STATUSES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="settings-field">
                  <span>Assign to</span>
                  <select
                    value={detailIssue.assignee_id ?? ""}
                    disabled={updatingId === detailIssue.id}
                    onChange={(e) =>
                      void updateIssueAssignee(detailIssue, e.target.value)
                    }
                  >
                    <option value="">Unassigned</option>
                    {assignees.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {person.email ? ` (${person.email})` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="settings-field">
                  <span>Type</span>
                  <div>{labelFor(QA_ISSUE_TYPES, detailIssue.issue_type)}</div>
                </div>
                <div className="settings-field">
                  <span>Priority</span>
                  <div>{labelFor(QA_PRIORITIES, detailIssue.priority)}</div>
                </div>
                <div className="settings-field">
                  <span>Component</span>
                  <div>{labelFor(QA_COMPONENTS, detailIssue.component)}</div>
                </div>
              </aside>
            </div>
          </>
        ) : null}
      </MotionModal>
    </section>
  );
}

function QaSkeleton({ view }: { view: ViewMode }) {
  if (view === "kanban") {
    return (
      <div className="qa-kanban" aria-busy="true" aria-live="polite">
        {QA_STATUSES.map((column) => (
          <div key={column.value} className="qa-kanban__column">
            <div className="qa-kanban__column-head">
              <Skeleton variant="text" height={14} width={90} />
            </div>
            <div className="qa-kanban__cards">
              <Skeleton variant="rect" height={96} />
              <Skeleton variant="rect" height={96} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="inventory-table-wrap" aria-busy="true" aria-live="polite">
      <table className="inventory-table payment-table">
        <tbody>
          {Array.from({ length: 5 }).map((_, index) => (
            <tr key={index}>
              <td colSpan={9}>
                <Skeleton variant="text" height={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

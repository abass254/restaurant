"use client";

import type { ContactImportMode, ContactImportResponse } from "@/lib/types";

type Noun = { singular: string; plural: string };

function modeOptions(noun: Noun): {
  id: ContactImportMode;
  label: string;
  hint: string;
  icon: string;
}[] {
  return [
    {
      id: "merge",
      label: "Add & update",
      hint: `Add new ${noun.plural} and update ones with the same phone. Everyone else stays.`,
      icon: "fa-code-merge",
    },
    {
      id: "replace",
      label: "Replace list",
      hint: `Make this file your ${noun.singular} list. ${noun.plural[0].toUpperCase()}${noun.plural.slice(1)} not in the file are removed.`,
      icon: "fa-arrows-rotate",
    },
  ];
}

export function ContactImportModePicker({
  noun,
  mode,
  disabled,
  onChange,
}: {
  noun: Noun;
  mode: ContactImportMode;
  disabled: boolean;
  onChange: (mode: ContactImportMode) => void;
}) {
  return (
    <div
      className="trans-chap-import__mode-options trans-chap-import__mode-options--two"
      role="radiogroup"
      aria-label={`How to handle existing ${noun.plural}`}
    >
      {modeOptions(noun).map((opt) => {
        const isSelected = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            className={`trans-chap-import__mode-btn${isSelected ? " is-active" : ""}`}
            onClick={() => onChange(opt.id)}
          >
            <i className={`fa-solid ${opt.icon}`} aria-hidden />
            <div className="trans-chap-import__mode-content">
              <strong>{opt.label}</strong>
              <small>{opt.hint}</small>
            </div>
          </button>
        );
      })}
    </div>
  );
}

const STATUS_TAG: Record<ContactImportResponse["rows"][number]["status"], string> = {
  created: "created",
  updated: "updated",
  merged: "updated",
  skipped: "skipped",
  error: "error",
  removed: "skipped",
  kept: "warning",
};

export function ContactImportResults({
  result,
  noun,
}: {
  result: ContactImportResponse;
  noun: Noun;
}) {
  const { summary } = result;
  const detectedEntries = Object.entries(result.detected_columns);
  const problemRows = result.rows.filter((r) => r.status === "error" || r.status === "skipped");

  return (
    <div className="trans-chap-import__results">
      <div className="trans-chap-import__summary">
        <span className="trans-chap-import__stat--created">
          <strong>{summary.created}</strong> added
        </span>
        <span className="trans-chap-import__stat--updated">
          <strong>{summary.updated}</strong> updated
        </span>
        {summary.merged ? (
          <span className="trans-chap-import__stat--matched">
            <strong>{summary.merged}</strong> duplicates merged
          </span>
        ) : null}
        {summary.skipped ? (
          <span>
            <strong>{summary.skipped}</strong> skipped
          </span>
        ) : null}
        {summary.errors ? (
          <span className="trans-chap-import__stat--error">
            <strong>{summary.errors}</strong> failed
          </span>
        ) : null}
        {summary.removed ? (
          <span>
            <strong>{summary.removed}</strong> old {noun.plural} removed
          </span>
        ) : null}
        {summary.kept ? (
          <span className="trans-chap-import__stat--warning">
            <strong>{summary.kept}</strong> old {noun.plural} kept
          </span>
        ) : null}
      </div>

      {detectedEntries.length > 0 ? (
        <details className="trans-chap-import__columns">
          <summary>Columns detected ({detectedEntries.length})</summary>
          <ul>
            {detectedEntries.map(([field, header]) => (
              <li key={field}>
                <code>{header}</code>
                <span> → {field.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {result.rows.length > 0 ? (
        <details className="trans-chap-import__columns" open={problemRows.length > 0}>
          <summary>Import details ({result.rows.length})</summary>
          <div className="trans-chap-import__rows-wrap">
            {result.rows.map((row, index) => (
              <div
                key={`${row.status}-${row.row}-${row.phone ?? ""}-${index}`}
                className="trans-chap-import__row-item"
              >
                <span className="trans-chap-import__row-num">
                  {row.row > 0 ? `#${row.row}` : "—"}
                </span>
                <div className="trans-chap-import__row-desc">
                  <strong>{row.name || "Unnamed"}</strong>
                  {row.phone ? <code>{row.phone}</code> : null}
                  <small>{row.message}</small>
                </div>
                <span
                  className={`trans-chap-import__tag trans-chap-import__tag--${STATUS_TAG[row.status]}`}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

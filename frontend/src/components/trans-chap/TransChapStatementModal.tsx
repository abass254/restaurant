"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { MotionModal } from "@/components/app/MotionModal";
import { useAuthUser } from "@/components/app/AuthProvider";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDate, nairobiDateKey } from "@/lib/nairobi-time";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { StatementEntry, StatementResponse, StatementSummary } from "@/lib/types";

type Props = {
  open: boolean;
  partyType: "customer" | "supplier";
  partyId: string;
  partyName: string;
  onClose: () => void;
};

type RangePreset = "all" | "today" | "7d" | "30d" | "month" | "custom";

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TransChapStatementModal({
  open,
  partyType,
  partyId,
  partyName,
  onClose,
}: Props) {
  const user = useAuthUser();
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "Shop";
  const shopLocation =
    user.active_account?.business_location ||
    user.account?.business_location ||
    "";
  const baseId = useId();

  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statement, setStatement] = useState<StatementResponse["data"] | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const { start, end } = useMemo(() => {
    return {
      start: customStart || undefined,
      end: customEnd || undefined,
    };
  }, [customStart, customEnd]);

  const loadStatement = useCallback(async () => {
    if (!open || !partyId) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        partyType === "customer"
          ? apiRoutes.customerStatement(partyId, start, end, "json")
          : apiRoutes.supplierStatement(partyId, start, end, "json");
      const res = await apiFetch<StatementResponse>(endpoint);
      setStatement(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load Statement of Account."));
    } finally {
      setLoading(false);
    }
  }, [open, partyId, partyType, start, end]);

  useEffect(() => {
    if (open) {
      void loadStatement();
    } else {
      setStatement(null);
      setError(null);
      setCustomStart("");
      setCustomEnd("");
    }
  }, [open, loadStatement]);

  async function handleDownloadCsv() {
    if (!partyId) return;
    setDownloadingCsv(true);
    try {
      const endpoint =
        partyType === "customer"
          ? apiRoutes.customerStatement(partyId, start, end, "csv")
          : apiRoutes.supplierStatement(partyId, start, end, "csv");

      const response = await fetch(endpoint, {
        headers: { Accept: "text/csv" },
      });
      if (!response.ok) {
        throw new Error("Failed to download CSV");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = response.headers.get("content-disposition");
      let filename = `${partyType}_statement_${partyName.replace(/\s+/g, "_").toLowerCase()}.csv`;
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match?.[1]) filename = match[1];
      }
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      await toastSuccess("Statement CSV downloaded");
    } catch (err) {
      await showError("Could not download statement", extractErrorMessage(err));
    } finally {
      setDownloadingCsv(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const summary: StatementSummary | null = statement?.summary ?? null;
  const party = statement?.party;
  const entries: StatementEntry[] = statement?.entries ?? [];

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabelledBy={`${baseId}-title`}
      panelClassName="trans-chap-statement-modal"
    >
      <div className="trans-chap-statement">
        {/* Top Header / Actions bar */}
        <header className="trans-chap-statement__head no-print">
          <div className="trans-chap-statement__head-text">
            <span className="trans-chap-statement__badge">
              <i className="fa-solid fa-file-invoice" aria-hidden="true" />
              {partyType === "customer" ? "Customer Statement" : "Supplier Statement"}
            </span>
            <h2 id={`${baseId}-title`}>{partyName}</h2>
            <p>Statement of Account & Cash Flow History</p>
          </div>
          <div className="trans-chap-statement__actions">
            <button
              type="button"
              className="trans-chap-btn trans-chap-btn--secondary"
              onClick={handlePrint}
              disabled={loading || !statement}
              title="Print statement or save as PDF"
            >
              <i className="fa-solid fa-print" aria-hidden="true" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              className="trans-chap-btn trans-chap-btn--primary"
              onClick={() => void handleDownloadCsv()}
              disabled={loading || downloadingCsv || !statement}
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" />
              <span>{downloadingCsv ? "Downloading…" : "Export CSV"}</span>
            </button>
            <button
              type="button"
              className="trans-chap-statement__close-btn"
              onClick={onClose}
              aria-label="Close statement"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Date Filter Bar (Hidden when printing) */}
        <div className="trans-chap-statement__filters no-print">
          <div className="trans-chap-statement__date-filters">
            <label className="trans-chap-statement__date-field">
              <span>From date</span>
              <input
                type="date"
                value={customStart}
                aria-label="Statement start date"
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label className="trans-chap-statement__date-field">
              <span>To date</span>
              <input
                type="date"
                value={customEnd}
                aria-label="Statement end date"
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
            {(customStart || customEnd) ? (
              <button
                type="button"
                className="trans-chap-chip"
                onClick={() => {
                  setCustomStart("");
                  setCustomEnd("");
                }}
              >
                <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                <span>All time</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Print-only Formal Statement Header */}
        <div className="trans-chap-statement__print-header print-only">
          <div className="trans-chap-statement__print-biz">
            <h2>{shopName}</h2>
            {shopLocation ? <p>{shopLocation}</p> : null}
            <p>Official Statement of Account</p>
          </div>
          <div className="trans-chap-statement__print-party">
            <h3>{party?.name || partyName}</h3>
            {party?.phone ? <p>Phone: {party.phone}</p> : null}
            {party?.pin_number ? <p>KRA PIN: {party.pin_number}</p> : null}
            {party?.address || party?.city ? (
              <p>Location: {[party.address, party.city].filter(Boolean).join(", ")}</p>
            ) : null}
            <p>
              Period: {statement?.period.start ? formatDateShort(statement.period.start) : "Beginning"} to{" "}
              {statement?.period.end ? formatDateShort(statement.period.end) : "Present"}
            </p>
            <p className="trans-chap-statement__print-generated">
              Generated: {formatDateTimeShort(new Date().toISOString())}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="trans-chap-statement__loading" aria-busy="true">
            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
            <p>Compiling Statement of Account & Cash Flow…</p>
          </div>
        ) : error ? (
          <div className="trans-chap-statement__error">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            <p>{error}</p>
            <button
              type="button"
              className="trans-chap-btn trans-chap-btn--secondary"
              onClick={() => void loadStatement()}
            >
              Try again
            </button>
          </div>
        ) : summary && party ? (
          <div className="trans-chap-statement__content">
            {/* Cash Flow & Ledger Summary KPI Cards */}
            <div className="trans-chap-statement__cards">
              <div className="trans-chap-statement__card">
                <span className="trans-chap-statement__card-label">Opening Balance</span>
                <strong className="trans-chap-statement__card-value">
                  {formatKsh(summary.opening_balance)}
                </strong>
                <span className="trans-chap-statement__card-hint">
                  {summary.opening_balance > 0
                    ? partyType === "customer"
                      ? "Owed to shop at start"
                      : "Owed to supplier at start"
                    : "Balance brought forward"}
                </span>
              </div>

              <div className="trans-chap-statement__card">
                <span className="trans-chap-statement__card-label">
                  {partyType === "customer" ? "Total Invoiced / Billed" : "Total Purchased / Billed"}
                </span>
                <strong className="trans-chap-statement__card-value">
                  {formatKsh(summary.total_billed)}
                </strong>
                <span className="trans-chap-statement__card-hint">
                  {partyType === "customer"
                    ? `Credit & POS: ${formatKsh(summary.credit_extended || 0)} on credit`
                    : `Purchases & POs in period`}
                </span>
              </div>

              <div className="trans-chap-statement__card">
                <span className="trans-chap-statement__card-label">
                  {partyType === "customer" ? "Total Paid by Customer" : "Total Paid to Supplier"}
                </span>
                <strong className="trans-chap-statement__card-value is-positive">
                  {formatKsh(summary.total_paid)}
                </strong>
                <span className="trans-chap-statement__card-hint">
                  Cash {formatKsh(summary.paid_cash)} • M-PESA {formatKsh(summary.paid_mpesa)}
                  {summary.paid_cheque ? ` • Chq ${formatKsh(summary.paid_cheque)}` : ""}
                </span>
              </div>

              <div className="trans-chap-statement__card">
                <span className="trans-chap-statement__card-label">Net Cash Flow</span>
                <strong
                  className={`trans-chap-statement__card-value ${summary.net_cash_flow > 0
                      ? "is-positive"
                      : summary.net_cash_flow < 0
                        ? "is-negative"
                        : ""
                    }`}
                >
                  {summary.net_cash_flow >= 0 ? "+" : "−"}
                  {formatKsh(Math.abs(summary.net_cash_flow))}
                </strong>
                <span className="trans-chap-statement__card-hint">
                  {partyType === "customer"
                    ? "Actual cash & M-PESA received"
                    : "Actual funds disbursed"}
                </span>
              </div>

              {partyType === "supplier" && (summary.pending_cheques || 0) > 0 ? (
                <div className="trans-chap-statement__card is-warning">
                  <span className="trans-chap-statement__card-label">Pending Cheques</span>
                  <strong className="trans-chap-statement__card-value">
                    {formatKsh(summary.pending_cheques || 0)}
                  </strong>
                  <span className="trans-chap-statement__card-hint">
                    {summary.pending_cheques_count || 1} post-dated cheque
                    {(summary.pending_cheques_count || 1) === 1 ? "" : "s"} awaiting maturity
                  </span>
                </div>
              ) : null}

              <div
                className={`trans-chap-statement__card is-balance ${summary.closing_balance > 0 ? "is-due" : "is-clear"
                  }`}
              >
                <span className="trans-chap-statement__card-label">
                  {partyType === "customer" ? "Current Balance Owed" : "Current Payable Balance"}
                </span>
                <strong className="trans-chap-statement__card-value">
                  {summary.closing_balance > 0
                    ? formatKsh(summary.closing_balance)
                    : summary.closing_balance < 0
                      ? `Advance ${formatKsh(Math.abs(summary.closing_balance))}`
                      : "Fully Cleared"}
                </strong>
                <span className="trans-chap-statement__card-hint">
                  {party.credit_limit > 0
                    ? `Limit: ${formatKsh(party.credit_limit)} (${formatKsh(party.available_credit)} free)`
                    : "No credit cap"}
                  {party.due_date ? ` • Due: ${formatDateShort(party.due_date)}` : ""}
                </span>
              </div>
            </div>

            {/* Pending Post-dated Cheques Banner */}
            {partyType === "supplier" && (summary.pending_cheques || 0) > 0 ? (
              <div className="trans-chap-statement__cheque-banner">
                <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                <div>
                  <strong>Post-Dated Cheques in Flight: {formatKsh(summary.pending_cheques || 0)}</strong>
                  <p>
                    These cheques have been issued and handed to {partyName}, but have future maturity
                    dates. They reduce the outstanding balance once matured and cleared.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Chronological Ledger Table */}
            <div className="trans-chap-statement__table-wrap">
              <div className="trans-chap-statement__table-title">
                <h3>Chronological Accounting Ledger</h3>
                <span>{entries.length} transaction entries</span>
              </div>

              {entries.length === 0 ? (
                <p className="trans-chap-statement__empty">No transactions recorded for this period.</p>
              ) : (
                <table className="trans-chap-statement__table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Type</th>
                      <th scope="col">Description</th>
                      <th scope="col">Method</th>
                      <th scope="col" className="is-num">
                        {partyType === "customer" ? "Debit (Billed)" : "Debit (Purchased)"}
                      </th>
                      <th scope="col" className="is-num">
                        {partyType === "customer" ? "Credit (Paid)" : "Credit (Disbursed)"}
                      </th>
                      <th scope="col" className="is-num">
                        Cash Flow
                      </th>
                      <th scope="col" className="is-num">
                        Running Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const isExpanded = expandedEntryId === entry.id;
                      const hasItems = entry.items && entry.items.length > 0;
                      const isPos = entry.cash_flow > 0;
                      const isNeg = entry.cash_flow < 0;

                      return (
                        <tr
                          key={entry.id}
                          className={`trans-chap-statement__row is-${entry.type}${hasItems ? " is-expandable" : ""
                            }`}
                          onClick={() => {
                            if (hasItems) {
                              setExpandedEntryId((prev) => (prev === entry.id ? null : entry.id));
                            }
                          }}
                        >
                          <td className="trans-chap-statement__mono">
                            {formatDateTimeShort(entry.date)}
                          </td>
                          <td className="trans-chap-statement__mono font-semibold">
                            {entry.reference}
                          </td>
                          <td>
                            <span className={`trans-chap-statement__pill is-${entry.type}`}>
                              {entry.type === "opening_balance"
                                ? "Opening"
                                : entry.type.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <div className="trans-chap-statement__desc">
                              <span>{entry.description}</span>
                              {entry.maturity_date ? (
                                <span className="trans-chap-statement__maturity">
                                  <i className="fa-solid fa-calendar-check" aria-hidden="true" />
                                  Maturity: {formatDateShort(entry.maturity_date)}
                                  {entry.is_pending_cheque ? " (Pending)" : " (Matured)"}
                                </span>
                              ) : null}
                              {hasItems ? (
                                <span className="trans-chap-statement__expand-hint no-print">
                                  <i
                                    className={`fa-solid fa-chevron-${isExpanded ? "up" : "down"}`}
                                    aria-hidden="true"
                                  />
                                  {isExpanded
                                    ? "Hide items"
                                    : `View ${entry.items.length} item${entry.items.length === 1 ? "" : "s"
                                    }`}
                                </span>
                              ) : null}
                            </div>
                            {isExpanded && hasItems ? (
                              <ul className="trans-chap-statement__item-list">
                                {entry.items.map((item) => (
                                  <li key={item.id}>
                                    <span>
                                      {item.quantity}× {item.name}
                                      {item.unit ? ` (${item.unit})` : ""} @ {formatKsh(item.unit_price)}
                                    </span>
                                    <strong>{formatKsh(item.line_total)}</strong>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td className="trans-chap-statement__mono">
                            {entry.payment_method ? entry.payment_method.toUpperCase() : "—"}
                          </td>
                          <td className="is-num">
                            {entry.debit > 0 ? formatKsh(entry.debit) : "—"}
                          </td>
                          <td className="is-num is-credit">
                            {entry.credit > 0 ? formatKsh(entry.credit) : "—"}
                          </td>
                          <td className={`is-num ${isPos ? "is-pos" : isNeg ? "is-neg" : ""}`}>
                            {entry.cash_flow !== 0
                              ? `${entry.cash_flow > 0 ? "+" : "−"}${formatKsh(
                                Math.abs(entry.cash_flow),
                              )}`
                              : "—"}
                          </td>
                          <td className="is-num font-bold">
                            {formatKsh(entry.running_balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Bottom Statement Footer & Summary */}
            <footer className="trans-chap-statement__footer">
              <div className="trans-chap-statement__signoff print-only">
                <div className="trans-chap-statement__signoff-box">
                  <p>Prepared by: _______________________</p>
                  <p>Date: {formatDateShort(new Date().toISOString())}</p>
                </div>
                <div className="trans-chap-statement__signoff-box">
                  <p>Client / Supplier Signature: _______________________</p>
                  <p>Date: _______________________</p>
                </div>
              </div>

              <div className="trans-chap-statement__footer-actions no-print">
                <button
                  type="button"
                  className="trans-chap-btn trans-chap-btn--secondary"
                  onClick={onClose}
                >
                  Close Statement
                </button>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="trans-chap-btn trans-chap-btn--secondary"
                    onClick={handlePrint}
                  >
                    <i className="fa-solid fa-print" aria-hidden="true" />
                    Print Statement
                  </button>
                  <button
                    type="button"
                    className="trans-chap-btn trans-chap-btn--primary"
                    onClick={() => void handleDownloadCsv()}
                    disabled={downloadingCsv}
                  >
                    <i className="fa-solid fa-file-csv" aria-hidden="true" />
                    Download CSV
                  </button>
                </div>
              </div>
            </footer>
          </div>
        ) : null}
      </div>
    </MotionModal>
  );
}


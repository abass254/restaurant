"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { buildMpesaFlowSteps, MpesaFlowStatus } from "@/components/app/MpesaFlowStatus";
import { MpesaMoneyFlow } from "@/components/app/MpesaMoneyFlow";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import type { AdminMpesaTransaction, AdminMpesaTransactionsResponse } from "@/lib/types";

const SKELETON_ROWS = 8;

type StatusFilter = "all" | "pending" | "success" | "failed" | "cancelled";
type KindFilter = "all" | "client" | "admin_payout";

type ReleaseResponse = {
  message: string;
  transaction_id: string;
  amount: number;
  merchant_name: string | null;
  payout_status: string | null;
  payout_shortcode: string | null;
  payout_shortcode_type: string | null;
  payout_result_desc: string | null;
};

type HubBalance = {
  id: string | null;
  shortcode: string | null;
  status: string | null;
  working_balance: string | null;
  utility_balance: string | null;
  charges_balance: string | null;
  balances_raw: string | null;
  result_desc: string | null;
  requested_at: string | null;
  completed_at: string | null;
  credentials_configured: boolean;
};

type HubBalanceResponse = {
  data: HubBalance;
  message?: string | null;
};

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDateTime(value) || value;
}

function formatAmount(value: number): string {
  return `KES ${value.toLocaleString()}`;
}

function formatPhone(raw: string): string {
  if (raw.length === 12 && raw.startsWith("254")) {
    return `+${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6, 9)} ${raw.slice(9)}`;
  }
  return raw;
}

function formatDestinationType(type: string | null | undefined): string {
  switch ((type || "").toLowerCase()) {
    case "pochi":
    case "pochi_la_biashara":
      return "Pochi";
    case "till":
    case "buygoods":
    case "buy_goods":
      return "Till";
    case "paybill":
      return "Paybill";
    default:
      return type || "—";
  }
}

/** Safaricom / pipeline error shown on the when-column alert icon. */
function txnFlowError(txn: AdminMpesaTransaction): string | null {
  if (txn.payout_status === "failed" || txn.payout_status === "skipped") {
    return txn.payout_result_desc || "DukAI → Merchant payout failed.";
  }
  if (txn.status === "failed" || txn.status === "cancelled") {
    return txn.result_desc || `Client → DukAI ${txn.status}.`;
  }
  return null;
}

export default function AdminMpesaTransactionsPage() {
  const [rows, setRows] = useState<AdminMpesaTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("client");
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [balance, setBalance] = useState<HubBalance | null>(null);
  const [balanceMessage, setBalanceMessage] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);

  function reload(soft = false) {
    if (!soft) setLoading(true);
    void apiFetch<AdminMpesaTransactionsResponse>(apiRoutes.adminMpesaTransactions)
      .then((res) => {
        setRows(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!soft) {
          setError(err instanceof ApiError ? err.message : "Could not load M-PESA transactions.");
        }
      })
      .finally(() => {
        if (!soft) setLoading(false);
      });
  }

  function loadBalance() {
    return apiFetch<HubBalanceResponse>(apiRoutes.adminMpesaBalance)
      .then((res) => {
        setBalance(res.data);
        setBalanceMessage(res.message ?? null);
      })
      .catch(() => {
        /* non-blocking — transactions still load */
      })
      .finally(() => setBalanceLoading(false));
  }

  useEffect(() => {
    reload();
    void loadBalance();
  }, []);

  useEffect(() => {
    if (balance?.status !== "pending") return;
    const timer = window.setInterval(() => {
      void loadBalance();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [balance?.status, balance?.id]);

  const payoutInFlight = useMemo(
    () =>
      rows.some(
        (t) => t.payout_status === "queued" || t.payout_status === "pending",
      ),
    [rows],
  );

  useEffect(() => {
    if (!payoutInFlight) return;
    const timer = window.setInterval(() => {
      reload(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [payoutInFlight]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((txn) => {
      if (statusFilter !== "all" && txn.status !== statusFilter) return false;
      if (kindFilter === "client" && !txn.is_client_collection) return false;
      if (kindFilter === "admin_payout" && !txn.is_admin_payout) return false;
      if (!q) return true;
      const haystack = [
        txn.id,
        txn.merchant_id ?? "",
        txn.merchant_name ?? "",
        txn.phone_number,
        txn.account_reference,
        txn.mpesa_receipt_number ?? "",
        txn.payout_receipt_number ?? "",
        txn.payout_shortcode ?? "",
        txn.status,
        txn.result_desc ?? "",
        txn.checkout_request_id ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, statusFilter, kindFilter]);

  const receivedCount = filtered.filter((t) => t.has_received_money).length;
  const payoutCount = filtered.filter((t) => t.merchant_received_payout).length;
  const awaitingCount = filtered.filter((t) => t.can_send_to_merchant).length;

  async function sendToMerchant(txn: AdminMpesaTransaction) {
    const dest = txn.merchant_payout_shortcode
      ? `${formatDestinationType(txn.merchant_payout_shortcode_type)} ${txn.merchant_payout_shortcode}`
      : "their settlement destination";
    const ok = await confirmAction(
      "Send to merchant?",
      `Release ${formatAmount(txn.amount)} from DukAI to ${
        txn.merchant_name ?? "this merchant"
      } (${dest}). This uses real B2B funds when MPESA_MODE is production.`,
      "Yes, send payout",
    );
    if (!ok) return;

    setReleasingId(txn.id);
    try {
      const res = await apiFetch<ReleaseResponse>(apiRoutes.adminMpesaRelease(txn.id), {
        method: "POST",
        body: JSON.stringify({}),
      });
      await toastSuccess(res.message);
      reload(true);
    } catch (err) {
      await showError(
        "Could not send to merchant",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
      reload(true);
    } finally {
      setReleasingId(null);
    }
  }

  async function unlockPayout(txn: AdminMpesaTransaction) {
    const ok = await confirmAction(
      "Unlock stuck payout?",
      "Mark this in-progress DukAI → Merchant payout as failed so you can Retry send. " +
        "Only do this if Safaricom is not going to finish this attempt (or already failed silently).",
      "Yes, unlock",
    );
    if (!ok) return;

    setUnlockingId(txn.id);
    try {
      const res = await apiFetch<{ message: string }>(apiRoutes.adminMpesaUnlock(txn.id), {
        method: "POST",
        body: JSON.stringify({}),
      });
      await toastSuccess(res.message);
      reload(true);
    } catch (err) {
      await showError(
        "Could not unlock payout",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
      reload(true);
    } finally {
      setUnlockingId(null);
    }
  }

  async function checkBalance() {
    setBalanceRefreshing(true);
    try {
      const res = await apiFetch<HubBalanceResponse>(apiRoutes.adminMpesaBalance, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setBalance(res.data);
      setBalanceMessage(res.message ?? null);
      if (res.message) await toastSuccess(res.message);
    } catch (err) {
      await showError(
        "Could not check hub balance",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
    } finally {
      setBalanceRefreshing(false);
    }
  }

  const balancePrimary = balance?.utility_balance || balance?.working_balance || null;
  const balancePending = balance?.status === "pending";

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">M-PESA transactions</h1>
          <p className="admin-page__lead">
            Client → DukAI → Merchant. Merchant STK collections land here when paid; send each
            received payment to the store with <strong>Send to merchant</strong>.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">{filtered.length} shown</span>
          <span className="admin-chip">{receivedCount} at DukAI</span>
          <span className="admin-chip">{awaitingCount} ready to send</span>
          <span className="admin-chip">{payoutCount} to merchant</span>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={reload}>
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
            Refresh
          </button>
          <Link href="/admin/settings#section-mpesa" className="admin-btn admin-btn--ghost">
            Daraja settings
          </Link>
        </div>
      </header>

      <aside className="admin-mpesa-balance" aria-live="polite">
        <div className="admin-mpesa-balance__main">
          <p className="admin-mpesa-balance__eyebrow">DukAI hub balance</p>
          {balanceLoading ? (
            <Skeleton variant="text" height={28} width={160} />
          ) : (
            <p className="admin-mpesa-balance__value">
              {balancePending
                ? "Checking…"
                : balancePrimary
                  ? balancePrimary
                  : "—"}
            </p>
          )}
          <p className="admin-mpesa-balance__meta">
            {balance?.shortcode ? <>Paybill <code>{balance.shortcode}</code></> : "Hub paybill"}
            {balancePrimary ? " · Utility (collections)" : null}
            {balance?.completed_at || balance?.requested_at
              ? ` · ${formatWhen(balance.completed_at || balance.requested_at)}`
              : null}
          </p>
          {balance?.working_balance || balance?.utility_balance || balance?.charges_balance ? (
            <p className="admin-mpesa-balance__breakdown">
              {balance.utility_balance ? <>Utility {balance.utility_balance}</> : null}
              {balance.working_balance ? (
                <>
                  {balance.utility_balance ? " · " : null}
                  Working {balance.working_balance}
                </>
              ) : null}
              {balance.charges_balance ? (
                <>
                  {balance.utility_balance || balance.working_balance ? " · " : null}
                  Charges {balance.charges_balance}
                </>
              ) : null}
            </p>
          ) : null}
          {balance?.result_desc && balance.status !== "success" ? (
            <p className="admin-mpesa-balance__note">{balance.result_desc}</p>
          ) : null}
          {balanceMessage && !balancePrimary && balance?.status !== "pending" ? (
            <p className="admin-mpesa-balance__note">{balanceMessage}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={() => void checkBalance()}
          disabled={balanceRefreshing || balancePending || balance?.credentials_configured === false}
          title={
            balance?.credentials_configured === false
              ? "Set MPESA_B2B_INITIATOR and MPESA_B2B_SECURITY_CREDENTIAL in .env"
              : "Ask Safaricom for the current hub balance"
          }
        >
          <i className="fa-solid fa-wallet" aria-hidden="true" />
          {balanceRefreshing || balancePending ? "Checking…" : "Check balance"}
        </button>
      </aside>

      <MpesaMoneyFlow audience="admin" />

      <div className="admin-toolbar">
        <label className="admin-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search merchant, phone, receipt, reference…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          className="admin-select"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          aria-label="Transaction kind"
        >
          <option value="client">Client collections</option>
          <option value="admin_payout">Admin payouts</option>
          <option value="all">All types</option>
        </select>
        <select
          className="admin-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Collection status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error ? (
        <MotionFade className="admin-banner admin-banner--error" role="alert">
          {error}
        </MotionFade>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table admin-table--mpesa">
          <thead>
            <tr>
              <th>When</th>
              <th>Merchant</th>
              <th>Client phone</th>
              <th>Amount</th>
              <th>Flow</th>
              <th>Action</th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j}>
                      <Skeleton variant="text" height={12} width={j === 0 ? 90 : 70} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <motion.tbody
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-table__empty">
                    No M-PESA transactions match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((txn) => {
                  const busy = releasingId === txn.id;
                  const flowError = txnFlowError(txn);
                  return (
                    <motion.tr key={txn.id} variants={staggerItem}>
                      <td>
                        <div className="admin-table__stack">
                          <span className="admin-table__when">
                            <span>{formatWhen(txn.created_at)}</span>
                            {flowError ? (
                              <span
                                className="admin-table__flow-error"
                                tabIndex={0}
                                aria-label={flowError}
                              >
                                <i
                                  className="fa-solid fa-circle-exclamation"
                                  aria-hidden="true"
                                />
                                <span className="admin-table__flow-error-tip" role="tooltip">
                                  {flowError}
                                </span>
                              </span>
                            ) : null}
                          </span>
                          <span className="admin-table__muted">
                            {txn.is_admin_payout ? "Admin payout" : "Client STK"}
                          </span>
                        </div>
                      </td>
                      <td>
                        {txn.merchant_id ? (
                          <div className="admin-table__stack">
                            <span className="admin-table__merchant-name">
                              <Link
                                href={`/admin/merchants/${txn.merchant_id}`}
                                className="admin-table__primary-link"
                              >
                                {txn.merchant_name ?? "Merchant"}
                              </Link>
                              {txn.merchant_has_mpesa ? (
                                <i
                                  className="fa-solid fa-circle-check admin-table__mpesa-verified"
                                  title="M-PESA settlement configured"
                                  aria-label="M-PESA settlement configured"
                                />
                              ) : (
                                <i
                                  className="fa-solid fa-circle-exclamation admin-table__mpesa-missing"
                                  title="M-PESA settlement not configured"
                                  aria-label="M-PESA settlement not configured"
                                />
                              )}
                            </span>
                            <span className="admin-table__muted">
                              <code>{txn.merchant_id.slice(0, 8)}</code>
                              {txn.merchant_payout_shortcode
                                ? ` · ${formatDestinationType(txn.merchant_payout_shortcode_type)} ${txn.merchant_payout_shortcode}`
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="admin-table__muted">Unassigned</span>
                        )}
                      </td>
                      <td>{formatPhone(txn.phone_number)}</td>
                      <td>
                        <strong>{formatAmount(txn.amount)}</strong>
                      </td>
                      <td>
                        <MpesaFlowStatus steps={buildMpesaFlowSteps(txn)} />
                      </td>
                      <td className="admin-table__actions">
                        {txn.can_send_to_merchant ? (
                          <button
                            type="button"
                            className="admin-btn admin-btn--primary admin-btn--sm"
                            disabled={busy || releasingId !== null || unlockingId !== null}
                            onClick={() => void sendToMerchant(txn)}
                          >
                            <i className="fa-solid fa-paper-plane" aria-hidden="true" />
                            {busy
                              ? "Sending…"
                              : txn.payout_status === "failed" || txn.payout_status === "skipped"
                                ? "Retry send"
                                : "Send to merchant"}
                          </button>
                        ) : txn.merchant_received_payout ? (
                          <span className="admin-table__muted">Sent</span>
                        ) : txn.can_unlock_payout ||
                          txn.payout_status === "queued" ||
                          txn.payout_status === "pending" ? (
                          <div className="admin-table__action-stack">
                            <span className="admin-table__muted">In progress</span>
                            {txn.can_unlock_payout ? (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                disabled={unlockingId !== null || releasingId !== null}
                                onClick={() => void unlockPayout(txn)}
                              >
                                <i className="fa-solid fa-unlock" aria-hidden="true" />
                                {unlockingId === txn.id ? "Unlocking…" : "Unlock"}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="admin-table__muted">—</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </motion.tbody>
          )}
        </table>
      </div>
    </section>
  );
}

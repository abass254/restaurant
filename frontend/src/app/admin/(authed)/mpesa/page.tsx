"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { confirmAction, extractErrorMessage, promptMpesaReceipt, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { buildMpesaFlowSteps, MpesaFlowStatus } from "@/components/app/MpesaFlowStatus";
import { MpesaMoneyFlow } from "@/components/app/MpesaMoneyFlow";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import type {
  AdminMpesaActivityEntry,
  AdminMpesaActivityResponse,
  AdminMpesaTransaction,
  AdminMpesaTransactionsResponse,
  AdminMpesaVerification,
  AdminMpesaVerifyResponse,
} from "@/lib/types";

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

const VERIFICATION_LABELS: Record<string, { label: string; icon: string }> = {
  verified: { label: "Verified by Safaricom", icon: "fa-circle-check" },
  amount_mismatch: { label: "Amount differs", icon: "fa-triangle-exclamation" },
  status_mismatch: { label: "Status differs", icon: "fa-triangle-exclamation" },
  not_found: { label: "Not found at Safaricom", icon: "fa-circle-xmark" },
  unresolved: { label: "Unresolved", icon: "fa-circle-question" },
  pending: { label: "Asking Safaricom…", icon: "fa-hourglass-half" },
};

/** Safaricom's answer, spelled out under the entry once a check has run. */
function verificationDetail(verification: AdminMpesaVerification): string {
  const bits: string[] = [];
  if (verification.safaricom_amount) bits.push(`Safaricom KES ${verification.safaricom_amount}`);
  if (verification.safaricom_status) bits.push(verification.safaricom_status);
  if (verification.charges) bits.push(`Charge ${verification.charges}`);
  if (verification.safaricom_completed_at) {
    bits.push(formatWhen(verification.safaricom_completed_at));
  }
  if (bits.length === 0 && verification.result_desc) bits.push(verification.result_desc);
  return bits.join(" · ");
}

function formatActivityCounterparty(entry: AdminMpesaActivityEntry): string {
  const raw = (entry.counterparty || "").trim();
  if (!raw) return entry.direction === "in" ? "Client" : "Merchant";
  if (entry.direction === "in") return formatPhone(raw);
  const [type, ...rest] = raw.split(" ");
  const code = rest.join(" ");
  return code ? `${formatDestinationType(type)} ${code}` : raw;
}

/** Safaricom / pipeline error shown on the when-column alert icon. */
function txnFlowError(txn: AdminMpesaTransaction): string | null {
  if (txn.payout_status === "failed" || txn.payout_status === "skipped") {
    return txn.payout_result_desc || "TransChap → Merchant payout failed.";
  }
  if (txn.status === "failed" || txn.status === "cancelled") {
    return txn.result_desc || `Client → TransChap ${txn.status}.`;
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [queryingId, setQueryingId] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [balance, setBalance] = useState<HubBalance | null>(null);
  const [balanceMessage, setBalanceMessage] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [activity, setActivity] = useState<AdminMpesaActivityResponse | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);

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
    // The backend times a query out after ~2 minutes, so give up a little after
    // that rather than polling a dead query forever.
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > 60) {
        window.clearInterval(timer);
        return;
      }
      void loadBalance();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [balance?.status, balance?.id]);

  const verifyInFlight = useMemo(
    () => (activity?.data ?? []).some((e) => e.verification?.state === "pending"),
    [activity],
  );

  useEffect(() => {
    if (!activityOpen || !verifyInFlight) return;
    const timer = window.setInterval(() => {
      void loadActivity(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activityOpen, verifyInFlight]);

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

  // Bulk release only ever covers the rows currently listed, so what the admin
  // sees is exactly what gets sent.
  const releasable = useMemo(
    () => filtered.filter((t) => t.can_send_to_merchant),
    [filtered],
  );
  const releasableTotal = useMemo(
    () => releasable.reduce((sum, t) => sum + t.amount, 0),
    [releasable],
  );

  async function sendToMerchant(txn: AdminMpesaTransaction) {
    const dest = txn.merchant_payout_shortcode
      ? `${formatDestinationType(txn.merchant_payout_shortcode_type)} ${txn.merchant_payout_shortcode}`
      : "their settlement destination";
    const ok = await confirmAction(
      "Send to merchant?",
      `Release ${formatAmount(txn.amount)} from TransChap to ${
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

  /** Release every listed collection that is already at TransChap, one at a time. */
  async function sendAllToMerchants() {
    if (releasable.length === 0) return;

    const ok = await confirmAction(
      `Send ${releasable.length} payment${releasable.length === 1 ? "" : "s"} to merchants?`,
      `This releases ${formatAmount(releasableTotal)} from TransChap across ` +
        `${releasable.length} collection${releasable.length === 1 ? "" : "s"} currently listed. ` +
        "This uses real B2B funds when MPESA_MODE is production and cannot be undone.",
      "Yes, send them all",
    );
    if (!ok) return;

    setBulkSending(true);
    setBulkProgress({ done: 0, total: releasable.length });
    const failures: string[] = [];
    let sent = 0;

    try {
      for (const [index, txn] of releasable.entries()) {
        setReleasingId(txn.id);
        try {
          await apiFetch<ReleaseResponse>(apiRoutes.adminMpesaRelease(txn.id), {
            method: "POST",
            body: JSON.stringify({}),
          });
          sent += 1;
        } catch (err) {
          const reason = err instanceof ApiError ? err.message : extractErrorMessage(err);
          failures.push(`${txn.merchant_name ?? "Merchant"} (${formatAmount(txn.amount)}): ${reason}`);
        } finally {
          setReleasingId(null);
          setBulkProgress({ done: index + 1, total: releasable.length });
        }
        // Daraja spike-arrest rejects tight bursts — pace the payouts.
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }

      reload(true);
      if (failures.length === 0) {
        await toastSuccess(
          `Queued ${sent} payout${sent === 1 ? "" : "s"} totalling ${formatAmount(releasableTotal)}.`,
        );
      } else {
        await showError(
          `${sent} sent, ${failures.length} could not be sent`,
          failures.slice(0, 5).join("\n") +
            (failures.length > 5 ? `\n…and ${failures.length - 5} more.` : ""),
        );
      }
    } finally {
      setBulkSending(false);
      setBulkProgress(null);
    }
  }

  async function unlockPayout(txn: AdminMpesaTransaction) {
    const ok = await confirmAction(
      "Unlock stuck payout?",
      "Mark this in-progress TransChap → Merchant payout as failed so you can Retry send. " +
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

  /** Lost-callback recovery: settle from Safaricom's answer, no payout. */
  async function queryWithSafaricom(txn: AdminMpesaTransaction) {
    setQueryingId(txn.id);
    try {
      const res = await apiFetch<{ message: string; outcome: string }>(
        apiRoutes.adminMpesaQuerySafaricom(txn.id),
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res.outcome === "paid") {
        await toastSuccess(res.message);
      } else {
        await showError("Safaricom's answer", res.message);
      }
      reload(true);
    } catch (err) {
      await showError(
        "Could not reach Safaricom",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
      reload(true);
    } finally {
      setQueryingId(null);
    }
  }

  async function confirmCollection(txn: AdminMpesaTransaction) {
    const receipt = await promptMpesaReceipt(
      "Fix failed M-PESA payment",
      "Enter the M-PESA transaction code from the customer's confirmation SMS. This marks the collection as paid so you can send it to the merchant.",
    );
    if (!receipt) return;

    setConfirmingId(txn.id);
    try {
      const res = await apiFetch<{ message: string }>(apiRoutes.adminMpesaConfirm(txn.id), {
        method: "POST",
        body: JSON.stringify({ mpesa_receipt_number: receipt }),
      });
      await toastSuccess(res.message);
      reload(true);
    } catch (err) {
      await showError(
        "Could not fix payment",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
      reload(true);
    } finally {
      setConfirmingId(null);
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

  async function loadActivity(soft = false) {
    if (!soft) setActivityLoading(true);
    try {
      const res = await apiFetch<AdminMpesaActivityResponse>(
        `${apiRoutes.adminMpesaActivity}?limit=25`,
      );
      setActivity(res);
      return true;
    } catch (err) {
      if (!soft) {
        await showError(
          "Could not load recent transactions",
          err instanceof ApiError ? err.message : extractErrorMessage(err),
        );
      }
      return false;
    } finally {
      if (!soft) setActivityLoading(false);
    }
  }

  async function toggleActivity() {
    if (activityOpen) {
      setActivityOpen(false);
      return;
    }
    setActivityOpen(true);
    const ok = await loadActivity();
    if (!ok && !activity) setActivityOpen(false);
  }

  /** Ask Safaricom's Transaction Status API about one movement. */
  async function verifyEntry(entry: AdminMpesaActivityEntry, quiet = false) {
    setVerifyingId(entry.id);
    try {
      const res = await apiFetch<AdminMpesaVerifyResponse>(apiRoutes.adminMpesaVerify, {
        method: "POST",
        body: JSON.stringify({
          transaction_id: entry.transaction_id,
          direction: entry.direction,
        }),
      });
      if (!quiet) await toastSuccess(res.message);
      await loadActivity(true);
      return true;
    } catch (err) {
      if (!quiet) {
        await showError(
          "Could not verify with Safaricom",
          err instanceof ApiError ? err.message : extractErrorMessage(err),
        );
      }
      return false;
    } finally {
      setVerifyingId(null);
    }
  }

  async function verifyAll() {
    const pending = (activity?.data ?? []).filter((e) => e.can_verify && !e.verification);
    if (pending.length === 0) return;

    setVerifyingAll(true);
    let failures = 0;
    try {
      for (const entry of pending) {
        const ok = await verifyEntry(entry, true);
        if (!ok) failures += 1;
        // Daraja spike-arrest returns 429 on tight loops — pace the queries.
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      await loadActivity(true);
      if (failures === 0) {
        await toastSuccess(
          `Asked Safaricom about ${pending.length} movement${pending.length === 1 ? "" : "s"}. ` +
            "Results arrive on the callback.",
        );
      } else {
        await showError(
          "Some checks could not be sent",
          `${failures} of ${pending.length} status queries were rejected by Safaricom. ` +
            "Try those rows individually to see why.",
        );
      }
    } finally {
      setVerifyingAll(false);
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
            Client → TransChap → Merchant. Merchant STK collections land here when paid; send each
            received payment to the store with <strong>Send to merchant</strong>. If a client
            payment failed but they have an SMS code, use <strong>Fix payment</strong>.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">{filtered.length} shown</span>
          <span className="admin-chip">{receivedCount} at TransChap</span>
          <span className="admin-chip">{awaitingCount} ready to send</span>
          <span className="admin-chip">{payoutCount} to merchant</span>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => reload()}>
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
          <p className="admin-mpesa-balance__eyebrow">TransChap hub balance</p>
          {balanceLoading ? (
            <Skeleton variant="text" height={28} width={160} />
          ) : (
            <p className="admin-mpesa-balance__value">
              {balancePending
                ? "Checking…"
                : balancePrimary
                  ? balancePrimary
                  : balance?.status === "timeout"
                    ? "No answer"
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
        <div className="admin-mpesa-balance__actions">
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => void checkBalance()}
            disabled={
              balanceRefreshing || balancePending || balance?.credentials_configured === false
            }
            title={
              balance?.credentials_configured === false
                ? "Set MPESA_B2B_INITIATOR and MPESA_B2B_SECURITY_CREDENTIAL in .env"
                : "Ask Safaricom for the current hub balance"
            }
          >
            <i className="fa-solid fa-wallet" aria-hidden="true" />
            {balanceRefreshing || balancePending ? "Checking…" : "Check balance"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => void toggleActivity()}
            aria-expanded={activityOpen}
            aria-controls="admin-mpesa-activity"
            title="Money in and out of the TransChap hub paybill"
          >
            <i className="fa-solid fa-right-left" aria-hidden="true" />
            {activityLoading
              ? "Loading…"
              : activityOpen
                ? "Hide recent transactions"
                : "Check recent transactions"}
          </button>
        </div>
      </aside>

      {activityOpen ? (
        <MotionFade className="admin-mpesa-activity" id="admin-mpesa-activity">
          <header className="admin-mpesa-activity__header">
            <div>
              <p className="admin-mpesa-balance__eyebrow">Recent hub transactions</p>
              <p className="admin-mpesa-activity__lead">
                Last 25 money movements in and out of the TransChap hub paybill
                {activity?.shortcode ? <> <code>{activity.shortcode}</code></> : null}, from TransChap
                records. Safaricom charges and manual withdrawals are not included.
              </p>
            </div>
            <div className="admin-mpesa-activity__totals">
              <span className="admin-chip admin-chip--in">
                In {formatAmount(activity?.money_in ?? 0)}
              </span>
              <span className="admin-chip admin-chip--out">
                Out {formatAmount(activity?.money_out ?? 0)}
              </span>
              <span className="admin-chip">Net {formatAmount(activity?.net ?? 0)}</span>
              {activity && activity.mismatch_count > 0 ? (
                <span className="admin-chip admin-chip--out">
                  {activity.mismatch_count} mismatched
                </span>
              ) : null}
              {activity && activity.verified_count > 0 ? (
                <span className="admin-chip admin-chip--in">
                  {activity.verified_count} verified
                </span>
              ) : null}
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => void verifyAll()}
                disabled={
                  verifyingAll ||
                  activityLoading ||
                  activity?.credentials_configured === false ||
                  (activity?.unverified_count ?? 0) === 0
                }
                title={
                  activity?.credentials_configured === false
                    ? "Set MPESA_B2B_INITIATOR and MPESA_B2B_SECURITY_CREDENTIAL in .env"
                    : "Ask Safaricom's Transaction Status API about every unverified movement"
                }
              >
                <i className="fa-solid fa-shield-halved" aria-hidden="true" />
                {verifyingAll ? "Verifying…" : "Verify all with Safaricom"}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => void loadActivity()}
                disabled={activityLoading}
              >
                <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
                {activityLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </header>

          {activityLoading && !activity ? (
            <div className="admin-mpesa-activity__list">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="text" height={16} />
              ))}
            </div>
          ) : activity && activity.data.length > 0 ? (
            <ul className="admin-mpesa-activity__list">
              {activity.data.map((entry) => (
                <li
                  key={entry.id}
                  className={`admin-mpesa-activity__row admin-mpesa-activity__row--${entry.direction}`}
                >
                  <i
                    className={`fa-solid ${
                      entry.direction === "in" ? "fa-arrow-down" : "fa-arrow-up"
                    } admin-mpesa-activity__icon`}
                    aria-hidden="true"
                  />
                  <div className="admin-mpesa-activity__body">
                    <span className="admin-mpesa-activity__title">
                      {entry.label}
                      {entry.merchant_name ? ` · ${entry.merchant_name}` : ""}
                      {entry.verification ? (
                        <span
                          className={`admin-mpesa-activity__badge admin-mpesa-activity__badge--${entry.verification.state}`}
                        >
                          <i
                            className={`fa-solid ${
                              VERIFICATION_LABELS[entry.verification.state]?.icon ??
                              "fa-circle-question"
                            }`}
                            aria-hidden="true"
                          />
                          {VERIFICATION_LABELS[entry.verification.state]?.label ??
                            entry.verification.state}
                        </span>
                      ) : null}
                    </span>
                    <span className="admin-table__muted">
                      {formatActivityCounterparty(entry)}
                      {entry.receipt_number ? ` · ${entry.receipt_number}` : ""}
                      {` · ${formatWhen(entry.at)}`}
                    </span>
                    {entry.verification && verificationDetail(entry.verification) ? (
                      <span className="admin-mpesa-activity__verified-line">
                        {verificationDetail(entry.verification)}
                      </span>
                    ) : null}
                  </div>
                  <strong className="admin-mpesa-activity__amount">
                    {entry.direction === "in" ? "+" : "−"}
                    {formatAmount(entry.amount)}
                  </strong>
                  {entry.can_verify ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => void verifyEntry(entry)}
                      disabled={
                        verifyingAll ||
                        verifyingId !== null ||
                        entry.verification?.state === "pending" ||
                        activity?.credentials_configured === false
                      }
                      title="Ask Safaricom what it holds for this receipt"
                    >
                      <i className="fa-solid fa-shield-halved" aria-hidden="true" />
                      {verifyingId === entry.id
                        ? "Asking…"
                        : entry.verification
                          ? "Re-check"
                          : "Verify"}
                    </button>
                  ) : (
                    <span className="admin-table__muted">No receipt</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-mpesa-activity__lead">
              No completed money movements recorded yet.
            </p>
          )}
        </MotionFade>
      ) : null}

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
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={() => void sendAllToMerchants()}
          disabled={
            bulkSending ||
            releasable.length === 0 ||
            releasingId !== null ||
            unlockingId !== null ||
            confirmingId !== null ||
            queryingId !== null
          }
          title={
            releasable.length === 0
              ? "No listed collection is waiting to be sent to a merchant"
              : `Release ${formatAmount(releasableTotal)} across ${releasable.length} listed collection(s)`
          }
        >
          <i className="fa-solid fa-paper-plane" aria-hidden="true" />
          {bulkSending
            ? `Sending ${bulkProgress?.done ?? 0} of ${bulkProgress?.total ?? 0}…`
            : releasable.length > 0
              ? `Send all to merchants (${releasable.length} · ${formatAmount(releasableTotal)})`
              : "Send all to merchants"}
        </button>
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
                            disabled={
                              busy ||
                              releasingId !== null ||
                              unlockingId !== null ||
                              confirmingId !== null
                            }
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
                                disabled={
                                  unlockingId !== null ||
                                  releasingId !== null ||
                                  confirmingId !== null
                                }
                                onClick={() => void unlockPayout(txn)}
                              >
                                <i className="fa-solid fa-unlock" aria-hidden="true" />
                                {unlockingId === txn.id ? "Unlocking…" : "Unlock"}
                              </button>
                            ) : null}
                          </div>
                        ) : txn.can_confirm_collection ? (
                          <div className="admin-table__action-stack">
                            {txn.can_query_safaricom ? (
                              <button
                                type="button"
                                className="admin-btn admin-btn--primary admin-btn--sm"
                                disabled={
                                  queryingId !== null ||
                                  confirmingId !== null ||
                                  releasingId !== null ||
                                  unlockingId !== null
                                }
                                onClick={() => void queryWithSafaricom(txn)}
                                title="Ask Safaricom whether this payment went through, and settle from its answer"
                              >
                                <i className="fa-solid fa-satellite-dish" aria-hidden="true" />
                                {queryingId === txn.id ? "Asking…" : "Ask Safaricom"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              disabled={
                                confirmingId !== null ||
                                releasingId !== null ||
                                unlockingId !== null ||
                                queryingId !== null
                              }
                              onClick={() => void confirmCollection(txn)}
                            >
                              <i className="fa-solid fa-wrench" aria-hidden="true" />
                              {confirmingId === txn.id ? "Saving…" : "Fix payment"}
                            </button>
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

"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { MPESA_MAX_KES, MPESA_MIN_PAYOUT_KES } from "@/lib/mpesa-limits";
import { useAuthUser } from "@/components/app/AuthProvider";
import { Skeleton } from "@/components/app/Skeleton";
import { ListLoadError } from "@/components/app/ListLoadError";
import { MotionModal } from "@/components/app/MotionModal";
import { buildMpesaFlowSteps, MpesaFlowStatus } from "@/components/app/MpesaFlowStatus";
import { MpesaMoneyFlow } from "@/components/app/MpesaMoneyFlow";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  DEV_MERCHANT_MPESA_CONFIG,
  DEV_MPESA_TRANSACTIONS,
  isDevSampleTransaction,
} from "@/lib/payment-samples";
import { usePlatformRuntime } from "@/lib/platform-runtime";
import type {
  MerchantMpesaConfig,
  MerchantMpesaConfigResponse,
  MpesaStkPushResponse,
  MpesaTransaction,
  MpesaTransactionsResponse,
} from "@/lib/types";
import { formatNairobiDateTime, formatNairobiTime } from "@/lib/nairobi-time";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return formatNairobiDateTime(iso) || "—";
}

type StatusBadge = {
  label: string;
  cls: "is-success" | "is-failed" | "is-cancelled" | "is-pending";
};

function formatStatus(status: MpesaTransaction["status"]): StatusBadge {
  switch (status) {
    case "success":
      return { label: "Paid", cls: "is-success" };
    case "failed":
      return { label: "Failed", cls: "is-failed" };
    case "cancelled":
      return { label: "Cancelled", cls: "is-cancelled" };
    default:
      return { label: "Pending", cls: "is-pending" };
  }
}

function formatPhone(raw: string): string {
  if (raw.length === 12 && raw.startsWith("254")) {
    return `+${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6, 9)} ${raw.slice(9)}`;
  }
  return raw;
}

function formatAmount(value: number): string {
  return `KES ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPayoutTypeLabel(type: string | null | undefined): string {
  switch ((type || "").toLowerCase()) {
    case "pochi":
    case "pochi_la_biashara":
      return "Pochi";
    case "till":
    case "buygoods":
    case "buy_goods":
      return "Till";
    case "phone":
    case "b2c":
    case "msisdn":
      return "Phone";
    case "paybill":
      return "Paybill";
    default:
      return type ? type : "Paybill";
  }
}

function formatPayoutDestination(txn: MpesaTransaction): string {
  const shortcode = txn.payout_destination_shortcode ?? txn.payout_shortcode;
  const type = txn.payout_destination_type ?? txn.payout_shortcode_type;
  if (!shortcode) return "—";
  return `${formatPayoutTypeLabel(type)} ${shortcode}`;
}

export default function PaymentsPage() {
  const user = useAuthUser();
  const isAdmin = user.user_role === "system_admin";
  const { mode, mpesaUsesDarajaSandbox } = usePlatformRuntime();
  const reduce = useReducedMotion();

  const [config, setConfig] = useState<MerchantMpesaConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [usingDevSampleData, setUsingDevSampleData] = useState(false);
  const [transactions, setTransactions] = useState<MpesaTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const devMode = mode === "dev" || mpesaUsesDarajaSandbox;
  const effectiveConfig =
    config ?? (devMode ? DEV_MERCHANT_MPESA_CONFIG : null);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<MpesaTransactionsResponse>(apiRoutes.mpesaTransactions);
      const useSamples = devMode && data.transactions.length === 0;
      setTransactions(useSamples ? DEV_MPESA_TRANSACTIONS : data.transactions);
      setUsingDevSampleData((prev) => prev || Boolean(data.dev_sample_data) || useSamples);
      setLoadError(null);
    } catch (err) {
      if (devMode) {
        setTransactions(DEV_MPESA_TRANSACTIONS);
        setUsingDevSampleData(true);
        setLoadError(null);
      } else {
        setLoadError(extractErrorMessage(err, "Could not load payments."));
      }
    } finally {
      setLoading(false);
    }
  }, [devMode]);

  useEffect(() => {
    if (!isAdmin) {
      setConfigLoaded(true);
      setLoading(false);
      return;
    }
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((d) => {
        setConfig(d.config);
        setUsingDevSampleData((prev) => prev || Boolean(d.dev_sample_data));
      })
      .catch(() => {
        if (devMode) {
          setConfig(null);
          setUsingDevSampleData(true);
        } else {
          setConfig(null);
        }
      })
      .finally(() => setConfigLoaded(true));
    void reload();
  }, [devMode, isAdmin, reload]);

  // Poll for status updates while there are pending transactions.
  useEffect(() => {
    const hasPending = transactions.some(
      (t) => t.status === "pending" && !isDevSampleTransaction(t.id),
    );
    if (!hasPending) return;
    const id = window.setInterval(() => {
      void reload();
    }, 4000);
    return () => window.clearInterval(id);
  }, [transactions, reload]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) =>
      [
        t.phone_number,
        t.account_reference,
        t.transaction_desc,
        t.mpesa_receipt_number ?? "",
        t.payout_status ?? "",
        t.payout_receipt_number ?? "",
        formatPayoutDestination(t),
        String(t.amount),
        formatStatus(t.status).label,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [transactions, filterText]);

  if (!isAdmin) {
    return (
      <section className="app-panel">
        <h1 className="app-title">Payments</h1>
        <p className="app-muted">
          Only platform admins can request payments. Ask an admin to send a payment request.
        </p>
      </section>
    );
  }

  if (configLoaded && !effectiveConfig) {
    return (
      <section className="app-panel">
        <h1 className="app-title">Payments</h1>
        <p className="app-lead">
          Your settlement destination is not set yet. Customers pay DukAI first (Client → DukAI →
          your store), so we need somewhere to send the payout.
        </p>
        <p>
          <Link href="/settings" className="btn btn-primary">
            Set transaction account in Settings →
          </Link>
        </p>
      </section>
    );
  }

  function handleNewTransaction(t: MpesaTransaction) {
    setUsingDevSampleData(false);
    setTransactions((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
  }

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Payments</h1>
          <p className="app-lead">
            Client → DukAI → your store. Request payment sends an STK prompt; when the client pays,
            money lands on DukAI and shows on the admin M-PESA page. An admin then sends it to your
            settlement destination.
            {effectiveConfig ? (
              <>
                {" "}
                Hub account{" "}
                <code>{effectiveConfig.account_number}</code>
                {" · "}
                payout to{" "}
                <strong>{formatPayoutTypeLabel(effectiveConfig.shortcode_type)}</strong>{" "}
                <code>{effectiveConfig.shortcode}</code>
                .
              </>
            ) : null}
          </p>
          {usingDevSampleData ? (
            <p className="app-muted payment-dev-note">
              Dev mode — showing sample payment data via Daraja sandbox. Real STK pushes use
              sandbox paybill <code>{DEV_MERCHANT_MPESA_CONFIG.shortcode}</code>.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setModalOpen(true)}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Request payment
        </button>
      </header>

      <MpesaMoneyFlow audience="merchant" />

      <div className="inventory-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter by phone, reference, receipt, status…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void reload()}
          title="Refresh status"
        >
          <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {loading ? (
        <PaymentsSkeleton />
      ) : loadError && transactions.length === 0 ? (
        <ListLoadError
          title="Could not load payments"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void reload();
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="inventory-empty">
          <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
          <h2>
            {transactions.length === 0 ? "No payment requests yet" : "No matches"}
          </h2>
          <p>
            {transactions.length === 0
              ? "Send your first M-PESA STK push to a customer to get started."
              : "Try a different phone number, reference, receipt or status."}
          </p>
          {transactions.length === 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setModalOpen(true)}
            >
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Request payment
            </button>
          ) : null}
        </div>
      ) : (
        <div className="inventory-table-wrap">
          <table className="inventory-table payment-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Reference</th>
                <th>Your store</th>
                <th>Flow</th>
              </tr>
            </thead>
            <motion.tbody
              variants={reduce ? undefined : staggerContainer}
              initial={reduce ? false : "hidden"}
              animate={reduce ? undefined : "visible"}
            >
              {filtered.map((t) => {
                return (
                  <motion.tr
                    key={t.id}
                    variants={reduce ? undefined : staggerItem}
                    layout={reduce ? false : "position"}
                  >
                    <td>
                      <div className="payment-cell-when">
                        <span>{formatWhen(t.created_at)}</span>
                        {t.completed_at && t.completed_at !== t.created_at ? (
                          <span className="app-muted">
                            done {formatNairobiTime(t.completed_at)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="payment-cell-phone">
                        <strong>{formatPhone(t.phone_number)}</strong>
                        {t.transaction_desc ? (
                          <span className="app-muted">{t.transaction_desc}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <strong>{formatAmount(t.amount)}</strong>
                    </td>
                    <td>
                      <code className="inventory-code">{t.account_reference}</code>
                    </td>
                    <td>
                      <code className="inventory-code">{formatPayoutDestination(t)}</code>
                    </td>
                    <td>
                      <MpesaFlowStatus
                        steps={buildMpesaFlowSteps({
                          status: t.status,
                          result_desc: t.result_desc,
                          mpesa_receipt_number: t.mpesa_receipt_number,
                          payout_status: t.payout_status,
                          payout_result_desc: t.payout_result_desc,
                          payout_receipt_number: t.payout_receipt_number,
                          payout_shortcode:
                            t.payout_destination_shortcode ?? t.payout_shortcode,
                          payout_shortcode_type:
                            t.payout_destination_type ?? t.payout_shortcode_type,
                        })}
                      />
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      )}

      <RequestPaymentModal
        open={modalOpen}
        config={effectiveConfig}
        onClose={() => setModalOpen(false)}
        onCreated={(t) => {
          handleNewTransaction(t);
          setModalOpen(false);
        }}
      />
    </section>
  );
}

function PaymentsSkeleton() {
  const rows = Array.from({ length: 6 });
  return (
    <div className="inventory-table-wrap" aria-busy="true" aria-live="polite">
      <table className="inventory-table payment-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Reference</th>
            <th>Your store</th>
            <th>Flow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((_, i) => (
            <tr key={i}>
              <td>
                <Skeleton variant="text" height={12} width={120} />
                <Skeleton variant="text" height={10} width={70} />
              </td>
              <td>
                <Skeleton variant="text" height={13} width={140} />
                <Skeleton variant="text" height={10} width={90} />
              </td>
              <td>
                <Skeleton variant="text" height={14} width={90} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={100} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={90} />
              </td>
              <td>
                <Skeleton variant="text" height={22} width={96} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestPaymentModal({
  open,
  config,
  onClose,
  onCreated,
}: {
  open: boolean;
  config: MerchantMpesaConfig | null;
  onClose: () => void;
  onCreated: (t: MpesaTransaction) => void;
}) {
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    phoneRef.current?.focus();
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const data = await apiFetch<MpesaStkPushResponse>(apiRoutes.mpesaStkPush, {
        method: "POST",
        body: JSON.stringify({
          phone_number: phone.trim(),
          amount: Number(amount),
          account_reference: config?.account_number || `PAY-${Date.now()}`,
          transaction_desc: description.trim() || "Payment",
        }),
      });
      onCreated(data.transaction);
      await toastSuccess(
        "STK push sent — customer should see a prompt now",
        60_000,
      );
    } catch (err) {
      await showError("Could not send STK push", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Request payment"
      panelClassName="payment-modal"
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
    >
      <header className="inventory-modal__head">
        <div>
          <h2>Request payment</h2>
          <span>
            {config ? (
              <>
                Transaction account <code>{config.account_number}</code>
                {" · "}
                Payout {formatPayoutTypeLabel(config.shortcode_type)}{" "}
                <code>{config.shortcode}</code>
              </>
            ) : (
              "Send an M-PESA STK push to your customer"
            )}
          </span>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={submitting}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <form
        className="register-form settings-form payment-form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="inventory-modal__body">
          <label>
            Customer phone (Safaricom)
            <input
              ref={phoneRef}
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712345678 or 254712345678"
            />
          </label>
          <label>
            Amount (KES)
            <input
              type="number"
              required
              min={MPESA_MIN_PAYOUT_KES}
              max={MPESA_MAX_KES}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(MPESA_MIN_PAYOUT_KES)}
            />
          </label>
          {config?.account_number ? (
            <p className="settings-muted">
              M-PESA account on the customer prompt:{" "}
              <code>{config.account_number}</code>
            </p>
          ) : null}
          <label>
            Description (max 13 chars)
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Payment"
              maxLength={13}
            />
          </label>
        </div>
        <footer className="payment-modal__footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? "Sending…" : "Send STK push"}
          </button>
        </footer>
      </form>
    </MotionModal>
  );
}

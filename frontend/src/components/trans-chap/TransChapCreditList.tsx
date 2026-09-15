"use client";

import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, showInternalError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { buildDebtReminderWhatsAppUrl, fetchOwingCustomers } from "@/lib/trans-chap-credit";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type {
  CreditCollectionStatusResponse,
  CreditCollectResponse,
  MerchantMpesaConfigResponse,
  ShopCustomer,
} from "@/lib/types";

const POLL_MS = 4_000;

function parseAmount(value: string): number | null {
  const amount = Number(value.trim().replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount);
}

export function TransChapCreditList() {
  const user = useAuthUser();
  const shopName = user.active_account?.business_name || user.account?.business_name;
  const listId = useId();
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [owingTotal, setOwingTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ customerId: string; txnId: string } | null>(null);

  async function handleSendWhatsAppReminder(customer: ShopCustomer) {
    setSendingWaId(customer.id);
    try {
      const res = await apiFetch<{ message: string; sent: boolean }>(
        apiRoutes.customerSendWhatsAppReminder(customer.id),
        { method: "POST" },
      );
      await toastSuccess(res.message || "WhatsApp reminder sent via OpenWA!");
    } catch (err) {
      const waUrl = buildDebtReminderWhatsAppUrl({
        customerName: customer.name,
        shopName,
        amount: customer.outstanding_balance,
        phone: customer.phone,
        payBillUrl: customer.pay_bill_url,
      });
      if (waUrl) {
        window.open(waUrl, "_blank");
        await toastSuccess("Opening WhatsApp to send reminder...");
      } else {
        await showError("Could not send WhatsApp reminder", extractErrorMessage(err));
      }
    } finally {
      setSendingWaId(null);
    }
  }

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await fetchOwingCustomers();
    setCustomers(result.customers);
    setOwingTotal(result.owingTotal);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        if (!cancelled) setMpesaReady(Boolean(data.config));
      })
      .catch(() => {
        if (!cancelled) setMpesaReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await apiFetch<CreditCollectionStatusResponse>(
          apiRoutes.customerCollection(waiting.customerId, waiting.txnId),
        );
        if (!alive) return;
        const status = res.collection.status;
        if (status === "success") {
          if (!res.collection.collected) {
            setWaiting(null);
            setSavingId(null);
            await showError(
              "Payment received, tab not updated",
              "Refresh and check this customer’s balance.",
            );
            return;
          }
          setCustomers((prev) => {
            const next = prev
              .map((row) => (row.id === res.data.id ? res.data : row))
              .filter((row) => row.outstanding_balance > 0);
            setOwingTotal(next.reduce((sum, row) => sum + row.outstanding_balance, 0));
            return next;
          });
          setWaiting(null);
          setSavingId(null);
          if (res.data.outstanding_balance <= 0) setOpenId(null);
          await toastSuccess("Tab payment received");
          return;
        }
        if (status === "failed" || status === "cancelled") {
          setWaiting(null);
          setSavingId(null);
          await showError(
            "M-PESA didn’t go through",
            "Please try again.",
          );
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const intervalId = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [waiting]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((row) =>
      [row.name, row.phone].join(" ").toLowerCase().includes(needle),
    );
  }, [customers, query]);

  function toggle(customer: ShopCustomer) {
    const open = openId === customer.id;
    setOpenId(open ? null : customer.id);
    if (!open) {
      setAmount(String(Math.round(customer.outstanding_balance)));
    }
  }

  async function collect(event: FormEvent, customer: ShopCustomer) {
    event.preventDefault();
    const kes = parseAmount(amount);
    if (kes == null) {
      await showError("Check amount", "Enter how much to collect.");
      return;
    }
    if (kes > customer.outstanding_balance + 0.009) {
      await showError("Too much", "That is more than they owe.");
      return;
    }
    if (mpesaReady === false) {
      await showError("M-PESA not set", "Set your M-PESA details in Settings first.");
      return;
    }
    setSavingId(customer.id);
    try {
      const res = await apiFetch<CreditCollectResponse>(apiRoutes.customerCollect(customer.id), {
        method: "POST",
        body: JSON.stringify({ amount: kes }),
      });
      setWaiting({ customerId: customer.id, txnId: res.collection.id });
    } catch (err) {
      setSavingId(null);
      await showInternalError();
    }
  }

  const waitingThis = waiting?.customerId === openId;

  return (
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__filters">
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search the tab…"
            aria-label="Search the tab"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!loading && owingTotal > 0 ? (
          <p className="trans-chap-credit__total">
            {formatKsh(owingTotal)} still owed
          </p>
        ) : null}
      </div>
      {loading ? (
        <div className="trans-chap-sales__list" aria-busy="true" aria-label="Loading the tab">
          <TransChapListSkeleton />
        </div>
      ) : error && customers.length === 0 ? (
        <TransChapStatus tone="error">{error}</TransChapStatus>
      ) : customers.length === 0 ? (
        <TransChapStatus actionHref="/trans-chap/make-a-sale/new" actionLabel="Make a sale">
          Nobody owes the shop right now.
        </TransChapStatus>
      ) : filtered.length === 0 ? (
        <p className="trans-chap-sales__empty">No names match this search.</p>
      ) : (
        <MotionList className="trans-chap-sales__list" as="div">
          {filtered.map((customer) => {
            const open = openId === customer.id;
            const panelId = `${listId}-${customer.id}`;
            const collecting = savingId === customer.id || waiting?.customerId === customer.id;
            const waUrl = buildDebtReminderWhatsAppUrl({
              customerName: customer.name,
              shopName,
              amount: customer.outstanding_balance,
              phone: customer.phone,
              payBillUrl: customer.pay_bill_url,
            });
            return (
              <MotionItem key={customer.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  tone="credit"
                  title={customer.name}
                  subtitle={customer.phone}
                  badge={{ label: formatKsh(customer.outstanding_balance), tone: "credit" }}
                  onToggle={() => toggle(customer)}
                >
                  <p className="trans-chap-panel__lead">
                    On their tab. Send a WhatsApp reminder with payment link, or send an M-PESA prompt directly.
                  </p>
                  <dl className="trans-chap-panel__facts">
                    <div>
                      <dt>Owes</dt>
                      <dd>{formatKsh(customer.outstanding_balance)}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{customer.phone}</dd>
                    </div>
                  </dl>

                  <div className="trans-chap-credit__actions">
                    {waUrl ? (
                      <button
                        type="button"
                        className="trans-chap-btn trans-chap-btn--whatsapp"
                        disabled={sendingWaId === customer.id}
                        onClick={() => void handleSendWhatsAppReminder(customer)}
                      >
                        <i className="fa-brands fa-whatsapp" aria-hidden />
                        <span>
                          {sendingWaId === customer.id ? "Sending via OpenWA…" : "Send WhatsApp Reminder"}
                        </span>
                      </button>
                    ) : null}

                    {customer.pay_bill_url ? (
                      <button
                        type="button"
                        className="trans-chap-btn trans-chap-btn--ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(customer.pay_bill_url!);
                          void toastSuccess("Pay link copied!");
                        }}
                      >
                        <i className="fa-solid fa-copy" aria-hidden />
                        <span>Copy Pay Link</span>
                      </button>
                    ) : null}
                  </div>

                  {mpesaReady === false ? (
                    <p className="trans-chap-mpesa-gate">
                      Set your M-PESA details in Settings before collecting via STK Push.{" "}
                      <Link href="/trans-chap/settings">Set M-PESA details</Link>
                    </p>
                  ) : waitingThis && waiting?.customerId === customer.id ? (
                    <p className="trans-chap-form__lead">
                      Prompt sent. Ask {customer.name.split(" ")[0]} to check their phone.
                    </p>
                  ) : (
                    <form
                      className="trans-chap-form__block"
                      onSubmit={(event) => void collect(event, customer)}
                    >
                      <p className="trans-chap-form__block-title">STK Push Prompt</p>
                      <div className="auth-split__field">
                        <label htmlFor={`${panelId}-amount`}>Amount</label>
                        <div className="trans-chap-input">
                          <input
                            id={`${panelId}-amount`}
                            type="text"
                            inputMode="numeric"
                            className="auth-split__input"
                            value={open ? amount : String(Math.round(customer.outstanding_balance))}
                            onChange={(event) => setAmount(event.target.value)}
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="auth-split__btn"
                        disabled={collecting || mpesaReady !== true}
                      >
                        {collecting ? "Sending prompt…" : "Send M-PESA prompt"}
                      </button>
                    </form>
                  )}
                </TransChapPanel>
              </MotionItem>
            );
          })}
        </MotionList>
      )}
    </div>
  );
}

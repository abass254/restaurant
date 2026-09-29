"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { useAuthUser } from "@/components/app/AuthProvider";
import { fetchShopCustomers } from "@/lib/trans-chap-customers";
import { buildDebtReminderWhatsAppUrl } from "@/lib/trans-chap-credit";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { checkKenyanPhone } from "@/lib/phone-checker";
import type {
  ManualCreditCollectRequest,
  ManualCreditCollectResponse,
  CustomerImportResponse,
  ShopCustomer,
  ShopCustomerMutationResponse,
} from "@/lib/types";

type CustomerForm = {
  name: string;
  phone: string;
  physical_location: string;
  credit_limit: string;
  notes: string;
};

type View = "list" | "create" | "import";
type CustomerLayoutView = "grid" | "list";

const CUSTOMERS_VIEW_KEY = "trans-chap-customers-view";

function readCustomersView(): CustomerLayoutView {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(CUSTOMERS_VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

const EMPTY_FORM: CustomerForm = {
  name: "",
  phone: "+254",
  physical_location: "",
  credit_limit: "1000",
  notes: "",
};

function parseCreditLimit(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function badgeFor(customer: ShopCustomer): { label: string; tone: "ok" | "credit" | "wait" } {
  if (customer.outstanding_balance > 0) {
    return { label: `Owes ${formatKsh(customer.outstanding_balance)}`, tone: "credit" };
  }
  if (customer.credit_limit > 0) {
    return { label: `Limit ${formatKsh(customer.credit_limit)}`, tone: "ok" };
  }
  return { label: "Cash only", tone: "wait" };
}

export function TransChapCustomersList() {
  const user = useAuthUser();
  const shopName = user.active_account?.business_name || user.account?.business_name;
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("list");
  const [layoutView, setLayoutView] = useState<CustomerLayoutView>("grid");

  useEffect(() => {
    setLayoutView(readCustomersView());
  }, []);

  function setCustomersLayoutView(next: CustomerLayoutView) {
    setLayoutView(next);
    try {
      window.localStorage.setItem(CUSTOMERS_VIEW_KEY, next);
    } catch {
      // Local storage might be blocked; view still changes in-memory.
    }
  }

  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CustomerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CustomerImportResponse | null>(null);
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);
  const [forceMpesaPrompt, setForceMpesaPrompt] = useState(true);
  const [manualCollectingId, setManualCollectingId] = useState<string | null>(null);
  const [manualPaymentValues, setManualPaymentValues] = useState<
    Record<string, { amount: string; mpesaCode: string }>
  >({});

  const createPhoneCheck = useMemo(
    () => checkKenyanPhone(createForm.phone),
    [createForm.phone],
  );

  async function handleSendWhatsAppReminder(customer: ShopCustomer) {
    setSendingWaId(customer.id);
    try {
      const res = await apiFetch<{ message: string; sent: boolean }>(
        apiRoutes.customerSendWhatsAppReminder(customer.id),
        { method: "POST" },
      );
      await toastSuccess(res.message || "WhatsApp reminder sent!");
    } catch (err) {
      await showError("Could not send WhatsApp reminder", extractErrorMessage(err));
    } finally {
      setSendingWaId(null);
    }
  }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, settings] = await Promise.all([
        fetchShopCustomers(),
        apiFetch<{ force_mpesa_prompt: boolean }>(apiRoutes.customerCreditSettings),
      ]);
      setCustomers(rows);
      setForceMpesaPrompt(settings.force_mpesa_prompt);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load customers."));
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleManualCollect(customer: ShopCustomer) {
    const values = manualPaymentValues[customer.id] ?? { amount: "", mpesaCode: "" };
    const payload: ManualCreditCollectRequest = {};
    const rawAmount = values.amount.trim().replace(/,/g, "");
    if (rawAmount) {
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        await showError("Check payment amount", "Enter an amount greater than zero.");
        return;
      }
      payload.amount = amount;
    }
    if (values.mpesaCode.trim()) payload.mpesa_code = values.mpesaCode.trim();

    setManualCollectingId(customer.id);
    try {
      const result = await apiFetch<ManualCreditCollectResponse>(
        apiRoutes.customerManualCollect(customer.id),
        { method: "POST", body: JSON.stringify(payload) },
      );
      setCustomers((prev) =>
        prev.map((row) => (row.id === customer.id ? result.data : row)),
      );
      setManualPaymentValues((prev) => ({
        ...prev,
        [customer.id]: { amount: "", mpesaCode: "" },
      }));
      await toastSuccess(result.message);
    } catch (err) {
      await showError("Could not record payment", extractErrorMessage(err));
    } finally {
      setManualCollectingId(null);
    }
  }

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((row) =>
      [
        row.name,
        row.phone,
        row.physical_location ?? "",
        row.address ?? "",
        row.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [customers, query]);

  const owingCount = useMemo(
    () => customers.filter((row) => row.outstanding_balance > 0).length,
    [customers],
  );

  function openCreate() {
    setCreateForm(EMPTY_FORM);
    setOpenId(null);
    setView("create");
  }

  function openImport() {
    setImportFile(null);
    setImportError(null);
    setImportResult(null);
    setOpenId(null);
    setView("import");
  }

  function toggle(customer: ShopCustomer) {
    const open = openId === customer.id;
    setOpenId(open ? null : customer.id);
  }

  function payloadFromForm(form: CustomerForm) {
    const creditLimit = parseCreditLimit(form.credit_limit);
    if (creditLimit == null) {
      throw new Error("Enter a credit limit of 0 or more.");
    }
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) throw new Error("Enter the customer's name.");
    if (!phone) throw new Error("Enter a phone number.");
    const loc = form.physical_location.trim() || null;
    return {
      name,
      phone,
      credit_limit: creditLimit,
      physical_location: loc,
      address: loc,
      notes: form.notes.trim() || null,
      email: null,
    };
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    let payload;
    try {
      payload = payloadFromForm(createForm);
    } catch (err) {
      await showError("Check details", extractErrorMessage(err));
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<ShopCustomerMutationResponse>(apiRoutes.customers, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCustomers((prev) =>
        [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setView("list");
      setCreateForm(EMPTY_FORM);
      setOpenId(res.data.id);
      await toastSuccess("Customer saved");
    } catch (err) {
      await showError("Could not save customer", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer(customer: ShopCustomer) {
    if (customer.outstanding_balance > 0) {
      await showError(
        "Still on the tab",
        "Collect what they owe before removing this customer.",
      );
      return;
    }
    const ok = await confirmAction(
      "Remove customer?",
      `${customer.name} will be removed from this shop.`,
    );
    if (!ok) return;
    setRemovingId(customer.id);
    try {
      await apiFetch(apiRoutes.customer(customer.id), { method: "DELETE" });
      setCustomers((prev) => prev.filter((row) => row.id !== customer.id));
      if (openId === customer.id) setOpenId(null);
      await toastSuccess("Customer removed");
    } catch (err) {
      await showError("Could not remove customer", extractErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  }

  function onImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setImportFile(picked);
    setImportError(null);
    setImportResult(null);
    event.target.value = "";
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await apiFetch<CustomerImportResponse>(apiRoutes.customersImport, {
        method: "POST",
        body: form,
      });
      setImportResult(res);
      if (res.summary.created > 0 || res.summary.updated > 0) {
        await reload();
        await toastSuccess(res.message);
      } else if (res.summary.errors > 0) {
        await showError("Import finished with errors", res.message);
      } else {
        await toastSuccess(res.message);
      }
    } catch (err) {
      setImportError(extractErrorMessage(err, "Import failed."));
    } finally {
      setImporting(false);
    }
  }

  if (view === "create") {
    return (
      <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleCreate(e)}>
        <p className="trans-chap-form__lead">Add someone you sell to on credit or walk-in.</p>
        <div className="trans-chap-form__fields">
          <button
            type="button"
            className="trans-chap-sale-scan__back"
            onClick={() => {
              if (saving) return;
              setView("list");
            }}
          >
            <i className="fa-solid fa-chevron-left" aria-hidden />
            Customers
          </button>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-customer-name">Name</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-name"
                required
                autoComplete="name"
                className="auth-split__input"
                placeholder="Customer name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-customer-phone">Phone number</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-phone"
                required
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                className="auth-split__input"
                placeholder="+254 712 345 678"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div
              className={`phone-checker-row phone-checker-row--${createPhoneCheck.status}`}
              style={{ marginTop: 6 }}
            >
              <div className="phone-checker-info">
                <i
                  className={`fa-solid ${
                    createPhoneCheck.status === "valid"
                      ? "fa-circle-check"
                      : createPhoneCheck.status === "invalid"
                      ? "fa-circle-exclamation"
                      : "fa-circle-info"
                  }`}
                  aria-hidden="true"
                />
                <span>{createPhoneCheck.message}</span>
              </div>
              {createPhoneCheck.network ? (
                <span className="phone-carrier-tag">{createPhoneCheck.network}</span>
              ) : null}
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-customer-location">Physical location</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-location"
                className="auth-split__input"
                placeholder="e.g. Stall B12, Nairobi CBD"
                value={createForm.physical_location}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, physical_location: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-customer-limit">Credit limit (default KES 1,000)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-limit"
                type="text"
                inputMode="numeric"
                className="auth-split__input"
                placeholder="1000"
                value={createForm.credit_limit}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, credit_limit: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-customer-notes">Notes (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-notes"
                className="auth-split__input"
                placeholder="Anything useful"
                value={createForm.notes}
                onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <div className="trans-chap-form__actions">
          <button type="submit" className="auth-split__btn" disabled={saving}>
            {saving ? "Saving…" : "Save customer"}
          </button>
        </div>
      </form>
    );
  }

  if (view === "import") {
    const detectedEntries = importResult
      ? Object.entries(importResult.detected_columns)
      : [];
    return (
      <div className="auth-split__form trans-chap-form">
        <p className="trans-chap-form__lead">
          Upload an <strong>.xlsx</strong> with <code>Name</code>, <code>Phone</code>,{" "}
          <code>Credit Limit</code>, and <code>Opening Balance</code>. Matching uses phone —
          existing customers are updated.
        </p>
        <div className="trans-chap-form__fields">
          <button
            type="button"
            className="trans-chap-sale-scan__back"
            onClick={() => {
              if (importing) return;
              setView("list");
            }}
          >
            <i className="fa-solid fa-chevron-left" aria-hidden />
            Customers
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="trans-chap-import__file-input"
            onChange={onImportFileChange}
          />

          <button
            type="button"
            className="trans-chap-import__dropzone"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <i className="fa-solid fa-cloud-arrow-up" aria-hidden />
            {importFile ? (
              <>
                <strong>{importFile.name}</strong>
                <span>
                  {(importFile.size / 1024).toFixed(1)} KB — tap to choose another file
                </span>
              </>
            ) : (
              <>
                <strong>Choose an Excel file</strong>
                <span>.xlsx only, up to 5 MB</span>
              </>
            )}
          </button>

          {importError ? (
            <TransChapStatus tone="error">{importError}</TransChapStatus>
          ) : null}

          {importResult ? (
            <div className="trans-chap-import__results">
              <div className="trans-chap-import__summary">
                <span>
                  <strong>{importResult.summary.created}</strong> added
                </span>
                <span>
                  <strong>{importResult.summary.updated}</strong> updated
                </span>
                {importResult.summary.skipped ? (
                  <span>
                    <strong>{importResult.summary.skipped}</strong> skipped
                  </span>
                ) : null}
                {importResult.summary.errors ? (
                  <span className="trans-chap-import__stat--error">
                    <strong>{importResult.summary.errors}</strong> failed
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

              {importResult.rows.some((row) => row.status === "error") ? (
                <ul className="trans-chap-import__errors">
                  {importResult.rows
                    .filter((row) => row.status === "error")
                    .slice(0, 8)
                    .map((row) => (
                      <li key={row.row}>
                        Row {row.row}
                        {row.name ? `: ${row.name}` : ""} — {row.message}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="trans-chap-form__actions">
          <button
            type="button"
            className="auth-split__btn"
            disabled={!importFile || importing || !!importResult}
            onClick={() => void handleImport()}
          >
            {importing ? "Importing…" : "Import customers"}
          </button>
          {importResult ? (
            <button
              type="button"
              className="trans-chap-form__secondary"
              onClick={() => setView("list")}
            >
              Back to customers
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`trans-chap-sales${layoutView === "list" ? " trans-chap-sales--list" : ""}`}>
      <div className="trans-chap-sales__filters">
        <div className="trans-chap-sales__search-row">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search customers…"
              aria-label="Search customers"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="trans-chap-sales__view" role="group" aria-label="Customer layout">
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${layoutView === "grid" ? " is-on" : ""}`}
              aria-pressed={layoutView === "grid"}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setCustomersLayoutView("grid")}
            >
              <i className="fa-solid fa-table-cells" aria-hidden />
            </button>
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${layoutView === "list" ? " is-on" : ""}`}
              aria-pressed={layoutView === "list"}
              aria-label="List view"
              title="List view"
              onClick={() => setCustomersLayoutView("list")}
            >
              <i className="fa-solid fa-list" aria-hidden />
            </button>
          </div>
        </div>
        {!loading && owingCount > 0 ? (
          <p className="trans-chap-credit__total">
            <Link href="/trans-chap/credit">
              {owingCount} on tab · Collect
            </Link>
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="trans-chap-sales__list" aria-busy="true" aria-label="Loading customers">
          <TransChapListSkeleton />
        </div>
      ) : error && customers.length === 0 ? (
        <TransChapStatus tone="error">{error}</TransChapStatus>
      ) : customers.length === 0 ? (
        <TransChapStatus>
          No customers yet. Tap + to add people you sell to, or import from Excel.
        </TransChapStatus>
      ) : filtered.length === 0 ? (
        <p className="trans-chap-sales__empty">No names match this search.</p>
      ) : (
        <MotionList className="trans-chap-sales__list" as="div">
          {filtered.map((customer) => {
            const open = openId === customer.id;
            const panelId = `${listId}-${customer.id}`;
            const badge = badgeFor(customer);
            const waUrl =
              customer.outstanding_balance > 0
                ? buildDebtReminderWhatsAppUrl({
                    customerName: customer.name,
                    shopName,
                    amount: customer.outstanding_balance,
                    phone: customer.phone,
                    payBillUrl: customer.pay_bill_url,
                  })
                : null;
            const hasCredit = customer.credit_limit > 0;
            const owes = customer.outstanding_balance > 0;
            const creditPct = hasCredit
              ? Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round(
                      (customer.available_credit / customer.credit_limit) * 100,
                    ),
                  ),
                )
              : 0;
            const cleanPhone = customer.phone.replace(/\D/g, "");

            return (
              <MotionItem key={customer.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  imageUrl={null}
                  tone={owes ? "credit" : "sale"}
                  title={customer.name}
                  subtitle={customer.phone}
                  badge={badge}
                  onToggle={() => toggle(customer)}
                >
                  <div className="trans-chap-form__block">
                    {hasCredit ? (
                      <div className="trans-chap-customer-credit-card">
                        <div className="trans-chap-customer-credit-card__head">
                          <span className="trans-chap-customer-credit-card__title">
                            <i className="fa-solid fa-wallet" aria-hidden /> Credit Tab Overview
                          </span>
                          <span
                            className={`trans-chap-customer-credit-card__status ${
                              owes ? "is-owes" : "is-clear"
                            }`}
                          >
                            {owes
                              ? `Tab Active · ${creditPct}% available`
                              : "✓ Full Credit Available"}
                          </span>
                        </div>

                        <div className="trans-chap-customer-credit-card__meter">
                          <div
                            className={`trans-chap-customer-credit-card__meter-bar${
                              customer.available_credit <= 0
                                ? " is-exceeded"
                                : creditPct <= 25
                                ? " is-low"
                                : ""
                            }`}
                            style={{ width: `${creditPct}%` }}
                          />
                        </div>

                        <div className="trans-chap-customer-credit-card__stats">
                          <div className="trans-chap-customer-credit-card__stat">
                            <span>Available</span>
                            <strong className="is-avail">
                              {formatKsh(customer.available_credit)}
                            </strong>
                          </div>
                          <div className="trans-chap-customer-credit-card__stat">
                            <span>Limit</span>
                            <strong>{formatKsh(customer.credit_limit)}</strong>
                          </div>
                          <div className="trans-chap-customer-credit-card__stat">
                            <span>Owes</span>
                            <strong className={owes ? "is-debt" : "is-clear"}>
                              {formatKsh(customer.outstanding_balance)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="trans-chap-customer-cash-card">
                        <i className="fa-solid fa-money-bill-wave" aria-hidden />
                        <div>
                          <strong>Walk-in Customer</strong>
                          <p>No credit tab limit configured for this customer.</p>
                        </div>
                      </div>
                    )}

                    <div className="trans-chap-customer-contact">
                      <div className="trans-chap-customer-contact__item">
                        <span className="trans-chap-customer-contact__label">Contact</span>
                        <div className="trans-chap-customer-contact__val">
                          <a
                            href={`tel:${customer.phone}`}
                            className="trans-chap-customer-contact__link"
                            title="Call customer"
                          >
                            <i className="fa-solid fa-phone" aria-hidden />
                            <span>{customer.phone}</span>
                          </a>
                          {cleanPhone ? (
                            <a
                              href={`https://wa.me/${cleanPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="trans-chap-customer-contact__icon-btn"
                              title="Chat on WhatsApp"
                            >
                              <i className="fa-brands fa-whatsapp" aria-hidden />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="trans-chap-customer-contact__icon-btn"
                            title="Copy phone number"
                            onClick={() => {
                              void navigator.clipboard.writeText(customer.phone);
                              void toastSuccess("Phone copied!");
                            }}
                          >
                            <i className="fa-solid fa-copy" aria-hidden />
                          </button>
                        </div>
                      </div>

                      {customer.physical_location || customer.address ? (
                        <div className="trans-chap-customer-contact__item">
                          <span className="trans-chap-customer-contact__label">Location</span>
                          <div className="trans-chap-customer-contact__val">
                            <i className="fa-solid fa-location-dot" aria-hidden />
                            <span>{customer.physical_location || customer.address}</span>
                          </div>
                        </div>
                      ) : null}

                      {customer.date_to_pay ? (
                        <div className="trans-chap-customer-contact__item">
                          <span className="trans-chap-customer-contact__label">Date to pay</span>
                          <div className="trans-chap-customer-contact__val">
                            <i className="fa-regular fa-calendar-check" aria-hidden />
                            <span>{customer.date_to_pay}</span>
                          </div>
                        </div>
                      ) : null}

                      {customer.notes ? (
                        <div className="trans-chap-customer-contact__notes">
                          <span className="trans-chap-customer-contact__label">Notes</span>
                          <p>{customer.notes}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="trans-chap-credit__actions" style={{ marginBottom: "0.85rem" }}>
                      <Link
                        href={`/trans-chap/pos?customer=${customer.id}`}
                        className="trans-chap-btn trans-chap-btn--primary"
                      >
                        <i className="fa-solid fa-cart-shopping" aria-hidden />
                        <span>Start POS Sale</span>
                      </Link>

                      {owes && waUrl ? (
                        <button
                          type="button"
                          className="trans-chap-btn trans-chap-btn--whatsapp"
                          disabled={sendingWaId === customer.id}
                          onClick={() => void handleSendWhatsAppReminder(customer)}
                        >
                          <i className="fa-brands fa-whatsapp" aria-hidden />
                          <span>
                            {sendingWaId === customer.id
                              ? "Sending via OpenWA…"
                              : "Send WhatsApp Reminder"}
                          </span>
                        </button>
                      ) : null}

                      {owes && customer.pay_bill_url ? (
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

                      {owes ? (
                        <Link href="/trans-chap/credit" className="trans-chap-form__secondary">
                          Collect via STK Push
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="trans-chap-form__secondary"
                          disabled={removingId === customer.id}
                          onClick={() => void removeCustomer(customer)}
                        >
                          {removingId === customer.id ? "Removing…" : "Remove customer"}
                        </button>
                      )}
                    </div>

                    {owes && !forceMpesaPrompt ? (
                      <form
                        className="trans-chap-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleManualCollect(customer);
                        }}
                      >
                        <p className="trans-chap-form__lead">
                          Record a payment without an STK prompt. Leave amount blank to clear
                          the full balance; an M-PESA code is optional.
                        </p>
                        <div className="trans-chap-form__fields">
                          <div className="auth-split__field">
                            <label htmlFor={`${panelId}-manual-amount`}>
                              Amount paid (KES, optional)
                            </label>
                            <div className="trans-chap-input">
                              <input
                                id={`${panelId}-manual-amount`}
                                type="text"
                                inputMode="decimal"
                                className="auth-split__input"
                                placeholder={`Full balance: ${customer.outstanding_balance}`}
                                value={
                                  manualPaymentValues[customer.id]?.amount ?? ""
                                }
                                onChange={(event) =>
                                  setManualPaymentValues((prev) => ({
                                    ...prev,
                                    [customer.id]: {
                                      amount: event.target.value,
                                      mpesaCode: prev[customer.id]?.mpesaCode ?? "",
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div className="auth-split__field">
                            <label htmlFor={`${panelId}-manual-mpesa-code`}>
                              M-PESA code (optional)
                            </label>
                            <div className="trans-chap-input">
                              <input
                                id={`${panelId}-manual-mpesa-code`}
                                type="text"
                                autoComplete="off"
                                className="auth-split__input"
                                placeholder="e.g. QGH7ABC123"
                                value={
                                  manualPaymentValues[customer.id]?.mpesaCode ?? ""
                                }
                                onChange={(event) =>
                                  setManualPaymentValues((prev) => ({
                                    ...prev,
                                    [customer.id]: {
                                      amount: prev[customer.id]?.amount ?? "",
                                      mpesaCode: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                        </div>
                        <div className="trans-chap-form__actions">
                          <button
                            type="submit"
                            className="auth-split__btn"
                            disabled={manualCollectingId === customer.id}
                          >
                            {manualCollectingId === customer.id
                              ? "Recording…"
                              : "Record credit payment"}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </TransChapPanel>
              </MotionItem>
            );
          })}
        </MotionList>
      )}

      <TransChapFab
        label="Customers"
        options={[
          {
            label: "Add customer",
            icon: "fa-user-plus",
            onClick: openCreate,
          },
          {
            label: "Import Excel",
            icon: "fa-file-excel",
            onClick: openImport,
          },
        ]}
      />
    </div>
  );
}

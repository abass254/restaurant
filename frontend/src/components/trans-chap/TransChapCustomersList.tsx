"use client";

import {
  ChangeEvent,
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import {
  ContactImportModePicker,
  ContactImportResults,
} from "@/components/trans-chap/TransChapContactImport";
import { TransChapCustomerTab } from "@/components/trans-chap/TransChapCustomerTab";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch, readPageCache, writePageCache } from "@/lib/api";
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
import { formatNairobiDate } from "@/lib/nairobi-time";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { checkKenyanPhone } from "@/lib/phone-checker";
import type {
  ContactImportMode,
  ManualCreditCollectRequest,
  ManualCreditCollectResponse,
  SettingsOperationsResponse,
  CustomerImportResponse,
  ShopCustomer,
  ShopCustomerMutationResponse,
} from "@/lib/types";

type CustomerForm = {
  name: string;
  phone: string;
  physical_location: string;
  credit_limit: string;
  outstanding_balance: string;
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
  outstanding_balance: "",
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

const CUSTOMERS_CACHE_KEY = "trans-chap:customers";

type CustomersSnapshot = { customers: ShopCustomer[]; forceMpesaPrompt: boolean };

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

  const [cached] = useState(() => readPageCache<CustomersSnapshot>(CUSTOMERS_CACHE_KEY));
  const [customers, setCustomers] = useState<ShopCustomer[]>(cached?.customers ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [owingOnly, setOwingOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tabOpenId, setTabOpenId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CustomerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ContactImportMode>("merge");
  const [importing, setImporting] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<"xlsx" | "csv" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CustomerImportResponse | null>(null);
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);
  const [forceMpesaPrompt, setForceMpesaPrompt] = useState(cached?.forceMpesaPrompt ?? true);
  const [manualCollectingId, setManualCollectingId] = useState<string | null>(null);
  const [manualPaymentValues, setManualPaymentValues] = useState<
    Record<string, { amount: string; mpesaCode: string }>
  >({});
  const [limitValues, setLimitValues] = useState<Record<string, string>>({});
  const [savingLimitId, setSavingLimitId] = useState<string | null>(null);
  const [allowOutstandingAdjustment, setAllowOutstandingAdjustment] = useState(false);
  const [outstandingValues, setOutstandingValues] = useState<Record<string, string>>({});
  const [savingOutstandingId, setSavingOutstandingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<SettingsOperationsResponse>(apiRoutes.settingsOperations)
      .then((data) => {
        if (!cancelled) setAllowOutstandingAdjustment(Boolean(data.allow_outstanding_adjustment));
      })
      .catch(() => {
        if (!cancelled) setAllowOutstandingAdjustment(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!readPageCache(CUSTOMERS_CACHE_KEY)) setLoading(true);
    try {
      const [rows, settings] = await Promise.all([
        fetchShopCustomers(),
        apiFetch<{ force_mpesa_prompt: boolean }>(apiRoutes.customerCreditSettings),
      ]);
      setCustomers(rows);
      setForceMpesaPrompt(settings.force_mpesa_prompt);
      writePageCache(CUSTOMERS_CACHE_KEY, {
        customers: rows,
        forceMpesaPrompt: settings.force_mpesa_prompt,
      } satisfies CustomersSnapshot);
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

  async function handleSaveLimit(customer: ShopCustomer, override?: number) {
    const raw = limitValues[customer.id] ?? "";
    const limit = override ?? parseCreditLimit(raw);
    if (limit == null || (override == null && !raw.trim())) {
      await showError("Check credit limit", "Enter a credit limit of 0 or more.");
      return;
    }
    if (limit > 0 && limit < customer.outstanding_balance) {
      await showError(
        "Limit too low",
        `${customer.name} already owes ${formatKsh(customer.outstanding_balance)}. Set a limit of at least that, or 0 for no cap.`,
      );
      return;
    }

    setSavingLimitId(customer.id);
    try {
      const res = await apiFetch<ShopCustomerMutationResponse>(
        apiRoutes.customerUpdate(customer.id),
        { method: "POST", body: JSON.stringify({ credit_limit: limit }) },
      );
      setCustomers((prev) =>
        prev.map((row) => (row.id === customer.id ? res.data : row)),
      );
      setLimitValues((prev) => ({ ...prev, [customer.id]: "" }));
      await toastSuccess(
        limit > 0 ? `Credit limit set to ${formatKsh(limit)}` : "Credit limit removed",
      );
    } catch (err) {
      await showError("Could not update credit limit", extractErrorMessage(err));
    } finally {
      setSavingLimitId(null);
    }
  }

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customers.filter((row) => {
      if (owingOnly && !(row.outstanding_balance > 0)) return false;
      if (!needle) return true;
      return [row.name, row.phone, row.physical_location ?? "", row.address ?? "", row.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [customers, owingOnly, query]);

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
    setImportMode("merge");
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
    let outstanding = 0;
    if (allowOutstandingAdjustment) {
      const raw = form.outstanding_balance.trim().replace(/,/g, "");
      if (raw) {
        outstanding = Number(raw);
        if (!Number.isFinite(outstanding) || outstanding < 0) {
          throw new Error("Enter an outstanding amount of 0 or more.");
        }
      }
    }
    return {
      name,
      phone,
      credit_limit: creditLimit,
      ...(allowOutstandingAdjustment ? { outstanding_balance: outstanding } : {}),
      physical_location: loc,
      address: loc,
      notes: form.notes.trim() || null,
      email: null,
    };
  }

  async function saveTableOutstanding(customer: ShopCustomer) {
    if (!allowOutstandingAdjustment || savingOutstandingId === customer.id) return;
    const raw = (outstandingValues[customer.id] ?? String(customer.outstanding_balance ?? 0))
      .trim()
      .replace(/,/g, "");
    const amount = raw ? Number(raw) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      await showError("Check amount", "Enter an outstanding amount of 0 or more.");
      setOutstandingValues((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      return;
    }
    if (customer.credit_limit > 0 && amount > customer.credit_limit) {
      await showError(
        "Amount too high",
        `Outstanding cannot be higher than the ${formatKsh(customer.credit_limit)} credit limit.`,
      );
      return;
    }
    if (Math.abs(amount - Number(customer.outstanding_balance || 0)) < 0.009) {
      setOutstandingValues((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      return;
    }
    setSavingOutstandingId(customer.id);
    try {
      const res = await apiFetch<ShopCustomerMutationResponse>(
        apiRoutes.customerUpdate(customer.id),
        { method: "POST", body: JSON.stringify({ outstanding_balance: amount }) },
      );
      setCustomers((prev) => prev.map((row) => (row.id === customer.id ? res.data : row)));
      setOutstandingValues((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      await toastSuccess(`Outstanding set to ${formatKsh(amount)}`);
    } catch (err) {
      await showError("Could not update outstanding", extractErrorMessage(err));
    } finally {
      setSavingOutstandingId(null);
    }
  }

  async function handleSaveOutstanding(customer: ShopCustomer) {
    const raw = (outstandingValues[customer.id] ?? "").trim().replace(/,/g, "");
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount < 0) {
      await showError("Check amount", "Enter an outstanding amount of 0 or more.");
      return;
    }
    if (customer.credit_limit > 0 && amount > customer.credit_limit) {
      await showError(
        "Amount too high",
        `Outstanding cannot be higher than the ${formatKsh(customer.credit_limit)} credit limit.`,
      );
      return;
    }
    setSavingOutstandingId(customer.id);
    try {
      const res = await apiFetch<ShopCustomerMutationResponse>(
        apiRoutes.customerUpdate(customer.id),
        { method: "POST", body: JSON.stringify({ outstanding_balance: amount }) },
      );
      setCustomers((prev) => prev.map((row) => (row.id === customer.id ? res.data : row)));
      setOutstandingValues((prev) => ({ ...prev, [customer.id]: "" }));
      await toastSuccess(`Outstanding set to ${formatKsh(amount)}`);
    } catch (err) {
      await showError("Could not update outstanding", extractErrorMessage(err));
    } finally {
      setSavingOutstandingId(null);
    }
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
    if (
      importMode === "replace" &&
      !(await confirmAction(
        "Replace your customer list?",
        "Customers not in this file will be removed. Anyone who still owes money is kept. This can't be undone.",
        "Yes, replace list",
      ))
    ) {
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await apiFetch<CustomerImportResponse>(apiRoutes.customersImport(importMode), {
        method: "POST",
        body: form,
      });
      setImportResult(res);
      if (res.summary.created > 0 || res.summary.updated > 0 || res.summary.removed > 0) {
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

  async function handleDownloadTemplate(format: "xlsx" | "csv") {
    setDownloadingFormat(format);
    try {
      const url = apiRoutes.customerTemplate(format);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Template download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `dukai_customers_template.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
      await toastSuccess(`${format.toUpperCase()} template downloaded.`);
    } catch (err) {
      await showError("Download failed", extractErrorMessage(err));
    } finally {
      setDownloadingFormat(null);
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
          {allowOutstandingAdjustment ? (
          <div className="auth-split__field">
            <label htmlFor="trans-chap-customer-outstanding">Outstanding amount (KES)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-outstanding"
                type="text"
                inputMode="decimal"
                className="auth-split__input"
                placeholder="0.00"
                value={createForm.outstanding_balance}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, outstanding_balance: e.target.value }))
                }
              />
            </div>
          </div>
          ) : null}
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
    return (
      <div className="auth-split__form trans-chap-form">
        <p className="trans-chap-form__lead">
          Upload an <strong>Excel (.xlsx)</strong> or <strong>CSV (.csv)</strong> file with{" "}
          <code>Name</code> and <code>Phone</code>. Optional: <code>Credit Limit</code>,{" "}
          <code>Opening Balance</code> or <code>Total Sale Due</code>, <code>Address</code>,{" "}
          <code>Postal Code</code>, <code>City</code>, <code>Email</code>, <code>Fax</code>,{" "}
          <code>Notes</code>. Rows with the same phone are merged into one customer.
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

          <div
            style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                Download standard import template:
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="trans-chap-btn trans-chap-btn--secondary"
                  style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                  disabled={downloadingFormat !== null}
                  onClick={() => void handleDownloadTemplate("xlsx")}
                >
                  <i className="fa-solid fa-file-excel" aria-hidden style={{ marginRight: 6 }} />
                  {downloadingFormat === "xlsx" ? "Downloading…" : "Excel (.xlsx)"}
                </button>
                <button
                  type="button"
                  className="trans-chap-btn trans-chap-btn--secondary"
                  style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                  disabled={downloadingFormat !== null}
                  onClick={() => void handleDownloadTemplate("csv")}
                >
                  <i className="fa-solid fa-file-csv" aria-hidden style={{ marginRight: 6 }} />
                  {downloadingFormat === "csv" ? "Downloading…" : "CSV (.csv)"}
                </button>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "0.78rem", opacity: 0.75 }}>
              Supported columns: <code>CUSTOMER NAME</code>, <code>PHONE</code>, <code>CREDIT LIMIT</code>, <code>OPENING BALANCE</code>, <code>ADDRESS</code>, <code>POSTAL CODE</code>, <code>CITY</code>, <code>EMAIL</code>, <code>FAX</code>, <code>NOTES</code>
            </p>
          </div>

          <ContactImportModePicker
            noun={{ singular: "customer", plural: "customers" }}
            mode={importMode}
            disabled={importing || !!importResult}
            onChange={setImportMode}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                <strong>Choose an Excel or CSV file</strong>
                <span>.xlsx or .csv up to 5 MB</span>
              </>
            )}
          </button>

          {importError ? (
            <TransChapStatus tone="error">{importError}</TransChapStatus>
          ) : null}

          {importResult ? (
            <ContactImportResults
              result={importResult}
              noun={{ singular: "customer", plural: "customers" }}
            />
          ) : null}
        </div>
        <div className="trans-chap-form__actions">
          <button
            type="button"
            className="auth-split__btn"
            disabled={!importFile || importing || !!importResult}
            onClick={() => void handleImport()}
          >
            {importing
              ? "Importing…"
              : importMode === "replace"
                ? "Replace customer list"
                : "Import customers"}
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
        <div className="trans-chap-sales__chips" role="toolbar" aria-label="Customer actions">
          <button
            type="button"
            className="trans-chap-chip trans-chap-chip--primary"
            onClick={openCreate}
          >
            <i className="fa-solid fa-plus" aria-hidden />
            <span>Add customer</span>
          </button>
          <button
            type="button"
            className={`trans-chap-chip${owingOnly ? " trans-chap-chip--primary" : ""}`}
            aria-pressed={owingOnly}
            onClick={() => setOwingOnly((on) => !on)}
          >
            <i className="fa-solid fa-scale-unbalanced" aria-hidden />
            <span>{owingOnly ? "Owing you" : "All customers"}</span>
          </button>
          <button
            type="button"
            className="trans-chap-chip"
            onClick={openImport}
          >
            <i className="fa-solid fa-file-import" aria-hidden />
            <span>Import</span>
          </button>
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
          No customers yet. Tap + to add people you sell to, or import from Excel or CSV.
        </TransChapStatus>
      ) : filtered.length === 0 ? (
        <p className="trans-chap-sales__empty">
          {owingOnly && !query.trim()
            ? "No customers owe you right now. Show all customers to see everyone."
            : "No names match this search."}
        </p>
      ) : layoutView === "list" ? (
        <div className="trans-chap-sales__list">
          <div className="trans-chap-stock-table-wrap trans-chap-stock-table-wrap--cards">
            <table className="trans-chap-stock-table trans-chap-stock-table--cards trans-chap-stock-table--supplier">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Location</th>
                  <th scope="col">Balance owed</th>
                  <th scope="col">Pay by</th>
                  <th className="trans-chap-stock-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => {
                  const open = openId === customer.id;
                  const panelId = `${listId}-${customer.id}`;
                  const owed = Number(customer.outstanding_balance || 0);
                  return (
                    <Fragment key={customer.id}>
                      <tr
                        className={`is-clickable ${open ? "is-picked" : ""}`}
                        title={open ? "Click to close details" : "Click to view details"}
                        tabIndex={0}
                        role="button"
                        aria-expanded={open}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) {
                            return;
                          }
                          toggle(customer);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) {
                              return;
                            }
                            event.preventDefault();
                            toggle(customer);
                          }
                        }}
                      >
                        <td className="trans-chap-stock-table__product">{customer.name}</td>
                        <td className="trans-chap-stock-table__mono">{customer.phone || "—"}</td>
                        <td className="trans-chap-stock-table__wrap">
                          {customer.physical_location || customer.address || "—"}
                        </td>
                        <td className="trans-chap-stock-table__strong">
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Balance owed</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                allowOutstandingAdjustment
                                  ? (outstandingValues[customer.id] ?? String(owed))
                                  : owed > 0
                                    ? formatKsh(owed)
                                    : "—"
                              }
                              disabled={!allowOutstandingAdjustment || savingOutstandingId === customer.id}
                              aria-label={`Balance owed for ${customer.name}`}
                              onChange={(event) => {
                                const value = event.target.value;
                                setOutstandingValues((prev) => ({ ...prev, [customer.id]: value }));
                              }}
                              onBlur={() => void saveTableOutstanding(customer)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setOutstandingValues((prev) => {
                                    const next = { ...prev };
                                    delete next[customer.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        </td>
                        <td>
                          {customer.date_to_pay && owed > 0 ? (
                            formatNairobiDate(customer.date_to_pay)
                          ) : (
                            <span className="trans-chap-stock-table__muted">—</span>
                          )}
                        </td>
                        <td className="trans-chap-stock-table__actions">
                          <div className="trans-chap-stock-table__actions-inner">
                            <button
                              type="button"
                              className="trans-chap-panel__link"
                              aria-expanded={open}
                              aria-controls={`${panelId}-edit`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggle(customer);
                              }}
                            >
                              {open ? "Close" : "View"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <MotionList className="trans-chap-sales__list" as="div">
          {filtered.map((customer) => {
            const open = openId === customer.id;
            const panelId = `${listId}-${customer.id}`;
            const badge = badgeFor(customer);
            const waUrl =
              customer.outstanding_balance > 0 && customer.phone
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
            const cleanPhone = (customer.phone ?? "").replace(/\D/g, "");

            return (
              <MotionItem key={customer.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  imageUrl={null}
                  tone={owes ? "credit" : "sale"}
                  title={customer.name}
                  subtitle={customer.phone ?? "No phone"}
                  badge={badge}
                  onToggle={() => toggle(customer)}
                >
                  <div className="trans-chap-form__block trans-chap-customer-detail">
                    <section
                      className={`trans-chap-customer-balance${owes ? " is-owes" : " is-clear"}`}
                    >
                      <div className="trans-chap-customer-balance__top">
                        <div>
                          <span className="trans-chap-customer-balance__label">
                            {owes ? "Balance owed" : "Balance"}
                          </span>
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Balance owed</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                allowOutstandingAdjustment
                                  ? (outstandingValues[customer.id] ?? String(customer.outstanding_balance ?? 0))
                                  : owes
                                    ? formatKsh(customer.outstanding_balance)
                                    : "All paid up"
                              }
                              disabled={!allowOutstandingAdjustment || savingOutstandingId === customer.id}
                              aria-label={`Balance owed for ${customer.name}`}
                              onChange={(event) => {
                                const value = event.target.value;
                                setOutstandingValues((prev) => ({ ...prev, [customer.id]: value }));
                              }}
                              onBlur={() => void saveTableOutstanding(customer)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setOutstandingValues((prev) => {
                                    const next = { ...prev };
                                    delete next[customer.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        </div>
                        {customer.date_to_pay && owes ? (
                          <span className="trans-chap-customer-balance__due">
                            <i className="fa-regular fa-calendar" aria-hidden />
                            Due {formatNairobiDate(customer.date_to_pay)}
                          </span>
                        ) : null}
                      </div>

                      {hasCredit ? (
                        <div className="trans-chap-customer-balance__limit">
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
                          <p>
                            <strong>{formatKsh(customer.available_credit)}</strong> of{" "}
                            {formatKsh(customer.credit_limit)} credit available
                          </p>
                        </div>
                      ) : (
                        <p className="trans-chap-customer-balance__note">
                          {owes
                            ? "No credit limit set — this tab has no cap."
                            : "Cash only — no credit limit set."}
                        </p>
                      )}

                      {owes ? (
                        <button
                          type="button"
                          className="trans-chap-customer-balance__toggle"
                          aria-expanded={tabOpenId === customer.id}
                          onClick={() =>
                            setTabOpenId((cur) => (cur === customer.id ? null : customer.id))
                          }
                        >
                          <i className="fa-solid fa-receipt" aria-hidden />
                          <span>
                            {tabOpenId === customer.id ? "Hide items" : "View items on this tab"}
                          </span>
                          <i
                            className={`fa-solid fa-chevron-${
                              tabOpenId === customer.id ? "up" : "down"
                            }`}
                            aria-hidden
                          />
                        </button>
                      ) : null}

                      {owes && tabOpenId === customer.id ? (
                        <TransChapCustomerTab
                          customerId={customer.id}
                          balance={customer.outstanding_balance}
                        />
                      ) : null}
                    </section>

                    <div className="trans-chap-customer-actions">
                      {owes && customer.phone ? (
                        <Link
                          href="/trans-chap/credit"
                          className="trans-chap-btn trans-chap-btn--primary trans-chap-customer-actions__wide"
                        >
                          <i className="fa-solid fa-mobile-screen-button" aria-hidden />
                          <span>Collect via STK Push</span>
                        </Link>
                      ) : null}

                      {owes && waUrl ? (
                        <button
                          type="button"
                          className="trans-chap-btn trans-chap-btn--ghost"
                          disabled={sendingWaId === customer.id}
                          onClick={() => void handleSendWhatsAppReminder(customer)}
                        >
                          <i className="fa-brands fa-whatsapp" aria-hidden />
                          <span>{sendingWaId === customer.id ? "Sending…" : "Remind"}</span>
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
                          <i className="fa-solid fa-link" aria-hidden />
                          <span>Copy pay link</span>
                        </button>
                      ) : null}

                      <Link
                        href={`/trans-chap/pos?customer=${customer.id}`}
                        className={`trans-chap-btn ${
                          owes ? "trans-chap-btn--ghost" : "trans-chap-btn--primary"
                        } trans-chap-customer-actions__wide`}
                      >
                        <i className="fa-solid fa-cart-shopping" aria-hidden />
                        <span>Start POS sale</span>
                      </Link>

                      {!customer.phone ? (
                        <p className="trans-chap-mpesa-gate trans-chap-customer-actions__wide">
                          No phone on file — add one to send M-PESA prompts or WhatsApp reminders.
                        </p>
                      ) : null}

                      {!owes ? (
                        <button
                          type="button"
                          className="trans-chap-btn trans-chap-btn--ghost trans-chap-customer-actions__wide trans-chap-customer-actions__danger"
                          disabled={removingId === customer.id}
                          onClick={() => void removeCustomer(customer)}
                        >
                          <i className="fa-solid fa-trash-can" aria-hidden />
                          <span>{removingId === customer.id ? "Removing…" : "Remove customer"}</span>
                        </button>
                      ) : null}
                    </div>

                    {owes && !forceMpesaPrompt ? (
                      <form
                        className="trans-chap-customer-manual"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleManualCollect(customer);
                        }}
                      >
                        <div className="trans-chap-customer-manual__head">
                          <span className="trans-chap-customer-section-label">
                            Record a payment
                          </span>
                          <p>Leave amount blank to clear the full balance.</p>
                        </div>
                        <div className="trans-chap-customer-manual__fields">
                          <label htmlFor={`${panelId}-manual-amount`}>
                            <span>Amount (KES)</span>
                            <input
                              id={`${panelId}-manual-amount`}
                              type="text"
                              inputMode="decimal"
                              className="auth-split__input"
                              placeholder={formatKsh(customer.outstanding_balance)}
                              value={manualPaymentValues[customer.id]?.amount ?? ""}
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
                          </label>
                          <label htmlFor={`${panelId}-manual-mpesa-code`}>
                            <span>M-PESA code (optional)</span>
                            <input
                              id={`${panelId}-manual-mpesa-code`}
                              type="text"
                              autoComplete="off"
                              className="auth-split__input"
                              placeholder="QGH7ABC123"
                              value={manualPaymentValues[customer.id]?.mpesaCode ?? ""}
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
                          </label>
                        </div>
                        <button
                          type="submit"
                          className="trans-chap-btn trans-chap-btn--secondary"
                          disabled={manualCollectingId === customer.id}
                        >
                          {manualCollectingId === customer.id ? "Recording…" : "Record payment"}
                        </button>
                      </form>
                    ) : null}

                    {allowOutstandingAdjustment ? (
                    <form
                      className="trans-chap-customer-manual trans-chap-customer-limit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveOutstanding(customer);
                      }}
                    >
                      <div className="trans-chap-customer-manual__head">
                        <span className="trans-chap-customer-section-label">Outstanding amount</span>
                        <p>
                          Currently {formatKsh(customer.outstanding_balance)}. Set the balance owed.
                        </p>
                      </div>
                      <div className="trans-chap-customer-limit__row">
                        <label htmlFor={`${panelId}-outstanding`} className="sr-only">
                          Outstanding amount (KES)
                        </label>
                        <input
                          id={`${panelId}-outstanding`}
                          type="text"
                          inputMode="decimal"
                          className="auth-split__input"
                          placeholder={formatKsh(customer.outstanding_balance)}
                          value={outstandingValues[customer.id] ?? ""}
                          onChange={(event) =>
                            setOutstandingValues((prev) => ({
                              ...prev,
                              [customer.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="submit"
                          className="trans-chap-btn trans-chap-btn--secondary"
                          disabled={
                            savingOutstandingId === customer.id ||
                            !(outstandingValues[customer.id] ?? "").trim()
                          }
                        >
                          {savingOutstandingId === customer.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </form>
                    ) : null}

                    <form
                      className="trans-chap-customer-manual trans-chap-customer-limit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveLimit(customer);
                      }}
                    >
                      <div className="trans-chap-customer-manual__head">
                        <span className="trans-chap-customer-section-label">Credit limit</span>
                        <p>
                          {hasCredit
                            ? `Currently ${formatKsh(customer.credit_limit)}. Set 0 for no cap.`
                            : "No limit set. Cap how much this customer can take on credit."}
                        </p>
                      </div>
                      <div className="trans-chap-customer-limit__row">
                        <label htmlFor={`${panelId}-credit-limit`} className="sr-only">
                          New credit limit (KES)
                        </label>
                        <input
                          id={`${panelId}-credit-limit`}
                          type="text"
                          inputMode="decimal"
                          className="auth-split__input"
                          placeholder={
                            hasCredit
                              ? formatKsh(customer.credit_limit)
                              : owes
                              ? `At least ${formatKsh(customer.outstanding_balance)}`
                              : "e.g. 1000"
                          }
                          value={limitValues[customer.id] ?? ""}
                          onChange={(event) =>
                            setLimitValues((prev) => ({
                              ...prev,
                              [customer.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="submit"
                          className="trans-chap-btn trans-chap-btn--secondary"
                          disabled={
                            savingLimitId === customer.id ||
                            !(limitValues[customer.id] ?? "").trim()
                          }
                        >
                          {savingLimitId === customer.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                      {hasCredit ? (
                        <button
                          type="button"
                          className="trans-chap-customer-limit__clear"
                          disabled={savingLimitId === customer.id}
                          onClick={() => void handleSaveLimit(customer, 0)}
                        >
                          Remove limit
                        </button>
                      ) : null}
                    </form>

                    <span className="trans-chap-customer-section-label">Details</span>
                    <div className="trans-chap-customer-contact">
                      <div className="trans-chap-customer-contact__item">
                        <span className="trans-chap-customer-contact__label">Contact</span>
                        {customer.phone ? (
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
                              void navigator.clipboard.writeText(customer.phone ?? "");
                              void toastSuccess("Phone copied!");
                            }}
                          >
                            <i className="fa-solid fa-copy" aria-hidden />
                          </button>
                        </div>
                        ) : (
                          <div className="trans-chap-customer-contact__val">No phone on file</div>
                        )}
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

                      {customer.date_to_pay && !owes ? (
                        <div className="trans-chap-customer-contact__item">
                          <span className="trans-chap-customer-contact__label">Date to pay</span>
                          <div className="trans-chap-customer-contact__val">
                            <i className="fa-regular fa-calendar-check" aria-hidden />
                            <span>{formatNairobiDate(customer.date_to_pay)}</span>
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
            label: "Import file",
            icon: "fa-file-import",
            onClick: openImport,
          },
        ]}
      />
    </div>
  );
}

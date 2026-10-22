"use client";

import Link from "next/link";
import {
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import {
  ContactImportModePicker,
  ContactImportResults,
} from "@/components/trans-chap/TransChapContactImport";
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
import { fetchShopSuppliers } from "@/lib/trans-chap-suppliers";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { useTransChapIsPhone } from "@/lib/trans-chap-list-view";
import type {
  ContactImportMode,
  SettingsOperationsResponse,
  ShopSupplier,
  ShopSupplierMutationResponse,
  ShopSupplierPayment,
  ShopSupplierPaymentsResponse,
  ShopSupplierRecordPaymentResponse,
  SupplierImportResponse,
  SupplierPaymentMethod,
} from "@/lib/types";

type SupplierForm = {
  name: string;
  phone: string;
  pin_number: string;
  email: string;
  city: string;
  address: string;
  postal_code: string;
  fax: string;
  balance: string;
  credit_limit: string;
  balance_due_date: string;
  notes: string;
};

type SupplierPaymentValues = {
  amount: string;
  method: SupplierPaymentMethod;
  reference: string;
  maturityDate: string;
  notes: string;
};

const EMPTY_PAYMENT: SupplierPaymentValues = {
  amount: "",
  method: "mpesa",
  reference: "",
  maturityDate: "",
  notes: "",
};

function paymentMethodLabel(method?: string | null): string {
  switch (method) {
    case "cash":
      return "Cash";
    case "mpesa":
      return "M-PESA";
    case "cheque":
      return "Cheque";
    default:
      return method ? method.toUpperCase() : "Sent";
  }
}

type View = "list" | "create" | "import";
type SupplierLayoutView = "grid" | "list";

const SUPPLIERS_VIEW_KEY = "trans-chap-suppliers-view";

function readSuppliersView(): SupplierLayoutView {
  if (typeof window === "undefined") return "list";
  try {
    const val = window.localStorage.getItem(SUPPLIERS_VIEW_KEY);
    return val === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

const EMPTY_FORM: SupplierForm = {
  name: "",
  phone: "",
  pin_number: "",
  email: "",
  city: "",
  address: "",
  postal_code: "",
  fax: "",
  balance: "0",
  credit_limit: "0",
  balance_due_date: "",
  notes: "",
};

type BalanceTone = "ok" | "wait" | "fail" | "credit";

function parseCreditLimit(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDueDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPaymentDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Days from today until the due date (negative when overdue). */
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayIso().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

function dueStatus(supplier: ShopSupplier): { label: string; tone: BalanceTone } | null {
  const due = supplier.balance_due_date;
  if (!due || Number(supplier.balance || 0) <= 0) return null;
  const days = daysUntil(due);
  if (days < 0) return { label: `Overdue ${-days}d`, tone: "fail" };
  if (days === 0) return { label: "Due today", tone: "fail" };
  if (days <= 7) return { label: `Due in ${days}d`, tone: "wait" };
  return { label: `Due in ${days}d`, tone: "ok" };
}

function balanceBadge(supplier: ShopSupplier): { label: string; tone: BalanceTone } {
  const bal = Number(supplier.balance || 0);
  const creditLimit = Number(supplier.credit_limit || 0);
  if (bal > 0) {
    const due = dueStatus(supplier);
    if (due) return { label: `Owes ${formatKsh(bal)} · ${due.label}`, tone: due.tone === "ok" ? "credit" : due.tone };
    return { label: `Owes ${formatKsh(bal)}`, tone: "credit" };
  }
  if (bal < 0) return { label: `Advance ${formatKsh(Math.abs(bal))}`, tone: "ok" };
  if (creditLimit > 0) return { label: `Limit ${formatKsh(creditLimit)}`, tone: "ok" };
  return { label: "CASH ONLY", tone: "wait" };
}

function formFromSupplier(supplier: ShopSupplier): SupplierForm {
  return {
    name: supplier.name,
    phone: supplier.phone ?? "",
    pin_number: supplier.pin_number ?? "",
    email: supplier.email ?? "",
    city: supplier.city ?? "",
    address: supplier.address ?? "",
    postal_code: supplier.postal_code ?? supplier.postalcode ?? "",
    fax: supplier.fax ?? "",
    balance: supplier.balance != null ? String(supplier.balance) : "0",
    credit_limit: supplier.credit_limit != null ? String(supplier.credit_limit) : "0",
    balance_due_date: supplier.balance_due_date ?? "",
    notes: supplier.notes ?? "",
  };
}

const SUPPLIERS_CACHE_KEY = "trans-chap:suppliers";

export function TransChapSuppliersList() {
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("list");
  const [storedLayoutView, setLayoutView] = useState<SupplierLayoutView>("list");
  const layoutView: SupplierLayoutView = storedLayoutView;

  useEffect(() => {
    setLayoutView(readSuppliersView());
  }, []);

  function setSuppliersLayoutView(next: SupplierLayoutView) {
    setLayoutView(next);
    try {
      window.localStorage.setItem(SUPPLIERS_VIEW_KEY, next);
    } catch {
      // Local storage might be blocked; view still changes in-memory.
    }
  }

  const [suppliers, setSuppliers] = useState<ShopSupplier[]>(
    () => readPageCache<ShopSupplier[]>(SUPPLIERS_CACHE_KEY) ?? [],
  );
  const [loading, setLoading] = useState(
    () => readPageCache(SUPPLIERS_CACHE_KEY) === undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [owingOnly, setOwingOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SupplierForm>(EMPTY_FORM);
  const [createForm, setCreateForm] = useState<SupplierForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [limitValues, setLimitValues] = useState<Record<string, string>>({});
  const [savingLimitId, setSavingLimitId] = useState<string | null>(null);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [paymentValues, setPaymentValues] = useState<Record<string, SupplierPaymentValues>>({});
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<Record<string, ShopSupplierPayment[]>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [allowOutstandingAdjustment, setAllowOutstandingAdjustment] = useState(false);
  const [balanceDrafts, setBalanceDrafts] = useState<Record<string, string>>({});
  const [savingBalanceId, setSavingBalanceId] = useState<string | null>(null);

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
  const [importMode, setImportMode] = useState<ContactImportMode>("merge");
  const [importing, setImporting] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<"xlsx" | "csv" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<SupplierImportResponse | null>(null);

  const reload = useCallback(async () => {
    if (readPageCache(SUPPLIERS_CACHE_KEY) === undefined) setLoading(true);
    try {
      const rows = await fetchShopSuppliers();
      setSuppliers(rows);
      writePageCache(SUPPLIERS_CACHE_KEY, rows);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load suppliers."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return suppliers.filter((row) => {
      if (owingOnly && !(Number(row.balance || 0) > 0)) return false;
      if (!needle) return true;
      return [
        row.name,
        row.phone,
        row.pin_number ?? "",
        row.email ?? "",
        row.city ?? "",
        row.address ?? "",
        row.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [owingOnly, query, suppliers]);

  async function handleDownloadTemplate(format: "xlsx" | "csv") {
    setDownloadingFormat(format);
    try {
      const url = apiRoutes.supplierTemplate(format);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Template download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `dukai_suppliers_template.${format}`;
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

  const loadSupplierPayments = useCallback(async (supplierId: string) => {
    try {
      const res = await apiFetch<ShopSupplierPaymentsResponse>(
        apiRoutes.supplierPayments(supplierId),
      );
      setSupplierPayments((prev) => ({ ...prev, [supplierId]: res.data }));
    } catch {
      // Non-critical background fetch
    }
  }, []);

  function toggle(supplier: ShopSupplier) {
    const open = openId === supplier.id;
    setOpenId(open ? null : supplier.id);
    setEditingSupplierId(null);
    if (!open) {
      setEditForm(formFromSupplier(supplier));
      void loadSupplierPayments(supplier.id);
    }
  }

  function payloadFromForm(form: SupplierForm) {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) throw new Error("Enter the supplier's name.");
    if (!phone) throw new Error("Enter a phone number.");
    const balanceRaw = form.balance.trim().replace(/,/g, "");
    const balanceNum = balanceRaw ? Number(balanceRaw) : 0;
    const creditLimitRaw = (form.credit_limit || "").trim().replace(/,/g, "");
    const creditLimitNum = creditLimitRaw ? Number(creditLimitRaw) : 0;
    return {
      name,
      phone,
      pin_number: form.pin_number.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      postal_code: form.postal_code.trim() || null,
      fax: form.fax.trim() || null,
      ...(allowOutstandingAdjustment
        ? { balance: Number.isFinite(balanceNum) ? balanceNum : 0 }
        : {}),
      credit_limit: Number.isFinite(creditLimitNum) ? creditLimitNum : 0,
      balance_due_date: form.balance_due_date || null,
      notes: form.notes.trim() || null,
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
      const res = await apiFetch<ShopSupplierMutationResponse>(apiRoutes.suppliers, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSuppliers((prev) =>
        [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setView("list");
      setCreateForm(EMPTY_FORM);
      setOpenId(res.data.id);
      setEditForm(formFromSupplier(res.data));
      await toastSuccess("Supplier saved");
    } catch (err) {
      await showError("Could not save supplier", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(event: FormEvent, supplier: ShopSupplier) {
    event.preventDefault();
    let payload;
    try {
      payload = payloadFromForm(editForm);
    } catch (err) {
      await showError("Check details", extractErrorMessage(err));
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<ShopSupplierMutationResponse>(
        apiRoutes.supplierUpdate(supplier.id),
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      setSuppliers((prev) =>
        prev
          .map((row) => (row.id === res.data.id ? res.data : row))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditForm(formFromSupplier(res.data));
      setEditingSupplierId(null);
      await toastSuccess("Supplier updated");
    } catch (err) {
      await showError("Could not update supplier", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveTableBalance(supplier: ShopSupplier) {
    if (!allowOutstandingAdjustment || savingBalanceId === supplier.id) return;
    const raw = (balanceDrafts[supplier.id] ?? String(supplier.balance ?? 0)).trim().replace(/,/g, "");
    const amount = raw ? Number(raw) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      await showError("Check balance", "Enter a balance of 0 or more.");
      setBalanceDrafts((prev) => {
        const next = { ...prev };
        delete next[supplier.id];
        return next;
      });
      return;
    }
    if (Math.abs(amount - Number(supplier.balance || 0)) < 0.009) {
      setBalanceDrafts((prev) => {
        const next = { ...prev };
        delete next[supplier.id];
        return next;
      });
      return;
    }
    setSavingBalanceId(supplier.id);
    try {
      const res = await apiFetch<ShopSupplierMutationResponse>(
        apiRoutes.supplierUpdate(supplier.id),
        { method: "POST", body: JSON.stringify({ balance: amount }) },
      );
      setSuppliers((prev) => prev.map((row) => (row.id === supplier.id ? res.data : row)));
      setBalanceDrafts((prev) => {
        const next = { ...prev };
        delete next[supplier.id];
        return next;
      });
      if (openId === supplier.id) setEditForm(formFromSupplier(res.data));
      await toastSuccess(`Balance set to ${formatKsh(amount)}`);
    } catch (err) {
      await showError("Could not update balance", extractErrorMessage(err));
    } finally {
      setSavingBalanceId(null);
    }
  }

  async function handleSaveLimit(supplier: ShopSupplier, override?: number) {
    const raw = limitValues[supplier.id] ?? "";
    const limit = override ?? parseCreditLimit(raw);
    if (limit == null) {
      await showError("Check credit limit", "Enter a credit limit of 0 or more.");
      return;
    }
    const bal = Number(supplier.balance || 0);
    if (limit > 0 && bal > limit) {
      await showError(
        "Limit too low",
        `${supplier.name} already owes ${formatKsh(bal)}. Set a limit of at least that, or 0 for no cap.`,
      );
      return;
    }

    setSavingLimitId(supplier.id);
    try {
      const res = await apiFetch<ShopSupplierMutationResponse>(
        apiRoutes.supplierUpdate(supplier.id),
        { method: "POST", body: JSON.stringify({ credit_limit: limit }) },
      );
      setSuppliers((prev) =>
        prev.map((row) => (row.id === supplier.id ? res.data : row)),
      );
      setLimitValues((prev) => ({ ...prev, [supplier.id]: "" }));
      await toastSuccess(
        limit > 0 ? `Credit limit set to ${formatKsh(limit)}` : "Credit limit removed",
      );
    } catch (err) {
      await showError("Could not update credit limit", extractErrorMessage(err));
    } finally {
      setSavingLimitId(null);
    }
  }

  async function handleRecordPayment(supplier: ShopSupplier) {
    const cur = paymentValues[supplier.id] ?? EMPTY_PAYMENT;
    const raw = cur.amount.trim().replace(/,/g, "");
    const amt = Number(raw);
    if (!raw || !Number.isFinite(amt) || amt <= 0) {
      await showError("Invalid amount", "Please enter a valid amount greater than zero.");
      return;
    }

    const method = cur.method || "mpesa";
    if (method === "cheque" && !cur.maturityDate.trim()) {
      await showError(
        "Date of maturity needed",
        "Please select the date of maturity for the cheque payment.",
      );
      return;
    }

    setRecordingPaymentId(supplier.id);
    try {
      const res = await apiFetch<ShopSupplierRecordPaymentResponse>(
        apiRoutes.supplierPayments(supplier.id),
        {
          method: "POST",
          body: JSON.stringify({
            amount: amt,
            payment_method: method,
            reference: cur.reference.trim() || null,
            cheque_maturity_date:
              method === "cheque" && cur.maturityDate.trim() ? cur.maturityDate.trim() : null,
            notes: cur.notes.trim() || null,
          }),
        },
      );
      setSuppliers((prev) =>
        prev.map((row) => (row.id === supplier.id ? res.data.supplier : row)),
      );
      setSupplierPayments((prev) => ({
        ...prev,
        [supplier.id]: [res.data.payment, ...(prev[supplier.id] ?? [])],
      }));
      setPaymentValues((prev) => ({
        ...prev,
        [supplier.id]: { ...EMPTY_PAYMENT },
      }));
      await toastSuccess(
        `Payment of ${formatKsh(amt)} (${paymentMethodLabel(method)}) sent to ${supplier.name} recorded!`,
      );
    } catch (err) {
      await showError("Could not record payment", extractErrorMessage(err));
    } finally {
      setRecordingPaymentId(null);
    }
  }

  async function removeSupplier(supplier: ShopSupplier) {
    const ok = await confirmAction(
      "Remove supplier?",
      `${supplier.name} will be removed from this shop.`,
    );
    if (!ok) return;
    setRemovingId(supplier.id);
    try {
      await apiFetch(apiRoutes.supplier(supplier.id), { method: "DELETE" });
      setSuppliers((prev) => prev.filter((row) => row.id !== supplier.id));
      if (openId === supplier.id) setOpenId(null);
      await toastSuccess("Supplier removed");
    } catch (err) {
      await showError("Could not remove supplier", extractErrorMessage(err));
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
        "Replace your supplier list?",
        "Suppliers not in this file will be removed. Suppliers with a balance or purchase history are kept. This can't be undone.",
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
      const res = await apiFetch<SupplierImportResponse>(apiRoutes.suppliersImport(importMode), {
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

  if (view === "create") {
    return (
      <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleCreate(e)}>
        <p className="trans-chap-form__lead">
          Add a wholesaler or vendor you buy stock from.
        </p>
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
            Suppliers
          </button>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-name">Supplier Name</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-name"
                required
                autoComplete="organization"
                className="auth-split__input"
                placeholder="e.g. Brookside Dairy Ltd"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-phone">Phone number</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-phone"
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
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-pin">Tax / KRA PIN (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-pin"
                className="auth-split__input"
                placeholder="e.g. P051234567Z"
                value={createForm.pin_number}
                onChange={(e) => setCreateForm((f) => ({ ...f, pin_number: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-email">Email (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-email"
                type="email"
                autoComplete="email"
                className="auth-split__input"
                placeholder="orders@supplier.com"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-city">City / Town (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-city"
                className="auth-split__input"
                placeholder="e.g. Nairobi"
                value={createForm.city}
                onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-address">Physical Address (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-address"
                className="auth-split__input"
                placeholder="e.g. Industrial Area, Enterprise Rd"
                value={createForm.address}
                onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-postal">Postal Code (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-postal"
                className="auth-split__input"
                placeholder="e.g. 00100"
                value={createForm.postal_code}
                onChange={(e) => setCreateForm((f) => ({ ...f, postal_code: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-fax">Fax (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-fax"
                type="tel"
                className="auth-split__input"
                placeholder="Fax number"
                value={createForm.fax}
                onChange={(e) => setCreateForm((f) => ({ ...f, fax: e.target.value }))}
              />
            </div>
          </div>
          {allowOutstandingAdjustment ? (
            <>
              <div className="auth-split__field">
                <label htmlFor="trans-chap-supplier-balance">Current Balance (KES, optional)</label>
                <div className="trans-chap-input">
                  <input
                    id="trans-chap-supplier-balance"
                    type="text"
                    inputMode="decimal"
                    className="auth-split__input"
                    placeholder="0.00"
                    value={createForm.balance}
                    onChange={(e) => setCreateForm((f) => ({ ...f, balance: e.target.value }))}
                  />
                </div>
              </div>
              <div className="auth-split__field">
                <label htmlFor="trans-chap-supplier-due">Pay balance by (optional)</label>
                <div className="trans-chap-input">
                  <input
                    id="trans-chap-supplier-due"
                    type="date"
                    className="auth-split__input"
                    value={createForm.balance_due_date}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, balance_due_date: e.target.value }))
                    }
                  />
                </div>
              </div>
            </>
          ) : null}
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-notes">Notes (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-notes"
                className="auth-split__input"
                placeholder="Payment terms, delivery schedules, etc."
                value={createForm.notes}
                onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <div className="trans-chap-form__actions">
          <button type="submit" className="auth-split__btn" disabled={saving}>
            {saving ? "Saving…" : "Save supplier"}
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
          <code>Name</code> (or <code>Business Name</code>) and <code>Phone</code>. Suppliers are
          matched by phone or PIN, and rows with the same phone are merged into one supplier.
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
            Suppliers
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
              Supported columns: <code>BALANCE</code>, <code>ADDRESS</code>, <code>POSTALCODE</code>, <code>CITY</code>, <code>EMAIL</code>, <code>PHONE</code>, <code>FAX</code>, <code>PIN_NUMBER</code>, <code>NAME</code>
            </p>
          </div>

          <ContactImportModePicker
            noun={{ singular: "supplier", plural: "suppliers" }}
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
              noun={{ singular: "supplier", plural: "suppliers" }}
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
                ? "Replace supplier list"
                : "Import suppliers"}
          </button>
          {importResult ? (
            <button
              type="button"
              className="trans-chap-form__secondary"
              onClick={() => {
                setImportFile(null);
                setImportError(null);
                setImportResult(null);
              }}
            >
              Import another file
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderEditForm(supplier: ShopSupplier, panelId: string, open: boolean) {
    return (
      <form
        className="trans-chap-form__block"
        onSubmit={(event) => void handleEdit(event, supplier)}
      >
        <p className="trans-chap-form__block-title">Details</p>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-name`}>Supplier Name</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-name`}
              required
              className="auth-split__input"
              value={open ? editForm.name : supplier.name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, name: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-phone`}>Phone number</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-phone`}
              required
              type="tel"
              className="auth-split__input"
              value={open ? editForm.phone : (supplier.phone ?? "")}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, phone: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-pin`}>Tax / KRA PIN</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-pin`}
              className="auth-split__input"
              placeholder="e.g. P051234567Z"
              value={open ? editForm.pin_number : supplier.pin_number ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, pin_number: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-email`}>Email</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-email`}
              type="email"
              className="auth-split__input"
              placeholder="orders@supplier.com"
              value={open ? editForm.email : supplier.email ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-city`}>City / Town</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-city`}
              className="auth-split__input"
              placeholder="e.g. Nairobi"
              value={open ? editForm.city : supplier.city ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, city: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-address`}>Physical Address</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-address`}
              className="auth-split__input"
              placeholder="e.g. Industrial Area, Enterprise Rd"
              value={open ? editForm.address : supplier.address ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, address: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-postal`}>Postal Code</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-postal`}
              className="auth-split__input"
              placeholder="e.g. 00100"
              value={
                open
                  ? editForm.postal_code
                  : supplier.postal_code ?? supplier.postalcode ?? ""
              }
              onChange={(e) =>
                setEditForm((f) => ({ ...f, postal_code: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-fax`}>Fax</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-fax`}
              type="tel"
              className="auth-split__input"
              placeholder="Fax number"
              value={open ? editForm.fax : supplier.fax ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, fax: e.target.value }))
              }
            />
          </div>
        </div>
        {allowOutstandingAdjustment ? (
          <>
            <div className="auth-split__field">
              <label htmlFor={`${panelId}-balance`}>Current Balance (KES)</label>
              <div className="trans-chap-input">
                <input
                  id={`${panelId}-balance`}
                  type="text"
                  inputMode="decimal"
                  className="auth-split__input"
                  placeholder="0.00"
                  value={
                    open
                      ? editForm.balance
                      : supplier.balance != null
                      ? String(supplier.balance)
                      : "0"
                  }
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, balance: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="auth-split__field">
              <label htmlFor={`${panelId}-due`}>Pay balance by</label>
              <div className="trans-chap-input">
                <input
                  id={`${panelId}-due`}
                  type="date"
                  className="auth-split__input"
                  value={open ? editForm.balance_due_date : supplier.balance_due_date ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, balance_due_date: e.target.value }))
                  }
                />
              </div>
            </div>
          </>
        ) : null}
        <div className="auth-split__field">
          <label htmlFor={`${panelId}-notes`}>Notes</label>
          <div className="trans-chap-input">
            <input
              id={`${panelId}-notes`}
              className="auth-split__input"
              value={open ? editForm.notes : supplier.notes ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>
        </div>
        <button
          type="submit"
          className="auth-split__btn"
          disabled={saving}
        >
          {saving && openId === supplier.id ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          className="trans-chap-form__secondary"
          disabled={removingId === supplier.id}
          onClick={() => void removeSupplier(supplier)}
        >
          {removingId === supplier.id ? "Removing…" : "Remove supplier"}
        </button>
      </form>
    );
  }

  function renderSupplierDetail(supplier: ShopSupplier, panelId: string) {
    if (editingSupplierId === supplier.id) {
      return (
        <div className="trans-chap-form__block trans-chap-customer-detail">
          <div className="trans-chap-customer-detail__top-bar">
            <div className="trans-chap-customer-detail__title">
              <h4>Edit {supplier.name}</h4>
              <p>Update supplier contact info, location or credit limit</p>
            </div>
            <button
              type="button"
              className="trans-chap-customer-detail__close-btn"
              onClick={() => setEditingSupplierId(null)}
              title="Cancel editing"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
              <span>Cancel</span>
            </button>
          </div>
          {renderEditForm(supplier, panelId, true)}
          <button
            type="button"
            className="trans-chap-btn trans-chap-btn--ghost trans-chap-customer-actions__wide"
            onClick={() => setEditingSupplierId(null)}
          >
            Cancel editing
          </button>
        </div>
      );
    }

    const bal = Number(supplier.balance || 0);
    const owes = bal > 0;
    const creditLimit = Number(supplier.credit_limit || 0);
    const hasCredit = creditLimit > 0;
    const availableCredit = creditLimit - bal;
    const creditPct = hasCredit
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((availableCredit / creditLimit) * 100),
          ),
        )
      : 0;
    const cleanPhone = (supplier.phone ?? "").replace(/\D/g, "");

    return (
      <div className="trans-chap-form__block trans-chap-customer-detail">
        <div className="trans-chap-customer-detail__top-bar">
          <div className="trans-chap-customer-detail__title">
            <h4>{supplier.name}</h4>
            <p>
              {supplier.phone ? supplier.phone : "No phone on file"}
              {supplier.city ? ` • ${supplier.city}` : ""}
              {supplier.pin_number ? ` • PIN: ${supplier.pin_number}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="trans-chap-customer-detail__close-btn"
            onClick={() => setOpenId(null)}
            title="Close details"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
            <span>Close</span>
          </button>
        </div>

        <div className="trans-chap-customer-detail__grid">
          <div className="trans-chap-customer-detail__col trans-chap-customer-detail__col--main">
            <section
              className={`trans-chap-customer-balance${owes ? " is-owes" : " is-clear"}`}
            >
              <div className="trans-chap-customer-balance__top">
                <div>
                  <span className="trans-chap-customer-balance__label">
                    {owes ? "Balance owed" : "Balance"}
                  </span>
                  <strong className="trans-chap-customer-balance__amount">
                    {owes
                      ? formatKsh(bal)
                      : bal < 0
                      ? `Advance ${formatKsh(Math.abs(bal))}`
                      : "All paid up"}
                  </strong>
                </div>
                {supplier.balance_due_date && owes ? (
                  <span className="trans-chap-customer-balance__due">
                    <i className="fa-regular fa-calendar" aria-hidden />
                    Due {formatDueDate(supplier.balance_due_date)}
                  </span>
                ) : null}
              </div>

              {hasCredit ? (
                <div className="trans-chap-customer-balance__limit">
                  <div className="trans-chap-customer-credit-card__meter">
                    <div
                      className={`trans-chap-customer-credit-card__meter-bar${
                        availableCredit <= 0
                          ? " is-exceeded"
                          : creditPct <= 25
                          ? " is-low"
                          : ""
                      }`}
                      style={{ width: `${creditPct}%` }}
                    />
                  </div>
                  <p>
                    <strong>{formatKsh(availableCredit)}</strong> of{" "}
                    {formatKsh(creditLimit)} credit available
                  </p>
                </div>
              ) : (
                <p className="trans-chap-customer-balance__note">
                  {owes
                    ? "No credit limit set — this tab has no cap."
                    : "Cash only — no credit limit set."}
                </p>
              )}
            </section>

            <div className="trans-chap-customer-actions">
              <Link
                href={`/trans-chap/purchases/new?supplier=${encodeURIComponent(supplier.name)}`}
                className="trans-chap-btn trans-chap-btn--primary trans-chap-customer-actions__wide"
              >
                <i className="fa-solid fa-box-open" aria-hidden />
                <span>Receive goods</span>
              </Link>
              {supplier.phone ? (
                <>
                  {cleanPhone ? (
                    <a
                      href={`https://wa.me/${cleanPhone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="trans-chap-btn trans-chap-btn--ghost"
                    >
                      <i className="fa-brands fa-whatsapp" aria-hidden />
                      <span>WhatsApp</span>
                    </a>
                  ) : null}
                  <a
                    href={`tel:${supplier.phone}`}
                    className="trans-chap-btn trans-chap-btn--ghost"
                  >
                    <i className="fa-solid fa-phone" aria-hidden />
                    <span>Call</span>
                  </a>
                </>
              ) : (
                <p className="trans-chap-mpesa-gate trans-chap-customer-actions__wide">
                  No phone on file — add one to sell on credit, send M-PESA prompts or WhatsApp reminders.
                </p>
              )}

              {!owes ? (
                <button
                  type="button"
                  className="trans-chap-btn trans-chap-btn--ghost trans-chap-customer-actions__wide trans-chap-customer-actions__danger"
                  disabled={removingId === supplier.id}
                  onClick={() => void removeSupplier(supplier)}
                >
                  <i className="fa-solid fa-trash-can" aria-hidden />
                  <span>{removingId === supplier.id ? "Removing…" : "Remove supplier"}</span>
                </button>
              ) : null}
            </div>

            {(() => {
              const curPay = paymentValues[supplier.id] ?? EMPTY_PAYMENT;
              const method = curPay.method || "mpesa";
              return (
                <form
                  className="trans-chap-customer-manual"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleRecordPayment(supplier);
                  }}
                >
                  <div className="trans-chap-customer-manual__head">
                    <span className="trans-chap-customer-section-label">Record amount sent</span>
                    <p>
                      {bal > 0
                        ? `Record payment sent to pay down the ${formatKsh(bal)} balance owed.`
                        : "Record payment or advance deposit sent to this supplier."}
                    </p>
                  </div>

                  <div className="trans-chap-pay-picker">
                    <span className="trans-chap-pay-picker__label">Payment method</span>
                    <div
                      className="trans-chap-pay-picker__options"
                      role="radiogroup"
                      aria-label="Payment method"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={method === "cash"}
                        className={`trans-chap-pay-picker__btn${method === "cash" ? " is-active" : ""}`}
                        onClick={() =>
                          setPaymentValues((prev) => ({
                            ...prev,
                            [supplier.id]: {
                              amount: prev[supplier.id]?.amount ?? "",
                              method: "cash",
                              reference: prev[supplier.id]?.reference ?? "",
                              maturityDate: prev[supplier.id]?.maturityDate ?? "",
                              notes: prev[supplier.id]?.notes ?? "",
                            },
                          }))
                        }
                      >
                        <i className="fa-solid fa-money-bill-wave" aria-hidden="true" />
                        <span>Cash</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={method === "mpesa"}
                        className={`trans-chap-pay-picker__btn${method === "mpesa" ? " is-active" : ""}`}
                        onClick={() =>
                          setPaymentValues((prev) => ({
                            ...prev,
                            [supplier.id]: {
                              amount: prev[supplier.id]?.amount ?? "",
                              method: "mpesa",
                              reference: prev[supplier.id]?.reference ?? "",
                              maturityDate: prev[supplier.id]?.maturityDate ?? "",
                              notes: prev[supplier.id]?.notes ?? "",
                            },
                          }))
                        }
                      >
                        <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
                        <span>M-Pesa</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={method === "cheque"}
                        className={`trans-chap-pay-picker__btn${method === "cheque" ? " is-active" : ""}`}
                        onClick={() =>
                          setPaymentValues((prev) => ({
                            ...prev,
                            [supplier.id]: {
                              amount: prev[supplier.id]?.amount ?? "",
                              method: "cheque",
                              reference: prev[supplier.id]?.reference ?? "",
                              maturityDate: prev[supplier.id]?.maturityDate ?? "",
                              notes: prev[supplier.id]?.notes ?? "",
                            },
                          }))
                        }
                      >
                        <i className="fa-solid fa-money-check" aria-hidden="true" />
                        <span>Cheque</span>
                      </button>
                    </div>
                  </div>

                  <div className="trans-chap-customer-manual__fields">
                    <label htmlFor={`${panelId}-payment-amount`}>
                      <span>Amount (KES)</span>
                      <input
                        id={`${panelId}-payment-amount`}
                        type="text"
                        inputMode="decimal"
                        required
                        className="auth-split__input"
                        placeholder={bal > 0 ? formatKsh(bal) : "e.g. 5,000"}
                        value={curPay.amount}
                        onChange={(event) =>
                          setPaymentValues((prev) => ({
                            ...prev,
                            [supplier.id]: {
                              amount: event.target.value,
                              method: prev[supplier.id]?.method ?? "mpesa",
                              reference: prev[supplier.id]?.reference ?? "",
                              maturityDate: prev[supplier.id]?.maturityDate ?? "",
                              notes: prev[supplier.id]?.notes ?? "",
                            },
                          }))
                        }
                      />
                    </label>
                    <label htmlFor={`${panelId}-payment-ref`}>
                      <span>
                        {method === "cash"
                          ? "Receipt / Ref (optional)"
                          : method === "cheque"
                            ? "Cheque no. / Ref (optional)"
                            : "M-PESA / Ref (optional)"}
                      </span>
                      <input
                        id={`${panelId}-payment-ref`}
                        type="text"
                        autoComplete="off"
                        className="auth-split__input"
                        placeholder={
                          method === "cash"
                            ? "e.g. REC-1029"
                            : method === "cheque"
                              ? "e.g. CHQ-00123"
                              : "e.g. QGH7ABC123"
                        }
                        value={curPay.reference}
                        onChange={(event) =>
                          setPaymentValues((prev) => ({
                            ...prev,
                            [supplier.id]: {
                              amount: prev[supplier.id]?.amount ?? "",
                              method: prev[supplier.id]?.method ?? "mpesa",
                              reference: event.target.value,
                              maturityDate: prev[supplier.id]?.maturityDate ?? "",
                              notes: prev[supplier.id]?.notes ?? "",
                            },
                          }))
                        }
                      />
                    </label>

                    {method === "cheque" ? (
                      <label
                        htmlFor={`${panelId}-payment-maturity`}
                        className="trans-chap-customer-manual__field--full"
                      >
                        <span>Date of maturity (cheque maturity)</span>
                        <input
                          id={`${panelId}-payment-maturity`}
                          type="date"
                          required
                          className="auth-split__input"
                          value={curPay.maturityDate}
                          onChange={(event) =>
                            setPaymentValues((prev) => ({
                              ...prev,
                              [supplier.id]: {
                                amount: prev[supplier.id]?.amount ?? "",
                                method: prev[supplier.id]?.method ?? "mpesa",
                                reference: prev[supplier.id]?.reference ?? "",
                                maturityDate: event.target.value,
                                notes: prev[supplier.id]?.notes ?? "",
                              },
                            }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="trans-chap-customer-limit__row">
                    <label htmlFor={`${panelId}-payment-notes`} className="sr-only">
                      Notes (optional)
                    </label>
                    <input
                      id={`${panelId}-payment-notes`}
                      type="text"
                      className="auth-split__input"
                      placeholder="Notes / description (optional, e.g. milk shipment)"
                      value={curPay.notes}
                      onChange={(event) =>
                        setPaymentValues((prev) => ({
                          ...prev,
                          [supplier.id]: {
                            amount: prev[supplier.id]?.amount ?? "",
                            method: prev[supplier.id]?.method ?? "mpesa",
                            reference: prev[supplier.id]?.reference ?? "",
                            maturityDate: prev[supplier.id]?.maturityDate ?? "",
                            notes: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <button
                    type="submit"
                    className="trans-chap-btn trans-chap-btn--secondary"
                    disabled={
                      recordingPaymentId === supplier.id ||
                      !curPay.amount.trim() ||
                      (method === "cheque" && !curPay.maturityDate.trim())
                    }
                  >
                    {recordingPaymentId === supplier.id
                      ? "Recording payment…"
                      : method === "cheque"
                        ? "Record cheque sent"
                        : method === "cash"
                          ? "Record cash sent"
                          : "Record amount sent"}
                  </button>
                </form>
              );
            })()}

            {supplierPayments[supplier.id]?.length ? (
              <div className="trans-chap-customer-tab">
                <span className="trans-chap-customer-section-label">Recent amounts sent</span>
                <ul className="trans-chap-customer-tab__sales">
                  {supplierPayments[supplier.id].map((payment) => (
                    <li key={payment.id} className="trans-chap-customer-tab__sale">
                      <div className="trans-chap-customer-tab__sale-head">
                        <div>
                          <strong>{formatKsh(payment.amount)} sent</strong>
                          <span>
                            {formatPaymentDateTime(payment.paid_at)}
                            {payment.payment_method ? ` • ${paymentMethodLabel(payment.payment_method)}` : ""}
                            {payment.reference ? ` • Ref: ${payment.reference}` : ""}
                          </span>
                          {payment.payment_method === "cheque" &&
                          (payment.cheque_maturity_date || payment.maturity_date) ? (
                            <span className="trans-chap-customer-tab__cheque-info">
                              <i className="fa-solid fa-calendar-check" aria-hidden="true" />
                              <span>
                                Maturity:{" "}
                                <strong>
                                  {formatDueDate(
                                    payment.cheque_maturity_date || payment.maturity_date!,
                                  )}
                                </strong>
                              </span>
                            </span>
                          ) : null}
                          {payment.notes ? <span>{payment.notes}</span> : null}
                        </div>
                        <div className="trans-chap-customer-tab__sale-amt">
                          <span
                            className={`trans-chap-customer-tab__pill is-paid trans-chap-customer-tab__pill--${payment.payment_method || "mpesa"}`}
                          >
                            {paymentMethodLabel(payment.payment_method)}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="trans-chap-customer-detail__col trans-chap-customer-detail__col--side">
            <form
              className="trans-chap-customer-manual trans-chap-customer-limit"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveLimit(supplier);
              }}
            >
              <div className="trans-chap-customer-manual__head">
                <span className="trans-chap-customer-section-label">Credit limit</span>
                <p>
                  {hasCredit
                    ? `Currently ${formatKsh(creditLimit)}. Set 0 for no cap.`
                    : "No limit set. Cap how much can be owed to this supplier."}
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
                      ? formatKsh(creditLimit)
                      : owes
                      ? `At least ${formatKsh(bal)}`
                      : "e.g. 1000"
                  }
                  value={limitValues[supplier.id] ?? ""}
                  onChange={(event) =>
                    setLimitValues((prev) => ({
                      ...prev,
                      [supplier.id]: event.target.value,
                    }))
                  }
                />
                <button
                  type="submit"
                  className="trans-chap-btn trans-chap-btn--secondary"
                  disabled={
                    savingLimitId === supplier.id ||
                    !(limitValues[supplier.id] ?? "").trim()
                  }
                >
                  {savingLimitId === supplier.id ? "Saving…" : "Save"}
                </button>
              </div>
              {hasCredit ? (
                <button
                  type="button"
                  className="trans-chap-customer-limit__clear"
                  disabled={savingLimitId === supplier.id}
                  onClick={() => void handleSaveLimit(supplier, 0)}
                >
                  Remove limit
                </button>
              ) : null}
            </form>

            <span className="trans-chap-customer-section-label">Details</span>
            <div className="trans-chap-customer-contact">
              <div className="trans-chap-customer-contact__item">
                <span className="trans-chap-customer-contact__label">Contact</span>
                {supplier.phone ? (
                  <div className="trans-chap-customer-contact__val">
                    <a
                      href={`tel:${supplier.phone}`}
                      className="trans-chap-customer-contact__link"
                      title="Call supplier"
                    >
                      <i className="fa-solid fa-phone" aria-hidden />
                      <span>{supplier.phone}</span>
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
                        void navigator.clipboard.writeText(supplier.phone ?? "");
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

              {supplier.address || supplier.city ? (
                <div className="trans-chap-customer-contact__item">
                  <span className="trans-chap-customer-contact__label">Location</span>
                  <div className="trans-chap-customer-contact__val">
                    <i className="fa-solid fa-location-dot" aria-hidden />
                    <span>{[supplier.address, supplier.city].filter(Boolean).join(", ")}</span>
                  </div>
                </div>
              ) : null}

              {supplier.pin_number ? (
                <div className="trans-chap-customer-contact__item">
                  <span className="trans-chap-customer-contact__label">KRA PIN</span>
                  <div className="trans-chap-customer-contact__val">
                    <span>{supplier.pin_number}</span>
                  </div>
                </div>
              ) : null}

              {supplier.email ? (
                <div className="trans-chap-customer-contact__item">
                  <span className="trans-chap-customer-contact__label">Email</span>
                  <div className="trans-chap-customer-contact__val">
                    <a
                      href={`mailto:${supplier.email}`}
                      className="trans-chap-customer-contact__link"
                    >
                      <i className="fa-solid fa-envelope" aria-hidden />
                      <span>{supplier.email}</span>
                    </a>
                  </div>
                </div>
              ) : null}

              {supplier.balance_due_date && !owes ? (
                <div className="trans-chap-customer-contact__item">
                  <span className="trans-chap-customer-contact__label">Date to pay</span>
                  <div className="trans-chap-customer-contact__val">
                    <i className="fa-regular fa-calendar-check" aria-hidden />
                    <span>{formatDueDate(supplier.balance_due_date)}</span>
                  </div>
                </div>
              ) : null}

              {supplier.notes ? (
                <div className="trans-chap-customer-contact__notes">
                  <span className="trans-chap-customer-contact__label">Notes</span>
                  <p>{supplier.notes}</p>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="trans-chap-btn trans-chap-btn--ghost trans-chap-customer-actions__wide"
              onClick={() => {
                setEditForm(formFromSupplier(supplier));
                setEditingSupplierId(supplier.id);
              }}
            >
              <i className="fa-solid fa-pen-to-square" aria-hidden />
              <span>Edit supplier details</span>
            </button>
          </div>
        </div>

        <div className="trans-chap-customer-detail__footer">
          <button
            type="button"
            className="trans-chap-customer-detail__close-btn"
            onClick={() => setOpenId(null)}
          >
            <i className="fa-solid fa-chevron-up" aria-hidden="true" />
            <span>Close supplier details</span>
          </button>
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
              placeholder="Search suppliers by name, phone, PIN, city…"
              aria-label="Search suppliers"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="trans-chap-sales__view" role="group" aria-label="Supplier layout">
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${layoutView === "grid" ? " is-on" : ""}`}
              aria-pressed={layoutView === "grid"}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setSuppliersLayoutView("grid")}
            >
              <i className="fa-solid fa-table-cells" aria-hidden />
            </button>
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${layoutView === "list" ? " is-on" : ""}`}
              aria-pressed={layoutView === "list"}
              aria-label="List view"
              title="List view"
              onClick={() => setSuppliersLayoutView("list")}
            >
              <i className="fa-solid fa-list" aria-hidden />
            </button>
          </div>
        </div>

        <div className="trans-chap-sales__chips" role="toolbar" aria-label="Supplier actions">
          <button
            type="button"
            className="trans-chap-chip trans-chap-chip--primary"
            onClick={openCreate}
          >
            <i className="fa-solid fa-plus" aria-hidden />
            <span>Add supplier</span>
          </button>
          <button
            type="button"
            className={`trans-chap-chip${owingOnly ? " trans-chap-chip--primary" : ""}`}
            aria-pressed={owingOnly}
            onClick={() => setOwingOnly((on) => !on)}
          >
            <i className="fa-solid fa-scale-unbalanced" aria-hidden />
            <span>{owingOnly ? "You owe" : "All suppliers"}</span>
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
      </div>

      {loading ? (
        <div className="trans-chap-sales__list" aria-busy="true" aria-label="Loading suppliers">
          <TransChapListSkeleton />
        </div>
      ) : error && suppliers.length === 0 ? (
        <TransChapStatus tone="error">{error}</TransChapStatus>
      ) : suppliers.length === 0 ? (
        <TransChapStatus>
          No suppliers yet. Tap + to add people you buy from, or import from Excel or CSV.
        </TransChapStatus>
      ) : filtered.length === 0 ? (
        <p className="trans-chap-sales__empty">
          {owingOnly && !query.trim()
            ? "You don't owe any suppliers right now. Show all suppliers to see everyone."
            : "No suppliers match this search."}
        </p>
      ) : layoutView === "list" ? (
        <div className="trans-chap-sales__list">
          <div className="trans-chap-stock-table-wrap trans-chap-stock-table-wrap--cards">
            <table className="trans-chap-stock-table trans-chap-stock-table--cards trans-chap-stock-table--supplier">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Phone</th>
                  <th scope="col">City</th>
                  <th scope="col">PIN</th>
                  <th scope="col">Balance owed</th>
                  <th scope="col">Pay by</th>
                  <th className="trans-chap-stock-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((supplier) => {
                  const open = openId === supplier.id;
                  const panelId = `${listId}-${supplier.id}`;
                  const bal = Number(supplier.balance || 0);
                  const due = dueStatus(supplier);
                  return (
                    <Fragment key={supplier.id}>
                      <tr
                        className={`is-clickable ${open ? "is-picked" : ""}`}
                        title={open ? "Click to close details" : "Click to view details"}
                        tabIndex={0}
                        role="button"
                        aria-expanded={open}
                        aria-controls={`${panelId}-edit`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) {
                            return;
                          }
                          toggle(supplier);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) {
                              return;
                            }
                            e.preventDefault();
                            toggle(supplier);
                          }
                        }}
                      >
                        <td className="trans-chap-stock-table__product">{supplier.name}</td>
                        <td className="trans-chap-stock-table__mono">{supplier.phone || "—"}</td>
                        <td className="trans-chap-stock-table__wrap">{supplier.city || "—"}</td>
                        <td className="trans-chap-stock-table__mono">
                          {supplier.pin_number || "—"}
                        </td>
                        <td className="trans-chap-stock-table__strong">
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Balance owed</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                allowOutstandingAdjustment
                                  ? (balanceDrafts[supplier.id] ?? String(supplier.balance ?? 0))
                                  : bal > 0
                                    ? formatKsh(bal)
                                    : bal < 0
                                      ? `Advance ${formatKsh(Math.abs(bal))}`
                                      : "—"
                              }
                              disabled={!allowOutstandingAdjustment || savingBalanceId === supplier.id}
                              aria-label={`Balance owed for ${supplier.name}`}
                              onChange={(event) => {
                                const value = event.target.value;
                                setBalanceDrafts((prev) => ({ ...prev, [supplier.id]: value }));
                              }}
                              onBlur={() => void saveTableBalance(supplier)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setBalanceDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[supplier.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        </td>
                        <td>
                          {supplier.balance_due_date && bal > 0 ? (
                            <div className="trans-chap-stock-table__due">
                              <span>{formatDueDate(supplier.balance_due_date)}</span>
                              {due ? (
                                <em className={`trans-chap-panel__badge is-${due.tone}`}>
                                  {due.label}
                                </em>
                              ) : null}
                            </div>
                          ) : (
                            <span className="trans-chap-stock-table__muted">—</span>
                          )}
                        </td>
                        <td className="trans-chap-stock-table__actions">
                          <div className="trans-chap-stock-table__actions-inner">
                            <Link
                              href={`/trans-chap/purchases/new?supplier=${encodeURIComponent(supplier.name)}`}
                              className="trans-chap-panel__link"
                            >
                              Receive goods
                            </Link>
                            <button
                              type="button"
                              className="trans-chap-panel__link"
                              aria-expanded={open}
                              aria-controls={`${panelId}-edit`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(supplier);
                              }}
                            >
                              {open ? "Close" : "View"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="trans-chap-stock-table__detail">
                          <td colSpan={7} id={`${panelId}-edit`}>
                            {renderSupplierDetail(supplier, panelId)}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <MotionList className="trans-chap-sales__list" as="div">
          {filtered.map((supplier) => {
            const open = openId === supplier.id;
            const panelId = `${listId}-${supplier.id}`;
            const badge = balanceBadge(supplier);
            const owes = Number(supplier.balance || 0) > 0;

            return (
              <MotionItem key={supplier.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  imageUrl={null}
                  tone={owes ? "credit" : "sale"}
                  title={supplier.name}
                  subtitle={supplier.phone ?? "No phone"}
                  badge={badge}
                  onToggle={() => toggle(supplier)}
                >
                  {renderSupplierDetail(supplier, panelId)}
                </TransChapPanel>
              </MotionItem>
            );
          })}
        </MotionList>
      )}

      <TransChapFab
        label="Suppliers"
        options={[
          {
            label: "Add supplier",
            icon: "fa-truck-field",
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

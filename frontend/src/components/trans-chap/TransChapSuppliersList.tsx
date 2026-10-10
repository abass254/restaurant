"use client";

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
import { apiFetch } from "@/lib/api";
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
  ShopSupplier,
  ShopSupplierMutationResponse,
  SupplierImportResponse,
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
  balance_due_date: string;
  notes: string;
};

type View = "list" | "create" | "import";
type SupplierLayoutView = "grid" | "list";

const SUPPLIERS_VIEW_KEY = "trans-chap-suppliers-view";

function readSuppliersView(): SupplierLayoutView {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(SUPPLIERS_VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
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
  balance_due_date: "",
  notes: "",
};

type BalanceTone = "ok" | "wait" | "fail" | "credit";

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
  if (bal < 0) return { label: `Advance ${formatKsh(Math.abs(bal))}`, tone: "ok" };
  if (bal === 0) return { label: "Supplier", tone: "ok" };
  const due = dueStatus(supplier);
  if (due) return { label: `Owes ${formatKsh(bal)} · ${due.label}`, tone: due.tone === "ok" ? "credit" : due.tone };
  return { label: `Owes ${formatKsh(bal)}`, tone: "credit" };
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
    balance_due_date: supplier.balance_due_date ?? "",
    notes: supplier.notes ?? "",
  };
}

export function TransChapSuppliersList() {
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("list");
  const [storedLayoutView, setLayoutView] = useState<SupplierLayoutView>("grid");
  const layoutView: SupplierLayoutView = useTransChapIsPhone() ? "grid" : storedLayoutView;

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

  const [suppliers, setSuppliers] = useState<ShopSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SupplierForm>(EMPTY_FORM);
  const [createForm, setCreateForm] = useState<SupplierForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ContactImportMode>("merge");
  const [importing, setImporting] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<"xlsx" | "csv" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<SupplierImportResponse | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchShopSuppliers();
      setSuppliers(rows);
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
    if (!needle) return suppliers;
    return suppliers.filter((row) =>
      [
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
        .includes(needle),
    );
  }, [suppliers, query]);

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

  function toggle(supplier: ShopSupplier) {
    const open = openId === supplier.id;
    setOpenId(open ? null : supplier.id);
    if (!open) setEditForm(formFromSupplier(supplier));
  }

  function payloadFromForm(form: SupplierForm) {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) throw new Error("Enter the supplier's name.");
    if (!phone) throw new Error("Enter a phone number.");
    const balanceRaw = form.balance.trim().replace(/,/g, "");
    const balanceNum = balanceRaw ? Number(balanceRaw) : 0;
    return {
      name,
      phone,
      pin_number: form.pin_number.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      postal_code: form.postal_code.trim() || null,
      fax: form.fax.trim() || null,
      balance: Number.isFinite(balanceNum) ? balanceNum : 0,
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
      await toastSuccess("Supplier updated");
    } catch (err) {
      await showError("Could not update supplier", extractErrorMessage(err));
    } finally {
      setSaving(false);
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
        <p className="trans-chap-sales__empty">No suppliers match this search.</p>
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
                      <tr className={open ? "is-picked" : ""}>
                        <td className="trans-chap-stock-table__product">{supplier.name}</td>
                        <td className="trans-chap-stock-table__mono">{supplier.phone || "—"}</td>
                        <td className="trans-chap-stock-table__wrap">{supplier.city || "—"}</td>
                        <td className="trans-chap-stock-table__mono">
                          {supplier.pin_number || "—"}
                        </td>
                        <td className="trans-chap-stock-table__strong">
                          {bal > 0 ? (
                            formatKsh(bal)
                          ) : bal < 0 ? (
                            <span className="trans-chap-stock-table__muted">
                              Advance {formatKsh(Math.abs(bal))}
                            </span>
                          ) : (
                            <span className="trans-chap-stock-table__muted">—</span>
                          )}
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
                            <button
                              type="button"
                              className="trans-chap-panel__link"
                              aria-expanded={open}
                              aria-controls={`${panelId}-edit`}
                              onClick={() => toggle(supplier)}
                            >
                              {open ? "Close" : "Edit"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="trans-chap-stock-table__detail">
                          <td colSpan={7} id={`${panelId}-edit`}>
                            {renderEditForm(supplier, panelId, true)}
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

            const subtitle = [
              supplier.phone,
              supplier.city ? supplier.city : null,
              supplier.pin_number ? `PIN: ${supplier.pin_number}` : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <MotionItem key={supplier.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  tone="sale"
                  title={supplier.name}
                  subtitle={subtitle}
                  badge={badge}
                  onToggle={() => toggle(supplier)}
                >
                  {renderEditForm(supplier, panelId, open)}
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

"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
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
import { fetchShopSuppliers } from "@/lib/trans-chap-suppliers";
import type {
  ShopSupplier,
  ShopSupplierMutationResponse,
  SupplierImportResponse,
} from "@/lib/types";

type SupplierForm = {
  name: string;
  phone: string;
  notes: string;
};

type View = "list" | "create" | "import";

const EMPTY_FORM: SupplierForm = {
  name: "",
  phone: "",
  notes: "",
};

function formFromSupplier(supplier: ShopSupplier): SupplierForm {
  return {
    name: supplier.name,
    phone: supplier.phone,
    notes: supplier.notes ?? "",
  };
}

export function TransChapSuppliersList() {
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("list");
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
  const [importing, setImporting] = useState(false);
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
      [row.name, row.phone, row.notes ?? ""].join(" ").toLowerCase().includes(needle),
    );
  }, [suppliers, query]);

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
    return {
      name,
      phone,
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
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await apiFetch<SupplierImportResponse>(apiRoutes.suppliersImport, {
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
            <label htmlFor="trans-chap-supplier-name">Name</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-name"
                required
                autoComplete="organization"
                className="auth-split__input"
                placeholder="Supplier name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-phone">Phone</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-phone"
                required
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                className="auth-split__input"
                placeholder="2547…"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="trans-chap-supplier-notes">Notes (optional)</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-supplier-notes"
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
            {saving ? "Saving…" : "Save supplier"}
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
          Upload an <strong>.xlsx</strong> with <code>Name</code>, <code>Phone</code>, and
          optional <code>Notes</code>. Matching uses phone — existing suppliers are updated.
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
            {importing ? "Importing…" : "Import suppliers"}
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

  return (
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__filters">
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search suppliers…"
            aria-label="Search suppliers"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="trans-chap-sales__list" aria-busy="true" aria-label="Loading suppliers">
          <TransChapListSkeleton />
        </div>
      ) : error && suppliers.length === 0 ? (
        <TransChapStatus tone="error">{error}</TransChapStatus>
      ) : suppliers.length === 0 ? (
        <TransChapStatus>
          No suppliers yet. Tap + to add people you buy from, or import from Excel.
        </TransChapStatus>
      ) : filtered.length === 0 ? (
        <p className="trans-chap-sales__empty">No names match this search.</p>
      ) : (
        <MotionList className="trans-chap-sales__list" as="div">
          {filtered.map((supplier) => {
            const open = openId === supplier.id;
            const panelId = `${listId}-${supplier.id}`;
            return (
              <MotionItem key={supplier.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  tone="sale"
                  title={supplier.name}
                  subtitle={supplier.phone}
                  badge={{ label: "Supplier", tone: "ok" }}
                  onToggle={() => toggle(supplier)}
                >
                  <form
                    className="trans-chap-form__block"
                    onSubmit={(event) => void handleEdit(event, supplier)}
                  >
                    <p className="trans-chap-form__block-title">Details</p>
                    <div className="auth-split__field">
                      <label htmlFor={`${panelId}-name`}>Name</label>
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
                      <label htmlFor={`${panelId}-phone`}>Phone</label>
                      <div className="trans-chap-input">
                        <input
                          id={`${panelId}-phone`}
                          required
                          type="tel"
                          className="auth-split__input"
                          value={open ? editForm.phone : supplier.phone}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, phone: e.target.value }))
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
            label: "Import Excel",
            icon: "fa-file-excel",
            onClick: openImport,
          },
        ]}
      />
    </div>
  );
}

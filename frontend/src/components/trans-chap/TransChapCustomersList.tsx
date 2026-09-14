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
import { fetchShopCustomers } from "@/lib/trans-chap-customers";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type {
  CustomerImportResponse,
  ShopCustomer,
  ShopCustomerMutationResponse,
} from "@/lib/types";

type CustomerForm = {
  name: string;
  phone: string;
  credit_limit: string;
  notes: string;
};

type View = "list" | "create" | "import";

const EMPTY_FORM: CustomerForm = {
  name: "",
  phone: "",
  credit_limit: "0",
  notes: "",
};

function parseCreditLimit(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function formFromCustomer(customer: ShopCustomer): CustomerForm {
  return {
    name: customer.name,
    phone: customer.phone,
    credit_limit: String(customer.credit_limit ?? 0),
    notes: customer.notes ?? "",
  };
}

function badgeFor(customer: ShopCustomer): { label: string; tone: "ok" | "credit" | "wait" } {
  if (customer.outstanding_balance > 0) {
    return { label: formatKsh(customer.outstanding_balance), tone: "credit" };
  }
  if (customer.credit_limit > 0) {
    return { label: `Limit ${formatKsh(customer.credit_limit)}`, tone: "ok" };
  }
  return { label: "No tab", tone: "wait" };
}

export function TransChapCustomersList() {
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("list");
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CustomerForm>(EMPTY_FORM);
  const [createForm, setCreateForm] = useState<CustomerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CustomerImportResponse | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchShopCustomers();
      setCustomers(rows);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load customers."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((row) =>
      [row.name, row.phone, row.notes ?? ""].join(" ").toLowerCase().includes(needle),
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
    if (!open) setEditForm(formFromCustomer(customer));
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
    return {
      name,
      phone,
      credit_limit: creditLimit,
      notes: form.notes.trim() || null,
      email: null,
      address: null,
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
      setEditForm(formFromCustomer(res.data));
      await toastSuccess("Customer saved");
    } catch (err) {
      await showError("Could not save customer", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(event: FormEvent, customer: ShopCustomer) {
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
      const res = await apiFetch<ShopCustomerMutationResponse>(
        apiRoutes.customerUpdate(customer.id),
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      setCustomers((prev) =>
        prev
          .map((row) => (row.id === res.data.id ? res.data : row))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditForm(formFromCustomer(res.data));
      await toastSuccess("Customer updated");
    } catch (err) {
      await showError("Could not update customer", extractErrorMessage(err));
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
            <label htmlFor="trans-chap-customer-phone">Phone</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-phone"
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
            <label htmlFor="trans-chap-customer-limit">Credit limit</label>
            <div className="trans-chap-input">
              <input
                id="trans-chap-customer-limit"
                type="text"
                inputMode="numeric"
                className="auth-split__input"
                placeholder="0"
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
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__filters">
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
            return (
              <MotionItem key={customer.id} as="div">
                <TransChapPanel
                  id={panelId}
                  open={open}
                  tone={customer.outstanding_balance > 0 ? "credit" : "sale"}
                  title={customer.name}
                  subtitle={customer.phone}
                  badge={badge}
                  onToggle={() => toggle(customer)}
                >
                  <form
                    className="trans-chap-form__block"
                    onSubmit={(event) => void handleEdit(event, customer)}
                  >
                    <p className="trans-chap-form__block-title">Details</p>
                    <div className="auth-split__field">
                      <label htmlFor={`${panelId}-name`}>Name</label>
                      <div className="trans-chap-input">
                        <input
                          id={`${panelId}-name`}
                          required
                          className="auth-split__input"
                          value={open ? editForm.name : customer.name}
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
                          value={open ? editForm.phone : customer.phone}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, phone: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    <div className="auth-split__field">
                      <label htmlFor={`${panelId}-limit`}>Credit limit</label>
                      <div className="trans-chap-input">
                        <input
                          id={`${panelId}-limit`}
                          type="text"
                          inputMode="numeric"
                          className="auth-split__input"
                          value={open ? editForm.credit_limit : String(customer.credit_limit)}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, credit_limit: e.target.value }))
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
                          value={open ? editForm.notes : customer.notes ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, notes: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    {customer.outstanding_balance > 0 ? (
                      <dl className="trans-chap-panel__facts">
                        <div>
                          <dt>Owes</dt>
                          <dd>{formatKsh(customer.outstanding_balance)}</dd>
                        </div>
                        <div>
                          <dt>Available</dt>
                          <dd>{formatKsh(customer.available_credit)}</dd>
                        </div>
                      </dl>
                    ) : null}
                    <button
                      type="submit"
                      className="auth-split__btn"
                      disabled={saving}
                    >
                      {saving && openId === customer.id ? "Saving…" : "Save changes"}
                    </button>
                    {customer.outstanding_balance > 0 ? (
                      <Link href="/trans-chap/credit" className="trans-chap-form__secondary">
                        Collect on tab
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
                  </form>
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

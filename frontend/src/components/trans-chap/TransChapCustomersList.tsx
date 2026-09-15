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
  const user = useAuthUser();
  const shopName = user.active_account?.business_name || user.account?.business_name;
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("list");
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
                  <div className="trans-chap-form__block">
                    <dl className="trans-chap-panel__facts">
                      <div>
                        <dt>Credit limit</dt>
                        <dd>{formatKsh(customer.credit_limit)}</dd>
                      </div>
                      {customer.outstanding_balance > 0 ? (
                        <>
                          <div>
                            <dt>Owes</dt>
                            <dd>{formatKsh(customer.outstanding_balance)}</dd>
                          </div>
                          <div>
                            <dt>Available</dt>
                            <dd>{formatKsh(customer.available_credit)}</dd>
                          </div>
                        </>
                      ) : null}
                      {customer.notes ? (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <dt>Notes</dt>
                          <dd>{customer.notes}</dd>
                        </div>
                      ) : null}
                    </dl>

                    {customer.outstanding_balance > 0 ? (
                      <div className="trans-chap-credit__actions" style={{ marginBottom: "0.85rem" }}>
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
                    ) : null}

                    {customer.outstanding_balance > 0 ? (
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

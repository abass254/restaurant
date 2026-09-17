"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatMoney } from "@/lib/orders";
import type {
  ShopCustomer,
  ShopCustomerMutationResponse,
  ShopCustomersListResponse,
} from "@/lib/types";
import { MotionModal } from "@/components/app/MotionModal";
import { Skeleton } from "@/components/app/Skeleton";
import { ListLoadError } from "@/components/app/ListLoadError";
import { checkKenyanPhone } from "@/lib/phone-checker";

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  physical_location: string;
  credit_limit: string;
  notes: string;
};

const EMPTY_FORM: CustomerForm = {
  name: "",
  phone: "+254",
  email: "",
  address: "",
  physical_location: "",
  credit_limit: "1000",
  notes: "",
};

type WaVerifyState = "idle" | "checking" | "verified" | "unverified" | "error";

function customerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function parseCreditLimit(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function creditTone(customer: ShopCustomer): "ok" | "warn" | "off" {
  if (customer.credit_limit <= 0) return "off";
  if (customer.available_credit <= 0) return "warn";
  return "ok";
}

function creditPercent(customer: ShopCustomer): number {
  if (customer.credit_limit <= 0) return 0;
  const used = customer.credit_limit - customer.available_credit;
  return Math.min(100, Math.max(0, (used / customer.credit_limit) * 100));
}

function creditFillTone(pct: number): string {
  if (pct >= 90) return "danger";
  if (pct >= 60) return "warn";
  return "ok";
}

function formFromCustomer(customer: ShopCustomer): CustomerForm {
  const loc = customer.physical_location || customer.address || "";
  return {
    name: customer.name,
    phone: customer.phone,
    email: customer.email ?? "",
    address: loc,
    physical_location: loc,
    notes: customer.notes ?? "",
    credit_limit: String(customer.credit_limit ?? 1000),
  };
}

export default function CustomerPage() {
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CustomerForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShopCustomer | null>(null);
  const [editForm, setEditForm] = useState<CustomerForm>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await apiFetch<ShopCustomersListResponse>(apiRoutes.customers);
      setCustomers(res.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err, "Could not load customers."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((customer) =>
      [
        customer.name,
        customer.phone,
        customer.email ?? "",
        customer.physical_location ?? "",
        customer.address ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [customers, filterText]);

  // Summary stats
  const stats = useMemo(() => {
    const total = customers.length;
    const withCredit = customers.filter((c) => c.credit_limit > 0).length;
    const totalOutstanding = customers.reduce((sum, c) => sum + c.outstanding_balance, 0);
    const totalAvailable = customers.reduce((sum, c) => sum + c.available_credit, 0);
    return { total, withCredit, totalOutstanding, totalAvailable };
  }, [customers]);

  function closeCreate() {
    if (creating) return;
    setShowCreate(false);
    setCreateForm(EMPTY_FORM);
  }

  function openEdit(customer: ShopCustomer) {
    setEditing(customer);
    setEditForm(formFromCustomer(customer));
  }

  function closeEdit() {
    if (savingEdit) return;
    setEditing(null);
    setEditForm(EMPTY_FORM);
  }

  function payloadFromForm(form: CustomerForm) {
    const creditLimit = parseCreditLimit(form.credit_limit);
    if (creditLimit == null) {
      throw new Error("Enter a valid credit limit of 0 or more.");
    }
    const loc = form.physical_location.trim() || form.address.trim() || null;
    return {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      address: loc,
      physical_location: loc,
      credit_limit: creditLimit,
      notes: form.notes.trim() || null,
    };
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    let payload;
    try {
      payload = payloadFromForm(createForm);
    } catch (err) {
      await showError("Check credit limit", extractErrorMessage(err));
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch<ShopCustomerMutationResponse>(apiRoutes.customers, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCustomers((prev) =>
        [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      await toastSuccess("Customer saved");
    } catch (err) {
      await showError("Could not save customer", extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    let payload;
    try {
      payload = payloadFromForm(editForm);
    } catch (err) {
      await showError("Check credit limit", extractErrorMessage(err));
      return;
    }
    setSavingEdit(true);
    try {
      const res = await apiFetch<ShopCustomerMutationResponse>(
        apiRoutes.customerUpdate(editing.id),
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      setCustomers((prev) =>
        prev
          .map((row) => (row.id === editing.id ? res.data : row))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditing(null);
      setEditForm(EMPTY_FORM);
      await toastSuccess("Customer details saved");
    } catch (err) {
      await showError("Could not save customer", extractErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRemove(customer: ShopCustomer) {
    const ok = await confirmAction(
      "Remove customer?",
      `${customer.name} will be removed from this shop. This cannot be undone.`,
    );
    if (!ok) return;
    setRemovingId(customer.id);
    try {
      await apiFetch(apiRoutes.customer(customer.id), { method: "DELETE" });
      setCustomers((prev) => prev.filter((row) => row.id !== customer.id));
      await toastSuccess("Customer removed");
    } catch (err) {
      await showError("Could not remove customer", extractErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="app-panel inventory-panel customer-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Customers</h1>
          <p className="app-lead">
            Manage customer details, credit limits, and WhatsApp verification.
          </p>
        </div>
        <div className="inventory-header__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <i className="fa-solid fa-user-plus" aria-hidden="true" />
            Add customer
          </button>
        </div>
      </header>

      {/* Summary stat cards */}
      {loaded && customers.length > 0 ? (
        <div className="customer-stats-row">
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon">
              <i className="fa-solid fa-users" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">Total customers</div>
              <div className="customer-stat-card__value">{stats.total}</div>
            </div>
          </div>
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon customer-stat-card__icon--info">
              <i className="fa-solid fa-credit-card" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">With credit</div>
              <div className="customer-stat-card__value">{stats.withCredit}</div>
            </div>
          </div>
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon customer-stat-card__icon--warning">
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">Outstanding</div>
              <div className="customer-stat-card__value">{formatMoney(stats.totalOutstanding)}</div>
            </div>
          </div>
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon customer-stat-card__icon--success">
              <i className="fa-solid fa-wallet" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">Available credit</div>
              <div className="customer-stat-card__value">{formatMoney(stats.totalAvailable)}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Search toolbar */}
      <div className="customer-search-toolbar">
        <div className="customer-search-input">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name, phone, or email…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
        <span className="customer-search-count">
          {loaded ? `${filtered.length} of ${customers.length}` : "Loading…"}
        </span>
      </div>

      {/* Main content */}
      {!loaded ? (
        <Skeleton className="settings-skeleton" />
      ) : loadError && customers.length === 0 ? (
        <ListLoadError
          title="Could not load customers"
          message={loadError}
          onRetry={() => {
            setLoaded(false);
            void loadCustomers();
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="customer-empty-state">
          <div className="customer-empty-state__icon">
            <i className="fa-solid fa-address-book" aria-hidden="true" />
          </div>
          <h2>{customers.length === 0 ? "No customers yet" : "No matches"}</h2>
          <p>
            {customers.length === 0
              ? "Add a customer with their phone number and a credit limit to get started."
              : "Try a different name, phone, or email."}
          </p>
          {customers.length === 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
            >
              <i className="fa-solid fa-user-plus" aria-hidden="true" />
              Add your first customer
            </button>
          ) : null}
        </div>
      ) : (
        <div className="customer-card-list">
          {filtered.map((customer, index) => {
            const tone = creditTone(customer);
            const pct = creditPercent(customer);
            const fillTone = creditFillTone(pct);
            return (
              <div
                key={customer.id}
                className="customer-card"
                style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
              >
                {/* Identity */}
                <div className="customer-card__identity">
                  <div className="customer-card__avatar" aria-hidden="true">
                    {customerInitials(customer.name)}
                  </div>
                  <div className="customer-card__info">
                    <div className="customer-card__name">{customer.name}</div>
                    <div className="customer-card__phone-row">
                      <span>{customer.phone}</span>
                    </div>
                    {customer.email ? (
                      <div className="customer-card__email">{customer.email}</div>
                    ) : null}
                    {customer.physical_location || customer.address ? (
                      <div className="customer-card__address">
                        <i className="fa-solid fa-location-dot" aria-hidden="true" />{" "}
                        {customer.physical_location || customer.address}
                      </div>
                    ) : null}
                    {customer.date_to_pay ? (
                      <div className="customer-card__due-date">
                        <i className="fa-regular fa-calendar-check" aria-hidden="true" />{" "}
                        Pay date: <strong>{customer.date_to_pay}</strong>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Credit info */}
                <div className="customer-card__credit">
                  <div className="customer-card__credit-label">Credit</div>
                  <div className="customer-card__credit-amounts">
                    <span className="customer-card__credit-limit">
                      {formatMoney(customer.credit_limit)}
                    </span>
                    <span className={`customer-card__credit-available customer-card__credit-available--${tone}`}>
                      {tone === "off"
                        ? "No credit"
                        : `${formatMoney(customer.available_credit)} left`}
                    </span>
                  </div>
                  {customer.credit_limit > 0 ? (
                    <div className="customer-card__credit-bar">
                      <div
                        className={`customer-card__credit-fill customer-card__credit-fill--${fillTone}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="customer-card__actions">
                  <button
                    type="button"
                    className="customer-card__action-btn"
                    title="Edit customer"
                    onClick={() => openEdit(customer)}
                  >
                    <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="customer-card__action-btn customer-card__action-btn--danger"
                    title="Remove customer"
                    disabled={removingId === customer.id}
                    onClick={() => void handleRemove(customer)}
                  >
                    <i className="fa-solid fa-trash-can" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <MotionModal
        open={showCreate}
        onClose={closeCreate}
        ariaLabelledBy="customer-create-title"
        closeOnBackdrop={!creating}
        closeOnEscape={!creating}
      >
        <header className="inventory-modal__head">
          <h2 id="customer-create-title">Add customer</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={closeCreate}
            disabled={creating}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <CustomerFormFields
          form={createForm}
          setForm={setCreateForm}
          submitting={creating}
          submitLabel={creating ? "Saving…" : "Save customer"}
          onSubmit={(event) => void handleCreate(event)}
        />
      </MotionModal>

      {/* Edit modal */}
      <MotionModal
        open={!!editing}
        onClose={closeEdit}
        ariaLabelledBy="customer-edit-title"
        closeOnBackdrop={!savingEdit}
        closeOnEscape={!savingEdit}
      >
        {editing ? (
          <>
            <header className="inventory-modal__head">
              <h2 id="customer-edit-title">Edit {editing.name}</h2>
              <button
                type="button"
                className="fb-icon-btn"
                aria-label="Close"
                onClick={closeEdit}
                disabled={savingEdit}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </header>
            <CustomerFormFields
              form={editForm}
              setForm={setEditForm}
              submitting={savingEdit}
              submitLabel={savingEdit ? "Saving…" : "Save changes"}
              onSubmit={(event) => void handleEdit(event)}
            />
          </>
        ) : null}
      </MotionModal>
    </section>
  );
}

function CustomerFormFields({
  form,
  setForm,
  submitting,
  submitLabel,
  onSubmit,
}: {
  form: CustomerForm;
  setForm: Dispatch<SetStateAction<CustomerForm>>;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (event: FormEvent) => void;
}) {
  const [waState, setWaState] = useState<WaVerifyState>("idle");
  const [waMessage, setWaMessage] = useState("");

  const phoneCheck = useMemo(() => checkKenyanPhone(form.phone), [form.phone]);

  async function verifyWhatsApp() {
    const phone = form.phone.trim();
    if (!phone || phone.length < 7) {
      setWaState("error");
      setWaMessage("Enter a valid phone number first.");
      return;
    }
    setWaState("checking");
    setWaMessage("");
    try {
      const res = await apiFetch<{ verified: boolean; message: string }>(
        apiRoutes.customerVerifyWhatsApp,
        {
          method: "POST",
          body: JSON.stringify({ phone }),
        },
      );
      if (res.verified) {
        setWaState("verified");
        setWaMessage(res.message || "This number is on WhatsApp.");
      } else {
        setWaState("unverified");
        setWaMessage(res.message || "This number is not on WhatsApp.");
      }
    } catch (err) {
      setWaState("error");
      setWaMessage(extractErrorMessage(err, "Could not verify number."));
    }
  }

  // Reset WA state when phone changes
  useEffect(() => {
    if (waState !== "idle") {
      setWaState("idle");
      setWaMessage("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone]);

  return (
    <form
      className="settings-form settings-form--compact staff-modal-form"
      onSubmit={onSubmit}
    >
      <div className="inventory-modal__body">
        <label className="settings-field">
          <span>Name</span>
          <input
            required
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder="Amina Wanjiku"
            disabled={submitting}
          />
        </label>

        <div className="wa-verify-row">
          <label className="settings-field">
            <span>Phone number</span>
            <input
              required
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) =>
                setForm((current) => ({ ...current, phone: e.target.value }))
              }
              placeholder="+254 712 345 678"
              disabled={submitting}
            />
          </label>
          <button
            type="button"
            className="wa-verify-btn"
            disabled={submitting || waState === "checking" || !form.phone.trim()}
            onClick={() => void verifyWhatsApp()}
            title="Check if this number is on WhatsApp"
          >
            <i className="fa-brands fa-whatsapp" aria-hidden="true" />
            {waState === "checking" ? "Checking…" : "Verify"}
          </button>
        </div>

        {/* Real-time Phone Number Checker & Carrier Badge */}
        <div className={`phone-checker-row phone-checker-row--${phoneCheck.status}`}>
          <div className="phone-checker-info">
            <i
              className={`fa-solid ${
                phoneCheck.status === "valid"
                  ? "fa-circle-check"
                  : phoneCheck.status === "invalid"
                  ? "fa-circle-exclamation"
                  : "fa-circle-info"
              }`}
              aria-hidden="true"
            />
            <span>{phoneCheck.message}</span>
          </div>
          {phoneCheck.network ? (
            <span className="phone-carrier-tag">{phoneCheck.network}</span>
          ) : null}
        </div>

        {/* WhatsApp verification result */}
        {waState === "verified" ? (
          <div className="wa-verify-result wa-verify-result--verified">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            {waMessage}
          </div>
        ) : waState === "unverified" ? (
          <div className="wa-verify-result wa-verify-result--unverified">
            <i className="fa-solid fa-circle-xmark" aria-hidden="true" />
            {waMessage}
          </div>
        ) : waState === "error" ? (
          <div className="wa-verify-result wa-verify-result--unverified">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            {waMessage}
          </div>
        ) : null}

        <label className="settings-field">
          <span>Physical location</span>
          <input
            value={form.physical_location}
            onChange={(e) =>
              setForm((current) => ({
                ...current,
                physical_location: e.target.value,
                address: e.target.value,
              }))
            }
            placeholder="e.g. Stall B12, Nairobi CBD or Muthurwa Market"
            disabled={submitting}
          />
          <em className="settings-muted">
            Customer physical shop, stall, or delivery drop-off point.
          </em>
        </label>

        <label className="settings-field">
          <span>Credit limit (KES)</span>
          <input
            required
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={form.credit_limit}
            onChange={(e) =>
              setForm((current) => ({ ...current, credit_limit: e.target.value }))
            }
            disabled={submitting}
          />
          <em className="settings-muted">
            Maximum credit customer can take (defaults to KES 1,000). Use 0 for no credit.
          </em>
        </label>


        <label className="settings-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) =>
              setForm((current) => ({ ...current, email: e.target.value }))
            }
            placeholder="Optional"
            disabled={submitting}
          />
        </label>

        <label className="settings-field">
          <span>Notes</span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) =>
              setForm((current) => ({ ...current, notes: e.target.value }))
            }
            placeholder="Optional notes or references"
            disabled={submitting}
          />
        </label>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

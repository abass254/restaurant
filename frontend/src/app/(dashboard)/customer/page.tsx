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

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  credit_limit: string;
};

const EMPTY_FORM: CustomerForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  credit_limit: "0",
};

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

function formFromCustomer(customer: ShopCustomer): CustomerForm {
  return {
    name: customer.name,
    phone: customer.phone,
    email: customer.email ?? "",
    address: customer.address ?? "",
    notes: customer.notes ?? "",
    credit_limit: String(customer.credit_limit ?? 0),
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
        customer.address ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [customers, filterText]);

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
    return {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      credit_limit: creditLimit,
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
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Customers</h1>
          <p className="app-lead">
            Save customer details and set how much credit each person can use.
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

      <div className="inventory-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name, phone, or email…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
        <span className="app-muted">
          {loaded ? `${filtered.length} of ${customers.length}` : "Loading…"}
        </span>
      </div>

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
        <div className="inventory-empty">
          <i className="fa-solid fa-address-book" aria-hidden="true" />
          <h2>{customers.length === 0 ? "No customers yet" : "No matches"}</h2>
          <p>
            {customers.length === 0
              ? "Add a customer with their phone number and a credit limit."
              : "Try a different name, phone, or email."}
          </p>
          {customers.length === 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
            >
              <i className="fa-solid fa-user-plus" aria-hidden="true" />
              Add customer
            </button>
          ) : null}
        </div>
      ) : (
        <div className="inventory-table-wrap">
          <table className="inventory-table customers-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th className="customers-col-hide-sm">Email</th>
                <th className="customers-col-money">Credit limit</th>
                <th className="customers-col-money">Available</th>
                <th className="customers-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="customers-name">
                      <span className="customers-avatar" aria-hidden="true">
                        {customerInitials(customer.name)}
                      </span>
                      <span className="inventory-cell-product">
                        <strong>{customer.name}</strong>
                        {customer.address ? (
                          <span className="app-muted">{customer.address}</span>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td>{customer.phone}</td>
                  <td className="customers-col-hide-sm">
                    {customer.email || <span className="app-muted">—</span>}
                  </td>
                  <td className="customers-col-money">
                    {formatMoney(customer.credit_limit)}
                  </td>
                  <td className="customers-col-money">
                    <span
                      className={`settings-pill settings-pill--${creditTone(customer)}`}
                    >
                      {customer.credit_limit <= 0
                        ? "No credit"
                        : formatMoney(customer.available_credit)}
                    </span>
                  </td>
                  <td className="customers-col-actions">
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEdit(customer)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm orders-danger"
                        disabled={removingId === customer.id}
                        onClick={() => void handleRemove(customer)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
        <div className="settings-form__row">
          <label className="settings-field">
            <span>Phone</span>
            <input
              required
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) =>
                setForm((current) => ({ ...current, phone: e.target.value }))
              }
              placeholder="0712 345 678"
              disabled={submitting}
            />
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
        </div>
        <label className="settings-field">
          <span>Address</span>
          <input
            value={form.address}
            onChange={(e) =>
              setForm((current) => ({ ...current, address: e.target.value }))
            }
            placeholder="Optional delivery or shop address"
            disabled={submitting}
          />
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
            How much this customer can buy on account. Use 0 for no credit.
          </em>
        </label>
        <label className="settings-field">
          <span>Notes</span>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) =>
              setForm((current) => ({ ...current, notes: e.target.value }))
            }
            placeholder="Optional"
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

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
import type {
  ShopSupplier,
  ShopSupplierMutationResponse,
  ShopSuppliersListResponse,
} from "@/lib/types";
import { MotionModal } from "@/components/app/MotionModal";
import { Skeleton } from "@/components/app/Skeleton";
import { ListLoadError } from "@/components/app/ListLoadError";

type SupplierForm = {
  name: string;
  phone: string;
  notes: string;
};

const EMPTY_FORM: SupplierForm = {
  name: "",
  phone: "",
  notes: "",
};

function supplierInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function formFromSupplier(supplier: ShopSupplier): SupplierForm {
  return {
    name: supplier.name,
    phone: supplier.phone,
    notes: supplier.notes ?? "",
  };
}

/** Format a date string as a relative "X ago" or short date. */
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-KE", { month: "short", day: "numeric", year: "numeric" });
}

export default function SupplierPage() {
  const [suppliers, setSuppliers] = useState<ShopSupplier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<SupplierForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShopSupplier | null>(null);
  const [editForm, setEditForm] = useState<SupplierForm>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await apiFetch<ShopSuppliersListResponse>(apiRoutes.suppliers);
      setSuppliers(res.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err, "Could not load suppliers."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((supplier) =>
      [supplier.name, supplier.phone, supplier.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [suppliers, filterText]);

  // Summary stats
  const stats = useMemo(() => {
    const total = suppliers.length;
    const withNotes = suppliers.filter((s) => s.notes && s.notes.trim()).length;
    const recentlyAdded = suppliers.filter((s) => {
      if (!s.created_at) return false;
      const diff = Date.now() - new Date(s.created_at).getTime();
      return diff < 30 * 24 * 60 * 60 * 1000; // 30 days
    }).length;
    return { total, withNotes, recentlyAdded };
  }, [suppliers]);

  function closeCreate() {
    if (creating) return;
    setShowCreate(false);
    setCreateForm(EMPTY_FORM);
  }

  function openEdit(supplier: ShopSupplier) {
    setEditing(supplier);
    setEditForm(formFromSupplier(supplier));
  }

  function closeEdit() {
    if (savingEdit) return;
    setEditing(null);
    setEditForm(EMPTY_FORM);
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
    setCreating(true);
    try {
      const res = await apiFetch<ShopSupplierMutationResponse>(apiRoutes.suppliers, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSuppliers((prev) =>
        [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      await toastSuccess("Supplier saved");
    } catch (err) {
      await showError("Could not save supplier", extractErrorMessage(err));
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
      await showError("Check details", extractErrorMessage(err));
      return;
    }
    setSavingEdit(true);
    try {
      const res = await apiFetch<ShopSupplierMutationResponse>(
        apiRoutes.supplierUpdate(editing.id),
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
      setEditing(null);
      setEditForm(EMPTY_FORM);
      await toastSuccess("Supplier updated");
    } catch (err) {
      await showError("Could not update supplier", extractErrorMessage(err));
    } finally {
      setSavingEdit(false);
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
      if (editing?.id === supplier.id) closeEdit();
      await toastSuccess("Supplier removed");
    } catch (err) {
      await showError("Could not remove supplier", extractErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="app-panel inventory-panel customer-panel supplier-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Suppliers</h1>
          <p className="app-lead">
            Vendors and wholesalers you buy stock from.
          </p>
        </div>
        <div className="inventory-header__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <i className="fa-solid fa-truck-field" aria-hidden="true" />
            Add supplier
          </button>
        </div>
      </header>

      {/* Summary stat cards */}
      {loaded && suppliers.length > 0 ? (
        <div className="customer-stats-row">
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon">
              <i className="fa-solid fa-truck" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">Total suppliers</div>
              <div className="customer-stat-card__value">{stats.total}</div>
            </div>
          </div>
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon customer-stat-card__icon--info">
              <i className="fa-solid fa-sticky-note" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">With notes</div>
              <div className="customer-stat-card__value">{stats.withNotes}</div>
            </div>
          </div>
          <div className="customer-stat-card">
            <div className="customer-stat-card__icon customer-stat-card__icon--success">
              <i className="fa-solid fa-calendar-plus" aria-hidden="true" />
            </div>
            <div className="customer-stat-card__body">
              <div className="customer-stat-card__label">Added (30 days)</div>
              <div className="customer-stat-card__value">{stats.recentlyAdded}</div>
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
            placeholder="Search by name, phone, or notes…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
        <span className="customer-search-count">
          {loaded ? `${filtered.length} of ${suppliers.length}` : "Loading…"}
        </span>
      </div>

      {/* Main content */}
      {!loaded ? (
        <Skeleton className="settings-skeleton" />
      ) : loadError && suppliers.length === 0 ? (
        <ListLoadError
          title="Could not load suppliers"
          message={loadError}
          onRetry={() => {
            setLoaded(false);
            void loadSuppliers();
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="customer-empty-state">
          <div className="customer-empty-state__icon">
            <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
          </div>
          <h2>{suppliers.length === 0 ? "No suppliers yet" : "No matches"}</h2>
          <p>
            {suppliers.length === 0
              ? "Add the people you buy stock from so purchases stay organised."
              : "Try a different name, phone, or notes search."}
          </p>
          {suppliers.length === 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
            >
              <i className="fa-solid fa-truck-field" aria-hidden="true" />
              Add your first supplier
            </button>
          ) : null}
        </div>
      ) : (
        <div className="customer-card-list">
          {filtered.map((supplier, index) => (
            <div
              key={supplier.id}
              className="customer-card supplier-card"
              style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
            >
              {/* Identity */}
              <div className="customer-card__identity">
                <div className="customer-card__avatar supplier-card__avatar" aria-hidden="true">
                  {supplierInitials(supplier.name)}
                </div>
                <div className="customer-card__info">
                  <div className="customer-card__name">{supplier.name}</div>
                  <div className="customer-card__phone-row">
                    <i className="fa-solid fa-phone" aria-hidden="true" style={{ fontSize: "0.65rem", opacity: 0.5 }} />
                    <span>{supplier.phone}</span>
                  </div>
                  {supplier.notes ? (
                    <div className="customer-card__address">
                      <i className="fa-solid fa-note-sticky" aria-hidden="true" />{" "}
                      {supplier.notes}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Timestamp info */}
              <div className="supplier-card__meta">
                <div className="supplier-card__meta-label">Added</div>
                <div className="supplier-card__meta-value">{timeAgo(supplier.created_at)}</div>
                {supplier.updated_at && supplier.updated_at !== supplier.created_at ? (
                  <>
                    <div className="supplier-card__meta-label">Updated</div>
                    <div className="supplier-card__meta-value">{timeAgo(supplier.updated_at)}</div>
                  </>
                ) : null}
              </div>

              {/* Actions */}
              <div className="customer-card__actions">
                <button
                  type="button"
                  className="customer-card__action-btn"
                  title="Edit supplier"
                  onClick={() => openEdit(supplier)}
                >
                  <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="customer-card__action-btn customer-card__action-btn--danger"
                  title="Remove supplier"
                  disabled={removingId === supplier.id}
                  onClick={() => void removeSupplier(supplier)}
                >
                  <i className="fa-solid fa-trash-can" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <MotionModal
        open={showCreate}
        onClose={closeCreate}
        ariaLabelledBy="supplier-create-title"
        closeOnBackdrop={!creating}
        closeOnEscape={!creating}
      >
        <header className="inventory-modal__head">
          <h2 id="supplier-create-title">Add supplier</h2>
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
        <SupplierFormFields
          form={createForm}
          setForm={setCreateForm}
          submitting={creating}
          submitLabel={creating ? "Saving…" : "Save supplier"}
          onSubmit={(e) => void handleCreate(e)}
        />
      </MotionModal>

      {/* Edit modal */}
      <MotionModal
        open={!!editing}
        onClose={closeEdit}
        ariaLabelledBy="supplier-edit-title"
        closeOnBackdrop={!savingEdit}
        closeOnEscape={!savingEdit}
      >
        {editing ? (
          <>
            <header className="inventory-modal__head">
              <h2 id="supplier-edit-title">Edit {editing.name}</h2>
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
            <SupplierFormFields
              form={editForm}
              setForm={setEditForm}
              submitting={savingEdit}
              submitLabel={savingEdit ? "Saving…" : "Save changes"}
              onSubmit={(e) => void handleEdit(e)}
            />
          </>
        ) : null}
      </MotionModal>
    </section>
  );
}

function SupplierFormFields({
  form,
  setForm,
  submitting,
  submitLabel,
  onSubmit,
}: {
  form: SupplierForm;
  setForm: Dispatch<SetStateAction<SupplierForm>>;
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
            autoComplete="organization"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="ABC Wholesalers"
            disabled={submitting}
          />
        </label>
        <label className="settings-field">
          <span>Phone</span>
          <input
            required
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="0712 345 678"
            disabled={submitting}
          />
        </label>
        <label className="settings-field">
          <span>Notes</span>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Delivery schedule, payment terms, etc."
            disabled={submitting}
          />
          <em className="settings-muted">
            Optional — remind yourself about delivery days, payment terms, etc.
          </em>
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

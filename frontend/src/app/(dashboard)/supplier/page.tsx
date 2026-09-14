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
    <div className="app-page customers-page">
      <header className="app-page__head customers-head">
        <div>
          <h1>Suppliers</h1>
          <p className="app-muted">Vendors and wholesalers you buy stock from.</p>
        </div>
        <div className="customers-head__actions">
          <label className="customers-search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input
              type="search"
              value={filterText}
              placeholder="Search suppliers…"
              aria-label="Search suppliers"
              onChange={(e) => setFilterText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            Add supplier
          </button>
        </div>
      </header>

      <p className="app-muted customers-count">
        {loaded ? `${filtered.length} of ${suppliers.length}` : "Loading…"}
      </p>

      {!loaded ? (
        <Skeleton height={220} />
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
        <div className="customers-empty">
          <h2>{suppliers.length === 0 ? "No suppliers yet" : "No matches"}</h2>
          <p className="app-muted">
            {suppliers.length === 0
              ? "Add the people you buy stock from so purchases stay organised."
              : "Try a different search."}
          </p>
          {suppliers.length === 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
            >
              Add supplier
            </button>
          ) : null}
        </div>
      ) : (
        <div className="customers-table-wrap">
          <table className="inventory-table customers-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th className="customers-col-hide-sm">Notes</th>
                <th className="customers-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <div className="customers-name">
                      <span className="customers-avatar" aria-hidden="true">
                        {supplierInitials(supplier.name)}
                      </span>
                      <strong>{supplier.name}</strong>
                    </div>
                  </td>
                  <td>{supplier.phone}</td>
                  <td className="customers-col-hide-sm">{supplier.notes || "—"}</td>
                  <td className="customers-col-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEdit(supplier)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={removingId === supplier.id}
                      onClick={() => void removeSupplier(supplier)}
                    >
                      {removingId === supplier.id ? "…" : "Remove"}
                    </button>
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
        ariaLabel="Add supplier"
      >
        <header className="inventory-modal__head">
          <h2>Add supplier</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={closeCreate}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <form className="inventory-modal__body" onSubmit={(e) => void handleCreate(e)}>
          <SupplierFields form={createForm} setForm={setCreateForm} idPrefix="create" />
          <div className="inventory-modal__actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeCreate}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>
              {creating ? "Saving…" : "Save supplier"}
            </button>
          </div>
        </form>
      </MotionModal>

      <MotionModal open={!!editing} onClose={closeEdit} ariaLabel="Edit supplier">
        <header className="inventory-modal__head">
          <h2>Edit supplier</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={closeEdit}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <form className="inventory-modal__body" onSubmit={(e) => void handleEdit(e)}>
          <SupplierFields form={editForm} setForm={setEditForm} idPrefix="edit" />
          <div className="inventory-modal__actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeEdit}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </MotionModal>
    </div>
  );
}

function SupplierFields({
  form,
  setForm,
  idPrefix,
}: {
  form: SupplierForm;
  setForm: Dispatch<SetStateAction<SupplierForm>>;
  idPrefix: string;
}) {
  return (
    <div className="inventory-form-grid">
      <label>
        <span>Name</span>
        <input
          id={`${idPrefix}-supplier-name`}
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label>
        <span>Phone</span>
        <input
          id={`${idPrefix}-supplier-phone`}
          required
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </label>
      <label className="inventory-form-grid__full">
        <span>Notes</span>
        <input
          id={`${idPrefix}-supplier-notes`}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </label>
    </div>
  );
}

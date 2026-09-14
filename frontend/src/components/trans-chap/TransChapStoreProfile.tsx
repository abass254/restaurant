"use client";

import {
  FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BusinessLocationSection } from "@/components/app/BusinessLocationSection";
import { useAuthRefresh, useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { showError, showInternalError, toastSuccess } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { categoriesForStoreType, STORE_TYPES, parseStoreType, storeTypeLabel } from "@/lib/onboarding";
import { userCanAccessSection } from "@/lib/merchant-permissions";

function shopInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function TransChapStoreProfile({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  const refreshUser = useAuthRefresh();
  const business = user.active_account ?? user.account;
  const canEdit = userCanAccessSection(user, "settings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputId = useId();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(business?.business_name ?? "");
  const [category, setCategory] = useState(business?.business_category ?? "");
  const [storeType, setStoreType] = useState(parseStoreType(business?.store_type));
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);

  useEffect(() => {
    setName(business?.business_name ?? "");
    setCategory(business?.business_category ?? "");
    setStoreType(parseStoreType(business?.store_type));
  }, [business?.business_name, business?.business_category, business?.store_type]);

  const shopName = business?.business_name?.trim() || "Your store";
  const logoUrl = business?.logo_url ? resolveAssetUrl(business.logo_url) : null;
  const location = business?.business_location?.trim() || "";
  const categoryOptions = Array.from(
    new Set([
      ...categoriesForStoreType(storeType),
      ...(business?.business_category ? [business.business_category] : []),
    ]),
  );

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !business) return;
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    if (!trimmedName) {
      await showError("Name required", "Enter your business name.");
      return;
    }
    if (!trimmedCategory) {
      await showError("Category required", "Choose a business category.");
      return;
    }

    setSavingProfile(true);
    try {
      await apiFetch(apiRoutes.settingsBusiness, {
        method: "PATCH",
        body: JSON.stringify({
          business_name: trimmedName,
          business_category: trimmedCategory,
          store_type: storeType,
        }),
      });
      await refreshUser();
      await toastSuccess("Store profile saved");
      setEditing(false);
    } catch {
      await showInternalError();
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogoUpload(file: File | null | undefined) {
    if (!file || !canEdit) return;
    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiFetch(apiRoutes.settingsLogo, {
        method: "POST",
        body: form,
      });
      await refreshUser();
      await toastSuccess("Store logo saved");
    } catch {
      await showInternalError();
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemoveLogo() {
    if (!canEdit) return;
    setRemovingLogo(true);
    try {
      await apiFetch(apiRoutes.settingsLogo, { method: "DELETE" });
      await refreshUser();
      await toastSuccess("Store logo removed");
    } catch {
      await showInternalError();
    } finally {
      setRemovingLogo(false);
    }
  }

  function cancelEdit() {
    setName(business?.business_name ?? "");
    setCategory(business?.business_category ?? "");
    setStoreType(parseStoreType(business?.store_type));
    setEditing(false);
  }

  if (!business) {
    return (
      <>
        <section className="trans-chap-store" aria-label="Store">
          <p className="trans-chap-sales__empty">No shop is linked to this account yet.</p>
        </section>
        {children}
      </>
    );
  }

  if (editing && canEdit) {
    return (
      <div className="trans-chap-reports__scroll">
        <section className="trans-chap-store trans-chap-store--edit" aria-label="Edit store">
          <div className="trans-chap-store__edit-head">
            <button type="button" className="trans-chap-store__back" onClick={cancelEdit}>
              <i className="fa-solid fa-chevron-left" aria-hidden />
              Reports
            </button>
            <h2>Store details</h2>
          </div>

          <div className="trans-chap-store__logo-editor">
            <div className="trans-chap-store__mark" aria-hidden={!logoUrl}>
              {logoUrl ? <img src={logoUrl} alt="" /> : <span>{shopInitials(shopName)}</span>}
            </div>
            <div className="trans-chap-store__logo-actions">
              <p>Square JPEG, PNG, WebP, or GIF. Max 5 MB.</p>
              <input
                ref={fileInputRef}
                id={logoInputId}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={uploadingLogo || removingLogo}
                onChange={(e) => void handleLogoUpload(e.target.files?.[0])}
              />
              <div className="trans-chap-store__btn-row">
                <button
                  type="button"
                  className="auth-split__btn"
                  disabled={uploadingLogo || removingLogo}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingLogo ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
                </button>
                {logoUrl ? (
                  <button
                    type="button"
                    className="trans-chap-form__secondary"
                    disabled={uploadingLogo || removingLogo}
                    onClick={() => void handleRemoveLogo()}
                  >
                    {removingLogo ? "Removing…" : "Remove"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <form className="trans-chap-store__form" onSubmit={(e) => void handleSaveProfile(e)}>
            <label className="auth-split__field">
              <span>Business name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                required
                autoComplete="organization"
              />
            </label>
            <label className="auth-split__field">
              <span>Store type</span>
              <select
                className="auth-split__input"
                value={storeType}
                onChange={(e) => {
                  const next = parseStoreType(e.target.value);
                  setStoreType(next);
                  const allowed = categoriesForStoreType(next);
                  if (!allowed.includes(category as (typeof allowed)[number])) {
                    setCategory(allowed[0]);
                  }
                }}
                required
              >
                {STORE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-split__field">
              <span>What you sell</span>
              <select
                className="auth-split__input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a category
                </option>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="auth-split__btn" disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </button>
          </form>

          <div className="trans-chap-store__location">
            <h3>Store location</h3>
            <BusinessLocationSection account={business} hideSignedInAs />
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      <section className="trans-chap-store" aria-label="Store">
        <div className="trans-chap-store__card">
          <div className="trans-chap-store__mark" aria-hidden={!logoUrl}>
            {logoUrl ? (
              <img src={logoUrl} alt={`${shopName} logo`} />
            ) : (
              <span>{shopInitials(shopName)}</span>
            )}
          </div>
          <div className="trans-chap-store__copy">
            <strong>{shopName}</strong>
            <span>{storeTypeLabel(business.store_type)}</span>
            {business.business_category ? <span>{business.business_category}</span> : null}
            {location ? (
              <span className="trans-chap-store__location-line">{location}</span>
            ) : canEdit ? (
              <span className="trans-chap-store__location-line is-muted">Add store location</span>
            ) : null}
          </div>
          {canEdit ? (
            <button
              type="button"
              className="trans-chap-store__edit"
              onClick={() => setEditing(true)}
              aria-label="Edit store details"
            >
              Edit
            </button>
          ) : null}
        </div>
      </section>
      {children}
    </>
  );
}

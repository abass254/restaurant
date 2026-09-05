"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { BusinessLocationSection } from "@/components/app/BusinessLocationSection";
import { PaymentTermsSection } from "@/components/app/PaymentTermsSection";
import { useAuthRefresh, useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { RETAIL_BUSINESS_CATEGORIES } from "@/lib/onboarding";

export default function BasicsPage() {
  const user = useAuthUser();
  const refreshUser = useAuthRefresh();
  const business = user.account;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(business?.business_name ?? "");
  const [category, setCategory] = useState(business?.business_category ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);

  useEffect(() => {
    setName(business?.business_name ?? "");
    setCategory(business?.business_category ?? "");
  }, [business?.business_name, business?.business_category]);

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();
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
        }),
      });
      await refreshUser();
      await toastSuccess("Business profile saved");
    } catch (err) {
      await showError("Could not save profile", extractErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogoUpload(file: File | null | undefined) {
    if (!file) return;
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
    } catch (err) {
      await showError("Could not upload logo", extractErrorMessage(err));
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleRemoveLogo() {
    setRemovingLogo(true);
    try {
      await apiFetch(apiRoutes.settingsLogo, { method: "DELETE" });
      await refreshUser();
      await toastSuccess("Store logo removed");
    } catch (err) {
      await showError("Could not remove logo", extractErrorMessage(err));
    } finally {
      setRemovingLogo(false);
    }
  }

  const logoUrl = business?.logo_url ? resolveAssetUrl(business.logo_url) : null;
  const categoryOptions = Array.from(
    new Set([
      ...RETAIL_BUSINESS_CATEGORIES,
      ...(business?.business_category ? [business.business_category] : []),
    ]),
  );

  return (
    <section className="settings-shell">
      <header className="settings-shell__header">
        <div>
          <h1 className="settings-shell__title">Basics</h1>
          <p className="settings-shell__lead">
            Update your store name, category, logo, location, and how DukAI
            pays you. Store location is optional until you connect the rider app.
          </p>
        </div>
      </header>

      <div className="settings-shell__content basics-page">
        <article className="settings-card">
          <header className="settings-card__head">
            <div className="settings-card__title">
              <i className="fa-solid fa-store settings-card__icon" aria-hidden="true" />
              <h2>Store profile</h2>
            </div>
          </header>
          <div className="settings-card__body">
            {!business ? (
              <p className="settings-muted">No shop is linked to this account yet.</p>
            ) : (
              <form
                className="settings-form settings-form--compact"
                onSubmit={(e) => void handleSaveProfile(e)}
              >
                <label className="settings-field">
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
                <label className="settings-field">
                  <span>Category</span>
                  <select
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
                <div className="settings-actions">
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={savingProfile}
                  >
                    {savingProfile ? "Saving…" : "Save profile"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </article>

        <article className="settings-card">
          <header className="settings-card__head">
            <div className="settings-card__title">
              <i className="fa-solid fa-image settings-card__icon" aria-hidden="true" />
              <h2>Store logo</h2>
            </div>
          </header>
          <div className="settings-card__body">
            {!business ? (
              <p className="settings-muted">Create a shop first to add a logo.</p>
            ) : (
              <div className="basics-logo">
                <div className="basics-logo__preview" aria-hidden={!logoUrl}>
                  {logoUrl ? (
                    <img src={logoUrl} alt={`${business.business_name} logo`} />
                  ) : (
                    <span className="basics-logo__placeholder">
                      <i className="fa-solid fa-store" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className="basics-logo__copy">
                  <p className="settings-muted">
                    Square JPEG, PNG, WebP, or GIF works best. Max 5 MB.
                  </p>
                  <div className="settings-actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      id="basics-logo-input"
                      disabled={uploadingLogo || removingLogo}
                      onChange={(e) => void handleLogoUpload(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={uploadingLogo || removingLogo}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingLogo
                        ? "Uploading…"
                        : logoUrl
                          ? "Replace logo"
                          : "Upload logo"}
                    </button>
                    {logoUrl ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={uploadingLogo || removingLogo}
                        onClick={() => void handleRemoveLogo()}
                      >
                        {removingLogo ? "Removing…" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className="settings-card">
          <header className="settings-card__head">
            <div className="settings-card__title">
              <i
                className="fa-solid fa-location-dot settings-card__icon"
                aria-hidden="true"
              />
              <h2>Store location</h2>
            </div>
          </header>
          <div className="settings-card__body">
            {business ? (
              <BusinessLocationSection account={business} />
            ) : (
              <p className="settings-muted">No shop location to edit yet.</p>
            )}
          </div>
        </article>

        <PaymentTermsSection />
      </div>
    </section>
  );
}

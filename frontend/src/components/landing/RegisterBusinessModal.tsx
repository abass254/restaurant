"use client";

import { FormEvent, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Swal from "sweetalert2";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";
import { RETAIL_BUSINESS_CATEGORIES } from "@/lib/onboarding";

type FormState = {
  business_name: string;
  business_location: string;
  business_category: string;
  admin_email: string;
  admin_phone: string;
  latitude: number | null;
  longitude: number | null;
};

const initialForm: FormState = {
  business_name: "",
  business_location: "",
  business_category: "",
  admin_email: "",
  admin_phone: "",
  latitude: null,
  longitude: null,
};

type TextFieldKey = "business_name" | "business_location" | "admin_email" | "admin_phone";

type TextField = {
  key: TextFieldKey;
  label: string;
  icon: string;
  type?: string;
  placeholder: string;
  autoFocus?: boolean;
};

const TEXT_FIELDS: TextField[] = [
  {
    key: "business_name",
    label: "Business name",
    icon: "fa-store",
    placeholder: "DukAI's Store",
    autoFocus: true,
  },
  {
    key: "business_location",
    label: "Business location",
    icon: "fa-location-dot",
    placeholder: "Westlands, Nairobi",
  },
  {
    key: "admin_email",
    label: "Admin email",
    icon: "fa-envelope",
    type: "email",
    placeholder: "admin@yourshop.co.ke",
  },
  {
    key: "admin_phone",
    label: "Admin phone",
    icon: "fa-phone",
    type: "tel",
    placeholder: "+254 712 345 678",
  },
];

type RegisterBusinessModalProps = {
  onClose: () => void;
};

export function RegisterBusinessModal({ onClose }: RegisterBusinessModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const { mapEnabled } = useGoogleMapsPublicConfig();

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLocationText(text: string) {
    setForm((current) => ({ ...current, business_location: text }));
  }

  function setCoords(coords: { lat: number; lng: number } | null) {
    setForm((current) => ({
      ...current,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    }));
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !submitting) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mapEnabled && (form.latitude == null || form.longitude == null)) {
      await showError(
        "Pin your shop location",
        "Search for your address or use Pin on map so we can save accurate coordinates.",
      );
      return;
    }
    setSubmitting(true);

    try {
      await apiFetch<{ message: string }>(apiRoutes.register, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(initialForm);
      onClose();
      const result = await Swal.fire({
        icon: "success",
        iconHtml: '<i class="fas fa-envelope" aria-hidden="true"></i>',
        title: "Welcome to DukAI!",
        html:
          '<div class="dukai-waitlist-swal">' +
          '<p>Your account has been created. Check your inbox for your ' +
          "login email with a temporary password.</p>" +
          '<p class="dukai-waitlist-swal__sub">' +
          "Sign in with the temporary password in your email, or use the " +
          "password setup link to choose your own." +
          "</p>" +
          "</div>",
        confirmButtonText: "Go to login",
        showCloseButton: true,
        customClass: {
          popup: "dukai-swal-popup dukai-waitlist-popup",
          title: "dukai-swal-title",
          htmlContainer: "dukai-swal-text",
          confirmButton: "dukai-swal-btn dukai-swal-btn--confirm",
          icon: "dukai-waitlist-icon",
        },
        buttonsStyling: false,
      });
      if (result.isConfirmed) {
        window.location.href = "/sign-in";
      }
    } catch (err) {
      await showError("Registration failed", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="waitlist-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="waitlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="waitlist-modal__close"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
        >
          <i className="fas fa-times" aria-hidden="true" />
        </button>

        <div className="waitlist-modal__top">
          <span className="waitlist-modal__icon" aria-hidden="true">
            <i className="fas fa-bell" />
          </span>
          <p className="waitlist-modal__eyebrow">
            <span className="waitlist-modal__dot" aria-hidden="true" />
            Joining Soon
          </p>
          <h2 id="waitlist-modal-title" className="waitlist-modal__title">
            Get Started Today!
          </h2>
          <p className="waitlist-modal__desc">
            Tell us about your shop. We&apos;ll reach out the moment we go live
            so you can connect Instagram, WhatsApp and M-Pesa from day one.
          </p>
        </div>

        <form
          className="waitlist-modal__form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          {TEXT_FIELDS.map((field) => {
            if (field.key === "business_location") {
              return (
                <AddressLocationField
                  key={field.key}
                  value={form.business_location}
                  onChange={setLocationText}
                  onCoordsChange={setCoords}
                  label="Business location"
                  placeholder="Search for your shop location"
                  required
                  variant="waitlist"
                  allowMapPin
                />
              );
            }
            return (
              <label key={field.key} className="waitlist-field">
                <span className="waitlist-field__label">{field.label}</span>
                <span className="waitlist-field__control">
                  <i className={`fas ${field.icon}`} aria-hidden="true" />
                  <input
                    type={field.type ?? "text"}
                    required
                    autoFocus={field.autoFocus}
                    value={form[field.key]}
                    onChange={(event) =>
                      updateField(field.key, event.target.value)
                    }
                    placeholder={field.placeholder}
                  />
                </span>
              </label>
            );
          })}

          <label className="waitlist-field">
            <span className="waitlist-field__label">Business category</span>
            <span className="waitlist-field__control waitlist-field__control--select">
              <i className="fas fa-tags" aria-hidden="true" />
              <select
                required
                value={form.business_category}
                onChange={(event) =>
                  updateField("business_category", event.target.value)
                }
              >
                <option value="">Select a category</option>
                {RETAIL_BUSINESS_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <i className="fas fa-chevron-down" aria-hidden="true" />
            </span>
          </label>

          <p className="waitlist-modal__fineprint">
            <i className="fas fa-lock" aria-hidden="true" />
            Your details stay private. We&apos;ll only use them to invite you at
            launch.
          </p>

          <div className="waitlist-modal__actions">
            <button
              type="submit"
              className="waitlist-modal__submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span
                    className="waitlist-modal__spinner"
                    aria-hidden="true"
                  />
                  Submitting&hellip;
                </>
              ) : (
                <>
                  <i className="fas fa-bell pr-2" aria-hidden="true" />
                  Get Started
                </>
              )}
            </button>
            <button
              type="button"
              className="waitlist-modal__cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

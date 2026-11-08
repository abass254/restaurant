"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { TransChapBrandHeader } from "@/components/trans-chap/TransChapAuth";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { RESTAURANT_BUSINESS_CATEGORIES } from "@/lib/onboarding";
import PasswordField from "@/app/sign-in/PasswordField";
import type { AuthUser } from "@/lib/types";

export default function RestaurantRegistrationPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<string>(RESTAURANT_BUSINESS_CATEGORIES[0]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiFetch<AuthUser>(apiRoutes.signup, {
        method: "POST",
        body: JSON.stringify({
          name: ownerName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || null,
          business_name: businessName.trim(),
          business_location: location.trim(),
          business_category: category,
          store_type: "restaurant",
        }),
      });
      setCreated(true);
    } catch (submitError) {
      setError(extractErrorMessage(submitError, "Could not create your restaurant account."));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <AuthShell
        className="auth-split--trans-chap"
        heroLabel="KITCHEN"
        brandHeader={<TransChapBrandHeader />}
      >
        <div className="auth-split__success-icon" aria-hidden="true">
          <i className="fas fa-check" />
        </div>
        <h1 className="auth-split__title">Your restaurant is registered</h1>
        <p className="auth-split__subtitle">
          Your TransChap restaurant account is ready. Sign in to set up your menu,
          stock, and register.
        </p>
        <button type="button" className="auth-split__btn" onClick={() => router.replace("/")}>
          Open TransChap
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      className="auth-split--trans-chap auth-split--restaurant-register"
      heroLabel="KITCHEN"
      brandHeader={<TransChapBrandHeader />}
    >
      <h1 className="auth-split__title">Register your restaurant</h1>
      <p className="auth-split__subtitle">
        Create your account and start managing your restaurant with TransChap.
      </p>

      {error ? (
        <p role="alert" className="auth-split__alert auth-split__alert--error">
          {error}
        </p>
      ) : null}

      <form className="auth-split__form" onSubmit={(event) => void onSubmit(event)}>
        <div className="auth-split__field">
          <label htmlFor="restaurant-business-name">Restaurant name</label>
          <input
            id="restaurant-business-name"
            required
            autoComplete="organization"
            className="auth-split__input"
            placeholder="e.g. Green Garden Cafe"
            value={businessName}
            disabled={busy}
            onChange={(event) => setBusinessName(event.target.value)}
          />
        </div>

        <div className="auth-split__field">
          <label htmlFor="restaurant-category">Restaurant type</label>
          <select
            id="restaurant-category"
            required
            className="auth-split__input"
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value)}
          >
            {RESTAURANT_BUSINESS_CATEGORIES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="auth-split__field">
          <label htmlFor="restaurant-owner-name">Your name</label>
          <input
            id="restaurant-owner-name"
            required
            autoComplete="name"
            className="auth-split__input"
            placeholder="Restaurant owner"
            value={ownerName}
            disabled={busy}
            onChange={(event) => setOwnerName(event.target.value)}
          />
        </div>

        <div className="auth-split__field">
          <label htmlFor="restaurant-email">Email</label>
          <input
            id="restaurant-email"
            type="email"
            required
            autoComplete="email"
            className="auth-split__input"
            placeholder="you@restaurant.co.ke"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="auth-split__row">
          <div className="auth-split__field">
            <label htmlFor="restaurant-phone">Phone</label>
            <input
              id="restaurant-phone"
              type="tel"
              autoComplete="tel"
              className="auth-split__input"
              placeholder="+2547…"
              value={phone}
              disabled={busy}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="auth-split__field">
            <label htmlFor="restaurant-location">Town / city</label>
            <input
              id="restaurant-location"
              required
              autoComplete="address-level2"
              className="auth-split__input"
              placeholder="Nairobi"
              value={location}
              disabled={busy}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
        </div>

        <PasswordField
          id="restaurant-password"
          label="Password"
          autoComplete="new-password"
          minLength={8}
          disabled={busy}
          value={password}
          onChange={setPassword}
          showValidCheck
        />
        <PasswordField
          id="restaurant-confirm-password"
          name="confirm"
          label="Confirm password"
          autoComplete="new-password"
          minLength={8}
          disabled={busy}
          value={confirmPassword}
          onChange={setConfirmPassword}
        />

        <button type="submit" className="auth-split__btn" disabled={busy} aria-busy={busy}>
          {busy ? "Creating account…" : "Create restaurant account"}
        </button>
      </form>

      <p className="auth-split__footer">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </AuthShell>
  );
}

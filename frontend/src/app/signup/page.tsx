"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { apiFetch, resetCsrfCookie } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { firstAllowedPath } from "@/lib/merchant-permissions";
import type { AuthUser } from "@/lib/types";
import PasswordField from "@/app/sign-in/PasswordField";
import { saveBusinessVertical } from "@/lib/onboarding";

function SignupForm() {
  const router = useRouter();
  const search = useSearchParams();
  const nextRaw = search.get("next") || "/onboarding";
  const nextPath =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/onboarding";
  const statusError = search.get("error");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(statusError);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    saveBusinessVertical("retail");
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const user = await apiFetch<AuthUser>(apiRoutes.user);
        if (cancelled) return;
        router.replace(firstAllowedPath(user));
        return;
      } catch {
        /* not logged in */
      }
      try {
        const opts = await apiFetch<{ google: boolean }>(apiRoutes.signupOptions);
        if (!cancelled) setGoogleEnabled(Boolean(opts.google));
      } catch {
        if (!cancelled) setGoogleEnabled(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function continuePath(): string {
    if (nextPath.startsWith("/onboarding")) {
      return "/onboarding";
    }
    return nextPath;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      resetCsrfCookie();
      await apiFetch<AuthUser>(apiRoutes.signup, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || null,
        }),
      });
      resetCsrfCookie();
      saveBusinessVertical("retail");
      setDone(true);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not create your account."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell>
        <div className="auth-split__success-icon" aria-hidden="true">
          <i className="fas fa-check" />
        </div>
        <h1 className="auth-split__title">Your Account is Created Successfully.</h1>
        <p className="auth-split__subtitle">
          Your details are verified. Continue into shop onboarding and finish
          setting up your retail business.
        </p>
        <button
          type="button"
          className="auth-split__btn"
          onClick={() => router.replace(continuePath())}
        >
          Continue Setup
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell backHref="/sign-in" backLabel="Back to login">
      <h1 className="auth-split__title">Let&apos;s get started</h1>
      <p className="auth-split__subtitle">
        Please fill all the required details to register with DukAI Merchants
      </p>

      {error ? (
        <p role="alert" className="auth-split__alert auth-split__alert--error">
          {error}
        </p>
      ) : null}

      {googleEnabled ? (
        <>
          <a
            href={apiRoutes.googleAuth(continuePath())}
            className="auth-split__google"
            data-no-nav-loading
          >
            <i className="fab fa-google" aria-hidden="true" />
            Continue with Google
          </a>
          <p className="auth-split__divider">
            <span>or</span>
          </p>
        </>
      ) : null}

      <form className="auth-split__form" onSubmit={(e) => void onSubmit(e)}>
        <div className="auth-split__field">
          <label htmlFor="signup-name">Company / Business Name</label>
          <input
            id="signup-name"
            name="name"
            required
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mama Watoto Shop"
            className="auth-split__input"
          />
        </div>

        <div className="auth-split__field">
          <label htmlFor="signup-email">Email</label>
          <div className="auth-split__input-wrap">
            <input
              id="signup-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourshop.co.ke"
              className="auth-split__input"
            />
            {email.includes("@") ? (
              <span className="auth-split__check" aria-hidden="true">
                <i className="fas fa-check" />
              </span>
            ) : null}
          </div>
        </div>

        <div className="auth-split__row">
          <div className="auth-split__field">
            <label htmlFor="signup-phone">Phone Number</label>
            <input
              id="signup-phone"
              name="phone"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2547…"
              className="auth-split__input"
            />
          </div>
          <div className="auth-split__field">
            <label htmlFor="signup-city">City</label>
            <input
              id="signup-city"
              name="city"
              autoComplete="address-level2"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Nairobi"
              className="auth-split__input"
            />
          </div>
        </div>

        <PasswordField
          id="signup-password"
          label="Password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          disabled={busy}
          value={password}
          onChange={setPassword}
          showValidCheck
        />

        <PasswordField
          id="signup-confirm"
          name="confirm"
          label="Confirm Password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          disabled={busy}
          value={confirmPassword}
          onChange={setConfirmPassword}
          showValidCheck
        />

        <button
          type="submit"
          className="auth-split__btn"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <>
              <i className="fas fa-spinner fa-spin" aria-hidden="true" />
              Creating…
            </>
          ) : (
            "Register Now"
          )}
        </button>
      </form>

      <p className="auth-split__footer">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(continuePath())}`}>
          Sign In.
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-split">
          <div className="auth-split__panel">
            <div className="auth-split__loading">Loading…</div>
          </div>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}

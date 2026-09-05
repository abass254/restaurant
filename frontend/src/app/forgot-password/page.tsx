"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { ForgotPasswordResponse } from "@/lib/types";

function safeSignInHref(raw: string | null): string {
  return raw === "/trans-chap/sign-in" ? raw : "/sign-in";
}

export default function ForgotPasswordPage() {
  const [signInHref, setSignInHref] = useState("/sign-in");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);

  useEffect(() => {
    setSignInHref(safeSignInHref(new URLSearchParams(window.location.search).get("next")));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<ForgotPasswordResponse>(apiRoutes.forgotPassword, {
        method: "POST",
        body: JSON.stringify({ email: value }),
      });
      setDevResetLink(res.reset_link ?? null);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not send a reset email. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <div className="auth-split__success-icon" aria-hidden="true">
          <i className="fas fa-check" />
        </div>
        <h1 className="auth-split__title">Check your email</h1>
        <p className="auth-split__subtitle">
          If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a
          password reset link. It expires in 3 days.
        </p>
        {devResetLink ? (
          <p className="auth-split__subtitle">
            Email wasn&apos;t delivered in this environment.{" "}
            <Link href={devResetLink}>Open the reset link</Link>
          </p>
        ) : null}
        <Link href={signInHref} className="auth-split__btn">
          Go to Login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell backHref={signInHref} backLabel="Back to login">
      <h1 className="auth-split__title">Forgot Password</h1>
      <p className="auth-split__subtitle">
        Enter your email address and we&apos;ll send you a link to reset your password
      </p>

      {error ? (
        <p role="alert" className="auth-split__alert auth-split__alert--error">
          {error}
        </p>
      ) : null}

      <form className="auth-split__form" onSubmit={(e) => void onSubmit(e)}>
        <div className="auth-split__field">
          <label htmlFor="forgot-email">Email</label>
          <div className="auth-split__input-wrap">
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourshop.co.ke"
              className="auth-split__input"
              disabled={busy}
            />
            {email.includes("@") ? (
              <span className="auth-split__check" aria-hidden="true">
                <i className="fas fa-check" />
              </span>
            ) : null}
          </div>
        </div>

        <button type="submit" className="auth-split__btn" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="auth-split__footer">
        Already have an account yet? <Link href={signInHref}>Sign In.</Link>
      </p>
    </AuthShell>
  );
}

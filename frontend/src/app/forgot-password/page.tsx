"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell>
        <div className="auth-split__success-icon" aria-hidden="true">
          <i className="fas fa-check" />
        </div>
        <h1 className="auth-split__title">Check with your admin</h1>
        <p className="auth-split__subtitle">
          Password reset links are sent by a DukAI administrator. Ask them to
          email a reset link to <strong>{email.trim()}</strong>.
        </p>
        <Link href="/sign-in" className="auth-split__btn">
          Go to Login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell backHref="/sign-in" backLabel="Back to login">
      <h1 className="auth-split__title">Forgot Password</h1>
      <p className="auth-split__subtitle">
        Enter your email address to request a password reset
      </p>

      <form className="auth-split__form" onSubmit={onSubmit}>
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
            />
            {email.includes("@") ? (
              <span className="auth-split__check" aria-hidden="true">
                <i className="fas fa-check" />
              </span>
            ) : null}
          </div>
        </div>

        <button type="submit" className="auth-split__btn">
          Submit Now
        </button>
      </form>

      <p className="auth-split__footer">
        Already have an account yet? <Link href="/sign-in">Sign In.</Link>
      </p>
    </AuthShell>
  );
}

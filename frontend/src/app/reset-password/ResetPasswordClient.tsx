"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { AuthShell } from "@/components/auth/AuthShell";
import PasswordField from "@/app/sign-in/PasswordField";
import type { PasswordResetInfo, PasswordResetResponse } from "@/lib/types";

type Status = "loading" | "ready" | "invalid" | "submitting" | "done";

export default function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<PasswordResetInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      setError("This reset link is missing its token.");
      return;
    }
    let alive = true;
    apiFetch<PasswordResetInfo>(apiRoutes.passwordResetInfo(token))
      .then((res) => {
        if (!alive) return;
        setInfo(res);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "This reset link is invalid or has expired.",
        );
        setStatus("invalid");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      await apiFetch<PasswordResetResponse>(apiRoutes.passwordReset, {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setStatus("done");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not set your password. Please try again.",
      );
      setStatus("ready");
    }
  };

  if (status === "loading") {
    return (
      <AuthShell>
        <div className="auth-split__loading">
          <i className="fas fa-spinner fa-spin" aria-hidden="true" />
          <p>Checking your link…</p>
        </div>
      </AuthShell>
    );
  }

  if (status === "invalid") {
    return (
      <AuthShell backHref="/sign-in">
        <h1 className="auth-split__title">This link can&apos;t be used</h1>
        <p className="auth-split__subtitle">{error}</p>
        <p className="auth-split__footer">
          <Link href="/forgot-password">Request a new reset link</Link>, then{" "}
          <Link href="/sign-in">return to login</Link>.
        </p>
      </AuthShell>
    );
  }

  if (status === "done") {
    return (
      <AuthShell>
        <div className="auth-split__success-icon" aria-hidden="true">
          <i className="fas fa-check" />
        </div>
        <h1 className="auth-split__title">Your Password is Reset Successfully.</h1>
        <p className="auth-split__subtitle">Kindly Login with New Password</p>
        <Link href="/sign-in" className="auth-split__btn">
          Go to Login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell backHref="/sign-in" backLabel="Back to login">
      <h1 className="auth-split__title">Reset Password</h1>
      <p className="auth-split__subtitle">
        {info?.email
          ? `Enter a new password for ${info.email}`
          : "Enter your new password to continue"}
      </p>

      {error ? (
        <p role="alert" className="auth-split__alert auth-split__alert--error">
          {error}
        </p>
      ) : null}

      <form className="auth-split__form" onSubmit={(e) => void submit(e)}>
        <PasswordField
          id="reset-password"
          label="New Password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          disabled={status === "submitting"}
          value={password}
          onChange={setPassword}
          showValidCheck
        />

        <PasswordField
          id="reset-confirm"
          name="confirm"
          label="Confirm New Password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          disabled={status === "submitting"}
          value={confirm}
          onChange={setConfirm}
          showValidCheck
        />

        <button
          type="submit"
          className="auth-split__btn"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Saving…" : "Submit Now"}
        </button>
      </form>

      <p className="auth-split__footer">
        Already have an account yet? <Link href="/sign-in">Sign In.</Link>
      </p>
    </AuthShell>
  );
}

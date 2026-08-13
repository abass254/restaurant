"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { AuthShell } from "@/components/auth/AuthShell";
import PasswordField from "@/app/sign-in/PasswordField";
import { firstAllowedPath } from "@/lib/merchant-permissions";
import type { AuthUser } from "@/lib/types";

export default function ChangePasswordClient({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(apiRoutes.changePassword, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      router.replace(firstAllowedPath({ ...user, require_change_password: false }));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update your password. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-split__title">Reset Password</h1>
      <p className="auth-split__subtitle">
        Hi {user.name}, choose a new password before continuing to your dashboard.
      </p>

      {error ? (
        <p role="alert" className="auth-split__alert auth-split__alert--error">
          {error}
        </p>
      ) : null}

      <form className="auth-split__form" onSubmit={(e) => void submit(e)}>
        <PasswordField
          id="change-password"
          label="New Password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          disabled={submitting}
          value={password}
          onChange={setPassword}
          showValidCheck
        />
        <PasswordField
          id="change-confirm"
          name="confirm"
          label="Confirm New Password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          disabled={submitting}
          value={confirm}
          onChange={setConfirm}
          showValidCheck
        />
        <button type="submit" className="auth-split__btn" disabled={submitting}>
          {submitting ? "Saving…" : "Submit Now"}
        </button>
      </form>

      <p className="auth-split__footer">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

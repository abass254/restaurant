"use client";

import { FormEvent, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import type { UserInviteLookupResult } from "@/lib/types";

export type UserInviteLookupState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; result: UserInviteLookupResult; searchedEmail: string }
  | { status: "error"; message: string };

export const EMPTY_INVITE_LOOKUP: UserInviteLookupState = { status: "idle" };

export function inviteLookupReady(state: UserInviteLookupState): boolean {
  if (state.status !== "done") return false;
  if (state.result.invite_blocked) return false;
  if (state.result.already_member) return false;
  return true;
}

export function inviteLookupIsExisting(state: UserInviteLookupState): boolean {
  return (
    state.status === "done" &&
    state.result.found === true &&
    !state.result.invite_blocked
  );
}

type UserInviteEmailLookupProps = {
  email: string;
  onEmailChange: (email: string) => void;
  lookupUrl: string;
  lookupState: UserInviteLookupState;
  onLookupStateChange: (state: UserInviteLookupState) => void;
  onResolved?: (result: UserInviteLookupResult, searchedEmail: string) => void;
  disabled?: boolean;
  variant?: "dashboard" | "admin";
  emailInputId?: string;
};

export function UserInviteEmailLookup({
  email,
  onEmailChange,
  lookupUrl,
  lookupState,
  onLookupStateChange,
  onResolved,
  disabled = false,
  variant = "dashboard",
  emailInputId = "invite-lookup-email",
}: UserInviteEmailLookupProps) {
  const runLookup = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      onLookupStateChange({
        status: "error",
        message: "Enter a valid email address first.",
      });
      return;
    }

    onLookupStateChange({ status: "searching" });
    try {
      const result = await apiFetch<UserInviteLookupResult>(lookupUrl);
      const next: UserInviteLookupState = {
        status: "done",
        result,
        searchedEmail: trimmed.toLowerCase(),
      };
      onLookupStateChange(next);
      onResolved?.(result, trimmed.toLowerCase());
    } catch (err) {
      onLookupStateChange({
        status: "error",
        message: extractErrorMessage(err),
      });
    }
  }, [email, lookupUrl, onLookupStateChange, onResolved]);

  function handleEmailChange(value: string) {
    onEmailChange(value);
    if (lookupState.status !== "idle") {
      onLookupStateChange(EMPTY_INVITE_LOOKUP);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runLookup();
  }

  const isAdmin = variant === "admin";

  return (
    <div className={`user-invite-lookup user-invite-lookup--${variant}`}>
      <form className="user-invite-lookup__form" onSubmit={handleSubmit}>
        {isAdmin ? (
          <div className="admin-inline-editor__row">
            <label className="admin-field-label" htmlFor={emailInputId}>
              Email
            </label>
            <div className="user-invite-lookup__email-row">
              <input
                id={emailInputId}
                type="email"
                className="admin-inline-editor__input"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                required
                disabled={disabled || lookupState.status === "searching"}
                autoComplete="email"
              />
              <button
                type="submit"
                className="admin-btn admin-btn--secondary"
                disabled={disabled || lookupState.status === "searching"}
              >
                {lookupState.status === "searching" ? "Searching…" : "Look up"}
              </button>
            </div>
          </div>
        ) : (
          <label className="settings-field">
            <span>Email</span>
            <div className="user-invite-lookup__email-row">
              <input
                id={emailInputId}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                required
                disabled={disabled || lookupState.status === "searching"}
              />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={disabled || lookupState.status === "searching"}
              >
                {lookupState.status === "searching" ? "Searching…" : "Look up"}
              </button>
            </div>
          </label>
        )}
      </form>

      {lookupState.status === "error" ? (
        <p className={`user-invite-lookup__message user-invite-lookup__message--error ${isAdmin ? "admin-error" : ""}`} role="alert">
          {lookupState.message}
        </p>
      ) : null}

      {lookupState.status === "done" ? (
        <div
          className={`user-invite-lookup__message user-invite-lookup__message--${lookupMessageTone(lookupState.result)}`}
          role="status"
        >
          {lookupMessage(lookupState.result)}
        </div>
      ) : null}

      {lookupState.status === "idle" ? (
        <p className={`user-invite-lookup__hint ${isAdmin ? "admin-muted" : "settings-muted"}`}>
          Look up the email first. Existing DukAI users can be added without a
          new password.
        </p>
      ) : null}
    </div>
  );
}

function lookupMessageTone(
  result: UserInviteLookupResult,
): "success" | "warn" | "error" {
  if (result.invite_blocked || result.already_member) return "error";
  if (result.found) return "success";
  return "warn";
}

function lookupMessage(result: UserInviteLookupResult): string {
  if (result.invite_blocked) {
    return result.invite_blocked_reason ?? "This account cannot be invited.";
  }
  if (result.already_member) {
    return "This person is already on this shop's team.";
  }
  if (result.found) {
    return `Found existing account: ${result.name ?? "User"} (${result.email}). They can sign in with their current password.`;
  }
  return "No DukAI account found for this email. You'll create a new user with a temporary password.";
}

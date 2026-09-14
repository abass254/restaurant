"use client";

import { useCallback, type KeyboardEvent } from "react";
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
  variant?: "dashboard" | "admin" | "transchap";
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

  function handleEmailKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void runLookup();
  }

  const isAdmin = variant === "admin";
  const isTransChap = variant === "transchap";

  if (isTransChap) {
    const searching = lookupState.status === "searching";
    const tone =
      lookupState.status === "error"
        ? "error"
        : lookupState.status === "done"
          ? lookupMessageTone(lookupState.result)
          : null;
    const message =
      lookupState.status === "error"
        ? lookupState.message
        : lookupState.status === "done"
          ? lookupMessage(lookupState.result)
          : "Look up the email first. Existing DukAI users can be added without a new password.";
    return (
      <div className="user-invite-lookup user-invite-lookup--transchap">
        <div className="ios-settings__group">
          <h3 className="ios-settings__caption">Email</h3>
          <div className="ios-settings__card">
            <div className="ios-settings__row ios-settings__row--field">
              <input
                id={emailInputId}
                type="email"
                className="ios-settings__input"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                required
                disabled={disabled || searching}
                autoComplete="email"
                placeholder="name@email.com"
                aria-label="Email"
              />
            </div>
          </div>
          <p
            className={`ios-settings__footer${tone ? ` user-invite-lookup__message--${tone}` : ""}`}
            role={tone === "error" ? "alert" : "status"}
          >
            {message}
          </p>
          {!(
            lookupState.status === "done" &&
            !lookupState.result.invite_blocked &&
            !lookupState.result.already_member
          ) ? (
            <div className="ios-settings__actions">
              <button
                type="button"
                className="auth-split__btn"
                onClick={() => void runLookup()}
                disabled={disabled || searching}
              >
                {searching ? "Searching…" : "Look up"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`user-invite-lookup user-invite-lookup--${variant}`}>
      <div className="user-invite-lookup__form">
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
                onKeyDown={handleEmailKeyDown}
                required
                disabled={disabled || lookupState.status === "searching"}
                autoComplete="email"
              />
              <button
                type="button"
                className="admin-btn admin-btn--secondary"
                onClick={() => void runLookup()}
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
                onKeyDown={handleEmailKeyDown}
                required
                disabled={disabled || lookupState.status === "searching"}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void runLookup()}
                disabled={disabled || lookupState.status === "searching"}
              >
                {lookupState.status === "searching" ? "Searching…" : "Look up"}
              </button>
            </div>
          </label>
        )}
      </div>

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

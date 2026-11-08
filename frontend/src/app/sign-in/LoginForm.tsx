"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import { TransChapBrandHeader } from "@/components/trans-chap/TransChapAuth";
import { apiFetch, ApiError, resetCsrfCookie } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { firstAllowedPath } from "@/lib/merchant-permissions";
import type { AuthUser } from "@/lib/types";
import { verifyLoginCodeAction } from "./actions";
import PasswordField from "./PasswordField";

type Mode = "otp" | "password";
type OtpStep = "request" | "verify";

type OtpRequestResult = {
  message: string;
  expires_in_seconds: number;
  login_code: string | null;
  phone_masked: string | null;
  email_masked: string | null;
  channel: "email" | "phone" | string;
  code_sent: boolean;
  identifier?: string;
};

type Props = {
  statusMessage?: string | null;
  statusOk?: boolean;
  nextPath?: string | null;
  embedded?: boolean;
  brand?: "trans-chap";
  signInPath?: string;
};

const OTP_LENGTH = 6;

function TransChapSignInBrand() {
  return (
    <div className="trans-chap-signin__brand">
      <TransChapLogoMark size={52} />
      <div className="trans-chap-signin__brand-copy">
        <p className="trans-chap-signin__name">TransChap</p>
      </div>
    </div>
  );
}

function splitSignInMessage(message: string): { title: string | null; body: string } {
  const sessionExpired = /session expired/i.test(message);
  if (sessionExpired) {
    return {
      title: "Session expired",
      body: "Please sign in again to continue.",
    };
  }
  return { title: null, body: message };
}

function SignInStatusAlert({
  message,
  ok = false,
  embedded = false,
}: {
  message: string;
  ok?: boolean;
  embedded?: boolean;
}) {
  if (!embedded) {
    return (
      <p
        role={ok ? "status" : "alert"}
        className={`auth-split__alert ${ok ? "auth-split__alert--ok" : "auth-split__alert--error"
          }`}
      >
        {message}
      </p>
    );
  }

  const { title, body } = ok
    ? { title: null as string | null, body: message }
    : splitSignInMessage(message);
  const icon = ok
    ? "fa-circle-check"
    : title
      ? "fa-clock-rotate-left"
      : "fa-circle-exclamation";

  return (
    <div
      role={ok ? "status" : "alert"}
      className={`trans-chap-signin__alert ${ok
        ? "trans-chap-signin__alert--ok"
        : title
          ? "trans-chap-signin__alert--notice"
          : "trans-chap-signin__alert--error"
        }`}
    >
      <span className="trans-chap-signin__alert-icon" aria-hidden="true">
        <i className={`fa-solid ${icon}`} />
      </span>
      <div className="trans-chap-signin__alert-copy">
        {title ? <strong>{title}</strong> : null}
        <p>{body}</p>
      </div>
    </div>
  );
}

function LoginFrame({
  embedded,
  isTransChap,
  singleField = false,
  children,
}: {
  embedded?: boolean;
  isTransChap?: boolean;
  singleField?: boolean;
  children: React.ReactNode;
}) {
  if (isTransChap) {
    return (
      <AuthShell
        className={`auth-split--trans-chap${singleField ? " auth-split--single-field" : ""}`}
        heroLabel="KITCHEN"
        brandHeader={<TransChapBrandHeader />}
        panelAction={<ThemeToggle />}
      >
        {children}
      </AuthShell>
    );
  }
  if (embedded) {
    return (
      <div className="trans-chap-signin">
        <TransChapSignInBrand />
        {children}
      </div>
    );
  }
  return <AuthShell>{children}</AuthShell>;
}

export default function LoginForm({
  statusMessage,
  statusOk = false,
  nextPath = null,
  embedded = false,
  brand,
  signInPath,
}: Props) {
  const isTransChap = brand === "trans-chap" || signInPath === "/trans-chap/sign-in";
  const [mode, setMode] = useState<Mode>("otp");
  const [otpStep, setOtpStep] = useState<OtpStep>("request");
  const [identifier, setIdentifier] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [error, setError] = useState<string | null>(
    statusOk ? null : statusMessage ?? null,
  );
  const [info, setInfo] = useState<string | null>(
    statusOk ? statusMessage ?? null : null,
  );
  const [devCode, setDevCode] = useState<string | null>(null);
  const [maskedTarget, setMaskedTarget] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (embedded || isTransChap) return;
    let cancelled = false;
    apiFetch<{ google: boolean }>(apiRoutes.signupOptions)
      .then((opts) => {
        if (!cancelled) setGoogleEnabled(Boolean(opts.google));
      })
      .catch(() => {
        if (!cancelled) setGoogleEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [embedded, isTransChap]);

  useEffect(() => {
    if (!statusMessage) return;
    if (statusOk) {
      setInfo(statusMessage);
      setError(null);
    } else {
      setError(statusMessage);
    }
  }, [statusMessage, statusOk]);

  const code = useMemo(() => digits.join(""), [digits]);
  const googleNext = nextPath || (isTransChap ? "/" : "/dashboard");

  function switchToPassword() {
    setMode("password");
    setOtpStep("request");
    setError(null);
    setInfo(null);
    setDevCode(null);
  }

  function switchToOtp() {
    setMode("otp");
    setOtpStep("request");
    setError(null);
    setInfo(null);
    setDevCode(null);
    setDigits(Array(OTP_LENGTH).fill(""));
  }

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    const value = identifier.trim();
    if (!value) {
      setError("Enter your email or phone number to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    setDevCode(null);
    try {
      resetCsrfCookie();
      const res = await apiFetch<OtpRequestResult>(apiRoutes.requestLoginCode, {
        method: "POST",
        body: JSON.stringify({ identifier: value }),
      });
      setMaskedTarget(res.email_masked || res.phone_masked || value);
      setInfo(res.message);
      if (res.login_code) {
        setDevCode(res.login_code);
      }
      setOtpStep("verify");
      setDigits(Array(OTP_LENGTH).fill(""));
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not send a login code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e?: FormEvent) {
    e?.preventDefault();
    if (code.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("identifier", identifier.trim());
      formData.set("code", code);
      if (nextPath) formData.set("next", nextPath);
      const result = await verifyLoginCodeAction(formData);
      if (result && result.ok === false) {
        setError(result.message);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not verify the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function onDigitChange(index: number, value: string) {
    const clean = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < OTP_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function onDigitKeyDown(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      resetCsrfCookie();
      const user = await apiFetch<AuthUser>(apiRoutes.login, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (user.require_change_password) {
        window.location.assign(
          nextPath
            ? `/change-password?next=${encodeURIComponent(nextPath)}`
            : "/change-password",
        );
        return;
      }
      window.location.assign(nextPath || firstAllowedPath(user));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onDigitPaste(text: string) {
    const chars = text.replace(/\D/g, "").slice(0, OTP_LENGTH).split("");
    if (!chars.length) return;
    const next = Array(OTP_LENGTH).fill("");
    chars.forEach((ch, i) => {
      next[i] = ch;
    });
    setDigits(next);
    const focusAt = Math.min(chars.length, OTP_LENGTH - 1);
    inputsRef.current[focusAt]?.focus();
  }

  if (mode === "otp" && otpStep === "verify") {
    return (
      <LoginFrame embedded={embedded} isTransChap={isTransChap}>
        <div className="auth-otp">
          <button
            type="button"
            className="auth-split__back"
            onClick={() => {
              setOtpStep("request");
              setDigits(Array(OTP_LENGTH).fill(""));
              setError(null);
              setDevCode(null);
            }}
            aria-label="Back"
          >
            ←
          </button>
          {!embedded || isTransChap ? (
            <>
              <h1 className="auth-split__title">Enter verification code</h1>
              <p className="auth-split__subtitle">
                Enter {OTP_LENGTH}-digit code sent to
                <br />
                <strong>{maskedTarget || identifier}</strong>
              </p>
            </>
          ) : null}

          <form className="auth-otp__form" onSubmit={(e) => void verifyCode(e)}>
            <div className="auth-otp-grid" role="group" aria-label="One-time code">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  className="auth-otp-input"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={digit}
                  onChange={(e) => onDigitChange(index, e.target.value)}
                  onKeyDown={(e) => onDigitKeyDown(index, e.key)}
                  onPaste={(e) => {
                    e.preventDefault();
                    onDigitPaste(e.clipboardData.getData("text"));
                  }}
                  aria-label={`Digit ${index + 1}`}
                />
              ))}
            </div>

            {error ? (
              embedded || isTransChap ? (
                <SignInStatusAlert message={error} embedded />
              ) : (
                <p role="alert" className="auth-otp__error">
                  {error}
                </p>
              )
            ) : null}
            {!embedded && !isTransChap && devCode ? (
              <p className="auth-otp__hint">
                Code: <strong>{devCode}</strong>
              </p>
            ) : null}

            <button
              type="submit"
              className="auth-split__btn"
              disabled={busy || code.length !== OTP_LENGTH}
              aria-busy={busy}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </form>

          <button
            type="button"
            className="auth-otp__resend"
            onClick={() => void requestCode()}
            disabled={busy}
          >
            Resend Code
          </button>
        </div>
      </LoginFrame>
    );
  }

  if (mode === "password") {
    return (
      <LoginFrame embedded={embedded} isTransChap={isTransChap}>
        {!embedded || isTransChap ? (
          <>
            <h1 className="auth-split__title">
              {isTransChap ? "Sign in to TransChap" : "Sign in to your dashboard"}
            </h1>
            <p className="auth-split__subtitle">
              {isTransChap
                ? "Enter your email address and password to open your restaurant workspace"
                : "Enter your email address and password to continue"}
            </p>
          </>
        ) : null}

        {error ? (
          <SignInStatusAlert
            message={error}
            ok={statusOk}
            embedded={embedded || isTransChap}
          />
        ) : null}

        {!embedded && !isTransChap && googleEnabled ? (
          <>
            <a
              href={apiRoutes.googleAuth(googleNext)}
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

        <form className="auth-split__form" onSubmit={(e) => void submitPassword(e)}>
          <div className="auth-split__field">
            <label htmlFor="login-email" className="sr-only">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="Email"
              className="auth-split__input"
              defaultValue={identifier.includes("@") ? identifier : ""}
            />
          </div>

          <PasswordField label={null} placeholder="Password" />

          <button
            type="submit"
            className="auth-split__btn"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <Link
          href="/forgot-password"
          className="auth-split__link auth-split__link--end"
        >
          Forgot password?
        </Link>
        <p className="auth-split__footer">
          <button
            type="button"
            onClick={switchToOtp}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--auth-accent, #e85d04)",
              font: "inherit",
              fontWeight: 650,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Use OTP instead
          </button>
        </p>
        <p className="auth-split__footer">
          {isTransChap ? (
            <>
              New to TransChap?{" "}
              <Link href="/register/restaurant">Create a restaurant account.</Link>
            </>
          ) : (
            <>
              Don&apos;t have an account yet?{" "}
              <Link href="/signup">Register Now.</Link>
            </>
          )}
        </p>
      </LoginFrame>
    );
  }

  return (
    <LoginFrame embedded={embedded} isTransChap={isTransChap} singleField>
      {!embedded || isTransChap ? (
        <>
          <h1 className="auth-split__title">
            {isTransChap ? "Sign in with OTP" : "Sign in to your dashboard"}
          </h1>
          <p className="auth-split__subtitle">
            {isTransChap
              ? "Enter your Email address or Mobile Number for a restaurant sign-in code"
              : "Enter your Email address or Mobile Number to continue"}
          </p>
        </>
      ) : null}

      {error ? (
        <SignInStatusAlert message={error} embedded={embedded || isTransChap} />
      ) : null}
      {info && !error ? (
        <SignInStatusAlert message={info} ok embedded={embedded || isTransChap} />
      ) : null}

      <form className="auth-split__form" onSubmit={(e) => void requestCode(e)}>
        <div className="auth-split__field">
          <label htmlFor="login-identifier" className="sr-only">
            Email or phone
          </label>
          <input
            id="login-identifier"
            type="text"
            required
            autoComplete="username"
            placeholder="Email/Phone Number"
            className="auth-split__input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="auth-split__btn"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Sending…" : "Sign In"}
        </button>
      </form>

      <p className="auth-split__footer">
        <button
          type="button"
          onClick={switchToPassword}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--auth-accent, #e85d04)",
            font: "inherit",
            fontWeight: 650,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Use password instead
        </button>
      </p>

      <p className="auth-split__footer">
        {isTransChap ? (
          <>
            New to TransChap?{" "}
            <Link href="/register/restaurant">Create a restaurant account.</Link>
          </>
        ) : (
          <>
            Don&apos;t have an account yet? <Link href="/signup">Register Now.</Link>
          </>
        )}
      </p>
    </LoginFrame>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { extractErrorMessage } from "@/lib/alerts";
import type { RiderLoginCodeResponse, RiderMeResponse } from "@/lib/types";
import { useRider } from "@/components/rider/RiderProvider";

type AuthChannel = "phone" | "email";
type Step = "identity" | "code";

export default function RiderLoginPage() {
  const router = useRouter();
  const { me, loading, refresh } = useRider();
  const [channel, setChannel] = useState<AuthChannel>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [echoCode, setEchoCode] = useState<string | null>(null);
  const [maskedTarget, setMaskedTarget] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("identity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && me) {
      if (me.active_trip_route && me.active_trip_id) {
        router.replace(
          `${me.active_trip_route}?order=${encodeURIComponent(me.active_trip_id)}`,
        );
      } else {
        router.replace("/r/home");
      }
    }
  }, [loading, me, router]);

  function switchChannel(next: AuthChannel) {
    setChannel(next);
    setStep("identity");
    setCode("");
    setEchoCode(null);
    setMaskedTarget(null);
    setError(null);
    setInfo(null);
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const body =
        channel === "email"
          ? { email: email.trim().toLowerCase() }
          : { phone: phone.trim() };
      const res = await apiFetch<RiderLoginCodeResponse>(apiRoutes.riderAuthRequestCode, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setEchoCode(res.data.login_code);
      setMaskedTarget(
        channel === "email" ? res.data.email_masked ?? email.trim() : res.data.phone_masked,
      );
      setInfo(res.data.message);
      setStep("code");
      if (res.data.login_code) {
        setCode(res.data.login_code);
      } else {
        setCode("");
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        channel === "email"
          ? { email: email.trim().toLowerCase(), code: code.trim() }
          : { phone: phone.trim(), code: code.trim() };
      const res = await apiFetch<RiderMeResponse>(apiRoutes.riderAuthVerifyCode, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh();
      if (res.data.active_trip_route) {
        router.replace(
          `${res.data.active_trip_route}?order=${encodeURIComponent(res.data.active_trip_id || "")}`,
        );
      } else {
        router.replace("/r/home");
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || me) {
    return <p className="rider-muted">Loading…</p>;
  }

  return (
    <section className="rider-card" style={{ marginTop: 48 }}>
      <p className="rider-eyebrow">Rider access</p>
      <h1>Sign in</h1>
      <p className="rider-muted">
        Only riders onboarded by a store can use this app. First time? Open your invite link.
      </p>

      <div className="rider-segment rider-segment--2" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          className={channel === "phone" ? "is-active" : undefined}
          onClick={() => switchChannel("phone")}
        >
          Phone
        </button>
        <button
          type="button"
          className={channel === "email" ? "is-active" : undefined}
          onClick={() => switchChannel("email")}
        >
          Email
        </button>
      </div>

      {error ? <p className="rider-banner">{error}</p> : null}
      {info && !error ? <p className="rider-muted">{info}</p> : null}

      {step === "identity" ? (
        <form onSubmit={(e) => void requestCode(e)}>
          {channel === "phone" ? (
            <div className="rider-field">
              <label htmlFor="phone">Phone number</label>
              <input
                id="phone"
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+2547…"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          ) : (
            <div className="rider-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          )}
          <button type="submit" className="rider-btn rider-btn--primary" disabled={busy}>
            {busy
              ? "Sending…"
              : channel === "email"
                ? "Send code to email"
                : "Get login code"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)}>
          {echoCode ? (
            <>
              <p className="rider-muted">
                {channel === "email"
                  ? "Email could not be delivered — use this code:"
                  : "Your login code (SMS not configured yet):"}
              </p>
              <div className="rider-code-pill">{echoCode}</div>
            </>
          ) : (
            <p className="rider-muted">
              Enter the login code sent to {maskedTarget || (channel === "email" ? email : phone)}.
            </p>
          )}
          <div className="rider-field">
            <label htmlFor="code">Login code</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="rider-actions">
            <button type="submit" className="rider-btn rider-btn--primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="rider-btn rider-btn--ghost"
              onClick={() => {
                setStep("identity");
                setEchoCode(null);
                setCode("");
                setInfo(null);
              }}
            >
              {channel === "email" ? "Use a different email" : "Use a different phone"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

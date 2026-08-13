"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { RiderAcceptResponse, RiderJoinInfoResponse } from "@/lib/types";

type PageStatus = "loading" | "ready" | "submitting" | "error";

export default function RiderJoinPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<RiderJoinInfoResponse["data"] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing invite link.");
      return;
    }
    let alive = true;
    apiFetch<RiderJoinInfoResponse>(apiRoutes.riderJoin(token))
      .then((res) => {
        if (!alive) return;
        setInfo(res.data);
        setName(res.data.rider_name);
        setEmail((res.data.email || "").trim());
        setStatus("ready");
        // Already fully onboarded with email — go straight to the app.
        if (res.data.already_active && !res.data.needs_email) {
          router.replace(res.data.deliveries_url);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setErrorMsg(
          err instanceof ApiError ? err.message : "Invite link is invalid or expired.",
        );
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [token, router]);

  async function handleAccept(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMsg("Enter a valid email so you can sign back in later.");
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await apiFetch<RiderAcceptResponse>(apiRoutes.riderJoin(token), {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || null,
          email: cleanEmail,
        }),
      });
      router.replace(res.data.deliveries_url);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Could not accept invite.",
      );
      setStatus("ready");
    }
  }

  const completingProfile = Boolean(info?.already_active && info?.needs_email);

  return (
    <main className="sf-page sf-page--narrow">
      <div className="sf-card sf-card--pad">
        <header className="sf-page__header">
          <h1>{completingProfile ? "Complete your rider profile" : "Join delivery fleet"}</h1>
        </header>

        {status === "loading" ? (
          <p className="app-muted">Checking invite…</p>
        ) : null}

        {status === "error" ? (
          <>
            <p className="sf-error">{errorMsg}</p>
            <p className="app-muted">Ask your shop to send a new invite link.</p>
          </>
        ) : null}

        {status === "ready" || status === "submitting" ? (
          info ? (
            <>
              <p className="sf-lead">
                {completingProfile ? (
                  <>
                    You already joined <strong>{info.merchant_name}</strong>. Add your email
                    so we can save it and send login codes.
                  </>
                ) : (
                  <>
                    <strong>{info.merchant_name}</strong> invited you to deliver orders for
                    their shop.
                  </>
                )}
              </p>
              <form className="sf-form" onSubmit={(e) => void handleAccept(e)}>
                <label className="sf-field">
                  <span>Your name</span>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </label>
                <label className="sf-field">
                  <span>Phone</span>
                  <input readOnly value={info.phone} />
                </label>
                <label className="sf-field">
                  <span>Email</span>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <p className="app-muted">
                  Your name, phone, and email are saved to your rider profile.
                </p>
                {errorMsg ? <p className="sf-error">{errorMsg}</p> : null}
                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={status === "submitting"}
                >
                  {status === "submitting"
                    ? "Saving…"
                    : completingProfile
                      ? "Save details"
                      : "Join fleet"}
                </button>
              </form>
            </>
          ) : null
        ) : null}
      </div>
    </main>
  );
}

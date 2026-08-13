"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  formatRiderLastSeen,
  riderInitials,
  riderIsLiveOnline,
} from "@/lib/rider-presence";
import type {
  RiderInviteResponse,
  RiderSummary,
  RidersListResponse,
} from "@/lib/types";
import { useAuthUser } from "./AuthProvider";
import { FleetPresenceMap } from "./FleetPresenceMap";
import { MotionModal } from "./MotionModal";
import { Skeleton } from "./Skeleton";

type InviteForm = {
  name: string;
  phone: string;
  vehicle_type: string;
  notes: string;
  email: string;
  send_invite_email: boolean;
};

type EditForm = {
  name: string;
  phone: string;
  email: string;
  vehicle_type: string;
  notes: string;
};

const EMPTY_INVITE: InviteForm = {
  name: "",
  phone: "",
  vehicle_type: "",
  notes: "",
  email: "",
  send_invite_email: false,
};

const PRESENCE_POLL_MS = 8_000;

function statusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "invited") return "Invited";
  if (status === "suspended") return "Suspended";
  return status;
}

function statusTone(status: string): "ok" | "warn" | "off" {
  if (status === "active") return "ok";
  if (status === "invited") return "warn";
  return "off";
}

export function RidersSettingsSection() {
  const user = useAuthUser();
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(EMPTY_INVITE);
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<RiderSummary | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    phone: "",
    email: "",
    vehicle_type: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [, setTick] = useState(0);

  const loadRiders = useCallback(async (silent = false) => {
    try {
      const res = await apiFetch<RidersListResponse>(apiRoutes.riders);
      setRiders(res.data);
    } catch (err) {
      if (!silent) {
        await showError("Could not load riders", extractErrorMessage(err));
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadRiders();
  }, [loadRiders]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void loadRiders(true);
      setTick((value) => value + 1);
    }, PRESENCE_POLL_MS);
    return () => window.clearInterval(poll);
  }, [loadRiders]);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    const email = inviteForm.email.trim();
    if (!email) {
      await showError("Email required", "Save an email so the rider can sign in later.");
      return;
    }
    setInviting(true);
    try {
      const res = await apiFetch<RiderInviteResponse>(apiRoutes.riders, {
        method: "POST",
        body: JSON.stringify({
          name: inviteForm.name.trim(),
          phone: inviteForm.phone.trim(),
          vehicle_type: inviteForm.vehicle_type.trim() || null,
          notes: inviteForm.notes.trim() || null,
          email,
          send_invite_email: inviteForm.send_invite_email,
        }),
      });
      setInviteUrl(res.data.invite_url);
      setEmailSent(Boolean(res.data.email_sent));
      setRiders((prev) => [res.data.rider, ...prev]);
      if (inviteForm.send_invite_email && !res.data.email_sent) {
        await showError(
          "Invite created",
          res.message || "Invite link was created, but the email could not be sent.",
        );
      } else {
        await toastSuccess(
          res.data.email_sent ? "Invite emailed" : "Invite link created",
        );
      }
    } catch (err) {
      await showError("Could not invite rider", extractErrorMessage(err));
    } finally {
      setInviting(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toastSuccess("Invite link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      await showError("Could not copy", "Copy the link manually.");
    }
  }

  async function suspendRider(rider: RiderSummary) {
    const ok = await confirmAction(
      "Suspend rider?",
      `${rider.name} will no longer receive new deliveries.`,
    );
    if (!ok) return;
    try {
      await apiFetch(apiRoutes.riderSuspend(rider.id), { method: "POST" });
      await toastSuccess("Rider suspended");
      void loadRiders();
    } catch (err) {
      await showError("Could not suspend rider", extractErrorMessage(err));
    }
  }

  function openEdit(rider: RiderSummary) {
    setEditing(rider);
    setEditForm({
      name: rider.name || "",
      phone: rider.phone || "",
      email: rider.email || "",
      vehicle_type: rider.vehicle_type || "",
      notes: rider.notes || "",
    });
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const email = editForm.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      await showError("Email required", "Enter a valid email to save.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await apiFetch<{ message: string; data: RiderSummary }>(
        apiRoutes.riderUpdate(editing.id),
        {
          method: "POST",
          body: JSON.stringify({
            name: editForm.name.trim(),
            phone: editForm.phone.trim(),
            email,
            vehicle_type: editForm.vehicle_type.trim() || "",
            notes: editForm.notes.trim() || "",
          }),
        },
      );
      setRiders((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...res.data } : r)),
      );
      setEditing(null);
      await toastSuccess("Rider details saved");
    } catch (err) {
      await showError("Could not save rider", extractErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  function closeInviteModal() {
    setShowInvite(false);
    setInviteForm(EMPTY_INVITE);
    setInviteUrl(null);
    setEmailSent(false);
    setCopied(false);
  }

  const activeCount = riders.filter((r) => r.status === "active").length;
  const onlineCount = riders.filter((r) => riderIsLiveOnline(r)).length;
  const offlineActiveCount = Math.max(0, activeCount - onlineCount);
  const busyCount = riders.reduce((sum, r) => sum + (r.active_deliveries_count || 0), 0);

  const shopCoords = useMemo(() => {
    const account = user.active_account ?? user.account;
    if (account?.latitude == null || account?.longitude == null) return null;
    return { lat: account.latitude, lng: account.longitude };
  }, [user.account, user.active_account]);

  const sortedRiders = useMemo(() => {
    return [...riders].sort((a, b) => {
      const aOnline = riderIsLiveOnline(a) ? 1 : 0;
      const bOnline = riderIsLiveOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return a.name.localeCompare(b.name);
    });
  }, [riders]);

  return (
    <article id="section-riders" className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-motorcycle settings-card__icon" aria-hidden="true" />
          <h2>Riders</h2>
        </div>
        <span className={`settings-pill settings-pill--${onlineCount > 0 ? "ok" : "warn"}`}>
          {onlineCount} online
        </span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted">
          Invite riders to your private delivery fleet. Presence updates every few seconds
          while this page is open.
        </p>

        <div className="fleet-presence" aria-live="polite">
          <div className="fleet-presence__stat fleet-presence__stat--online">
            <span className="fleet-presence__value">{onlineCount}</span>
            <span className="fleet-presence__label">Online now</span>
          </div>
          <div className="fleet-presence__stat">
            <span className="fleet-presence__value">{offlineActiveCount}</span>
            <span className="fleet-presence__label">Offline</span>
          </div>
          <div className="fleet-presence__stat">
            <span className="fleet-presence__value">{activeCount}</span>
            <span className="fleet-presence__label">Active fleet</span>
          </div>
          <div className="fleet-presence__stat">
            <span className="fleet-presence__value">{busyCount}</span>
            <span className="fleet-presence__label">On delivery</span>
          </div>
        </div>

        <div className="settings-card__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowInvite(true)}
          >
            <i className="fa-solid fa-user-plus" aria-hidden="true" />
            Invite rider
          </button>
        </div>

        {loaded && riders.length > 0 ? (
          <FleetPresenceMap riders={riders} shop={shopCoords} />
        ) : null}

        {!loaded ? (
          <Skeleton className="settings-skeleton" />
        ) : riders.length === 0 ? (
          <p className="settings-muted">No riders yet. Invite your first rider above.</p>
        ) : (
          <ul className="riders-list">
            {sortedRiders.map((rider) => {
              const live = riderIsLiveOnline(rider);
              return (
                <li
                  key={rider.id}
                  className={`riders-list__item${live ? " riders-list__item--online" : ""}`}
                >
                  <div className="riders-list__avatar" data-online={live ? "true" : "false"}>
                    <span aria-hidden="true">{riderInitials(rider.name)}</span>
                    <span className="riders-list__pulse" aria-hidden="true" />
                  </div>
                  <div className="riders-list__main">
                    <strong>{rider.name}</strong>
                    <span className="app-muted">{rider.phone}</span>
                    {rider.email ? (
                      <span className="app-muted">{rider.email}</span>
                    ) : (
                      <span className="app-muted">No login email</span>
                    )}
                    <span className="riders-list__seen app-muted">
                      {rider.vehicle_type ? `${rider.vehicle_type} · ` : ""}
                      {live ? "Live now" : formatRiderLastSeen(rider.last_seen_at)}
                    </span>
                  </div>
                  <div className="riders-list__meta">
                    <span
                      className={`settings-pill settings-pill--${live ? "ok" : "off"}`}
                    >
                      {live ? "Online" : "Offline"}
                    </span>
                    <span className={`settings-pill settings-pill--${statusTone(rider.status)}`}>
                      {statusLabel(rider.status)}
                    </span>
                    {rider.active_deliveries_count > 0 ? (
                      <span className="app-muted">
                        {rider.active_deliveries_count} active
                      </span>
                    ) : null}
                  </div>
                  <div className="riders-list__actions">
                    {rider.status === "active" || rider.status === "invited" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEdit(rider)}
                      >
                        Edit details
                      </button>
                    ) : null}
                    {rider.status === "active" || rider.status === "invited" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm orders-danger"
                        onClick={() => void suspendRider(rider)}
                      >
                        Suspend
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MotionModal
        open={showInvite}
        onClose={closeInviteModal}
        ariaLabelledBy="rider-invite-title"
        panelClassName="inv-qr-modal"
        closeOnBackdrop={!inviting}
        closeOnEscape={!inviting}
      >
        <header className="inventory-modal__head">
          <h2 id="rider-invite-title">Invite rider</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={closeInviteModal}
            disabled={inviting}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        {!inviteUrl ? (
          <form
            className="settings-form settings-form--compact staff-modal-form"
            onSubmit={(e) => void handleInvite(e)}
          >
            <div className="inventory-modal__body">
              <label className="settings-field">
                <span>Name</span>
                <input
                  required
                  autoComplete="name"
                  value={inviteForm.name}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="James Kamau"
                  disabled={inviting}
                />
              </label>
              <label className="settings-field">
                <span>Phone</span>
                <input
                  required
                  type="tel"
                  autoComplete="tel"
                  value={inviteForm.phone}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  placeholder="+254 712 345 678"
                  disabled={inviting}
                />
              </label>
              <label className="settings-field">
                <span>Email</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="rider@example.com"
                  disabled={inviting}
                />
              </label>
              <label className="settings-field">
                <span>Vehicle (optional)</span>
                <input
                  value={inviteForm.vehicle_type}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, vehicle_type: e.target.value }))
                  }
                  placeholder="Motorbike"
                  disabled={inviting}
                />
              </label>
              <label className="settings-field settings-field--checkbox">
                <input
                  type="checkbox"
                  checked={inviteForm.send_invite_email}
                  onChange={(e) =>
                    setInviteForm((f) => ({
                      ...f,
                      send_invite_email: e.target.checked,
                    }))
                  }
                  disabled={inviting}
                />
                <span>Email invite link to the rider</span>
              </label>
              <div className="settings-actions">
                <button type="submit" className="btn btn-primary" disabled={inviting}>
                  {inviting
                    ? inviteForm.send_invite_email
                      ? "Sending…"
                      : "Creating…"
                    : inviteForm.send_invite_email
                      ? "Create & email invite"
                      : "Create invite link"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="inventory-modal__body inv-qr-modal__body">
            <div className="inv-qr-modal__qr">
              <QRCodeSVG value={inviteUrl} size={232} includeMargin level="M" />
            </div>
            <p className="app-muted inv-qr-modal__hint">
              {emailSent
                ? "Invite emailed. You can still share this link or QR code — it expires in 7 days."
                : "Share this link with your rider. It expires in 7 days."}
            </p>
            <div className="inv-qr-modal__url">
              <code title={inviteUrl}>{inviteUrl}</code>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void copyInviteUrl()}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={closeInviteModal}>
              Done
            </button>
          </div>
        )}
      </MotionModal>

      <MotionModal
        open={Boolean(editing)}
        onClose={() => (savingEdit ? undefined : setEditing(null))}
        ariaLabelledBy="rider-edit-title"
        panelClassName="inv-qr-modal"
        closeOnBackdrop={!savingEdit}
        closeOnEscape={!savingEdit}
      >
        <header className="inventory-modal__head">
          <h2 id="rider-edit-title">Edit rider details</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={() => setEditing(null)}
            disabled={savingEdit}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <form
          className="settings-form settings-form--compact staff-modal-form"
          onSubmit={(e) => void handleSaveEdit(e)}
        >
          <div className="inventory-modal__body">
            <label className="settings-field">
              <span>Name</span>
              <input
                required
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                disabled={savingEdit}
              />
            </label>
            <label className="settings-field">
              <span>Phone</span>
              <input
                required
                type="tel"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                disabled={savingEdit}
              />
            </label>
            <label className="settings-field">
              <span>Email</span>
              <input
                required
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                disabled={savingEdit}
              />
            </label>
            <label className="settings-field">
              <span>Vehicle</span>
              <input
                value={editForm.vehicle_type}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, vehicle_type: e.target.value }))
                }
                disabled={savingEdit}
              />
            </label>
            <label className="settings-field">
              <span>Notes</span>
              <input
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={savingEdit}
              />
            </label>
            <div className="settings-actions">
              <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save to database"}
              </button>
            </div>
          </div>
        </form>
      </MotionModal>
    </article>
  );
}

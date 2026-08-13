"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type {
  AdminCreateSuperAdminResponse,
  AdminSuperAdminsResponse,
  AdminUser,
} from "@/lib/types";
import { formatNairobiDateTime } from "@/lib/nairobi-time";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDateTime(value) || value;
}

const SKELETON_ROWS = 3;

export default function AdminPlatformUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [requireChangePassword, setRequireChangePassword] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<AdminSuperAdminsResponse>(apiRoutes.adminSuperAdmins)
      .then((res) => {
        if (cancelled) return;
        setUsers(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load platform admins.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setName("");
    setUsername("");
    setEmail("");
    setPhone("");
    setPassword("");
    setRequireChangePassword(true);
    setFormError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const res = await apiFetch<AdminCreateSuperAdminResponse>(
        apiRoutes.adminSuperAdmins,
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            username: username.trim(),
            password,
            email: email.trim() || null,
            phone: phone.trim() || null,
            require_change_password: requireChangePassword,
          }),
        },
      );
      setFormSuccess(res.message);
      resetForm();
      setShowForm(false);
      setUsers((prev) => [res.data, ...prev]);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Could not create this admin.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Platform admins</h1>
          <p className="admin-page__lead">
            Super admin accounts for the platform console. These users sign in
            at <code>/admin/login</code> with a username — not a merchant email.
            All platform users live in one shared table; only super admins are
            created here.
          </p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
            setFormSuccess(null);
          }}
        >
          <i
            className={`fas ${showForm ? "fa-xmark" : "fa-user-plus"}`}
            aria-hidden="true"
          />
          {showForm ? "Cancel" : "Add platform admin"}
        </button>
      </header>

      {error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : null}

      {formSuccess ? (
        <MotionFade>
          <p className="admin-success" role="status">
            {formSuccess}
          </p>
        </MotionFade>
      ) : null}

      {showForm ? (
        <MotionFade>
          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">New platform admin</h2>
            </header>
            <form
              className="admin-inline-editor admin-inline-editor--stacked"
              onSubmit={handleCreate}
            >
              {formError ? (
                <p className="admin-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="admin-inline-editor__row">
                <label className="admin-field-label" htmlFor="admin-name">
                  Full name
                </label>
                <input
                  id="admin-name"
                  className="admin-inline-editor__input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={255}
                  placeholder="Jane Doe"
                />
              </div>
              <div className="admin-inline-editor__row">
                <label className="admin-field-label" htmlFor="admin-username">
                  Username
                </label>
                <input
                  id="admin-username"
                  className="admin-inline-editor__input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={2}
                  maxLength={64}
                  pattern="[a-zA-Z0-9._-]+"
                  autoComplete="off"
                  placeholder="jane.admin"
                />
              </div>
              <div className="admin-inline-editor__row">
                <label className="admin-field-label" htmlFor="admin-email">
                  Email <span className="admin-muted">(optional)</span>
                </label>
                <input
                  id="admin-email"
                  type="email"
                  className="admin-inline-editor__input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  placeholder="jane@example.com"
                />
              </div>
              <div className="admin-inline-editor__row">
                <label className="admin-field-label" htmlFor="admin-phone">
                  Phone <span className="admin-muted">(optional)</span>
                </label>
                <input
                  id="admin-phone"
                  type="tel"
                  className="admin-inline-editor__input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={20}
                  placeholder="+254…"
                />
              </div>
              <div className="admin-inline-editor__row">
                <label className="admin-field-label" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  className="admin-inline-editor__input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="admin-inline-editor__row">
                <label className="admin-inline-editor__checkbox">
                  <input
                    type="checkbox"
                    checked={requireChangePassword}
                    onChange={(e) => setRequireChangePassword(e.target.checked)}
                  />
                  Require password change on first sign-in
                </label>
              </div>
              <div className="admin-inline-editor__row">
                <button
                  type="submit"
                  className="admin-btn admin-btn--primary"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-user-plus" aria-hidden="true" />
                      Create platform admin
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        </MotionFade>
      ) : null}

      <section className="admin-section">
        <header className="admin-section__head">
          <h2 className="admin-section__title">Super admin accounts</h2>
          <span className="admin-chip">
            <i className="fas fa-user-shield" aria-hidden="true" />
            {loading ? "…" : users.length}
          </span>
        </header>

        {loading ? (
          <div className="admin-table-wrap">
            <ul className="admin-inbox-list" aria-busy="true">
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <li
                  key={i}
                  className="admin-inbox-list__row admin-inbox-list__row--skeleton"
                >
                  <div className="admin-inbox-list__lead">
                    <Skeleton variant="circle" width={40} height={40} />
                    <div style={{ flex: 1 }}>
                      <Skeleton variant="text" width="55%" height={14} />
                      <Skeleton variant="text" width="35%" height={11} />
                    </div>
                  </div>
                  <Skeleton variant="text" width="70%" height={14} />
                  <Skeleton variant="text" width={80} height={14} />
                  <Skeleton variant="text" width={100} height={14} />
                </li>
              ))}
            </ul>
          </div>
        ) : users.length === 0 ? (
          <div className="admin-empty">
            <i className="fas fa-user-shield" aria-hidden="true" />
            <h3>No platform admins yet</h3>
            <p>
              Add a super admin so they can sign in to the admin console with
              their username.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <div className="admin-inbox-list__head">
              <span>Admin</span>
              <span>Email</span>
              <span>Status</span>
              <span>Created</span>
            </div>
            <motion.ul
              className="admin-inbox-list"
              aria-label="Super admin accounts"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {users.map((u) => (
                <motion.li
                  key={u.id}
                  className="admin-inbox-list__row"
                  variants={staggerItem}
                >
                  <div className="admin-inbox-list__lead">
                    <span className="admin-inbox-list__avatar" aria-hidden="true">
                      <i className="fas fa-user-shield" />
                    </span>
                    <div className="admin-inbox-list__identity">
                      <span className="admin-inbox-list__title">{u.name}</span>
                      <span className="admin-inbox-list__subtitle">
                        @{u.username ?? "—"}
                      </span>
                    </div>
                  </div>
                  <span className="admin-inbox-list__field">
                    {u.email ?? "—"}
                  </span>
                  <div className="admin-inbox-list__status">
                    <span className="admin-inbox-list__field">
                      {u.is_activated ? "Active" : "Inactive"}
                    </span>
                    {u.require_change_password ? (
                      <span className="admin-inbox-list__field">
                        · Must change password
                      </span>
                    ) : null}
                  </div>
                  <time
                    className="admin-inbox-list__date"
                    dateTime={u.created_at ?? undefined}
                  >
                    {formatDate(u.created_at)}
                  </time>
                </motion.li>
              ))}
            </motion.ul>
          </div>
        )}
      </section>
    </section>
  );
}

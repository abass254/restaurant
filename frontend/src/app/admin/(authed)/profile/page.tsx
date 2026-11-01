"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { AuthUser } from "@/lib/types";
import { formatNairobiDate } from "@/lib/nairobi-time";

type ProfileTab = "overview" | "security" | "activity";

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "security", label: "Security" },
  { id: "activity", label: "Activity" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return formatNairobiDate(value) || value;
}

function roleLabel(role: string | null | undefined): string {
  if (!role) return "Super admin";
  const n = role.replace(/[_-]/g, " ").trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export default function AdminProfilePage() {
  const sessionUser = useAuthUser();
  const [profile, setProfile] = useState<AuthUser>(sessionUser);
  const [tab, setTab] = useState<ProfileTab>("overview");

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthUser>(apiRoutes.user)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        /* session user is enough */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = profile.name || profile.username || "Super admin";
  const handle = profile.username ?? "super-admin";

  return (
    <section className="admin-profile">
      <div className="admin-profile__layout">
        <aside className="admin-profile__sidebar">
          <div className="admin-profile__avatar-wrap">
            <span className="admin-profile__avatar" aria-hidden="true">
              {initials(displayName)}
            </span>
          </div>
          <h1 className="admin-profile__name">{displayName}</h1>
          <p className="admin-profile__handle">@{handle}</p>
          <p className="admin-profile__bio">
            Platform super admin for the TransChap console.
          </p>
          <Link href="/admin/settings" className="admin-profile__edit-btn">
            Platform settings
          </Link>

          <ul className="admin-profile__meta">
            <li>
              <i className="fas fa-shield-halved" aria-hidden="true" />
              <span>{roleLabel(profile.user_role)}</span>
            </li>
            {profile.email ? (
              <li>
                <i className="fas fa-envelope" aria-hidden="true" />
                <span>{profile.email}</span>
              </li>
            ) : null}
            {profile.phone ? (
              <li>
                <i className="fas fa-phone" aria-hidden="true" />
                <span>{profile.phone}</span>
              </li>
            ) : null}
            <li>
              <i className="fas fa-calendar" aria-hidden="true" />
              <span>Joined {formatDate(profile.created_at)}</span>
            </li>
          </ul>
        </aside>

        <nav className="admin-profile__tabs" aria-label="Profile sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`admin-profile__tab${
                tab === t.id ? " is-active" : ""
              }`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "true" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="admin-profile__panel">
          {tab === "overview" ? <OverviewTab profile={profile} /> : null}
          {tab === "security" ? <SecurityTab profile={profile} /> : null}
          {tab === "activity" ? <ActivityTab /> : null}
        </div>
      </div>
    </section>
  );
}

function OverviewTab({ profile }: { profile: AuthUser }) {
  const rows: { label: string; value: string }[] = [
    { label: "Full name", value: profile.name },
    { label: "Username", value: profile.username ? `@${profile.username}` : "—" },
    { label: "Email", value: profile.email ?? "—" },
    { label: "Phone", value: profile.phone ?? "—" },
    { label: "Role", value: roleLabel(profile.user_role) },
    {
      label: "Account status",
      value: profile.is_activated ? "Active" : "Inactive",
    },
    {
      label: "Member since",
      value: formatDate(profile.created_at),
    },
  ];

  return (
    <div className="admin-profile__section">
      <h2 className="admin-profile__section-title">Account overview</h2>
      <p className="admin-profile__section-lead">
        Your platform admin identity. Merchant businesses and their users are
        managed separately under Merchants.
      </p>
      <dl className="admin-profile__facts">
        {rows.map((row) => (
          <div key={row.label} className="admin-profile__fact">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="admin-profile__id">
        <span className="admin-muted">User ID</span>
        <code>{profile.id}</code>
      </p>
    </div>
  );
}

function SecurityTab({ profile }: { profile: AuthUser }) {
  return (
    <div className="admin-profile__section">
      <h2 className="admin-profile__section-title">Security</h2>
      <p className="admin-profile__section-lead">
        Sign in at <code>/admin/login</code> with your username and password.
      </p>
      <dl className="admin-profile__facts">
        <div className="admin-profile__fact">
          <dt>Password policy</dt>
          <dd>
            {profile.require_change_password
              ? "You must change your password on next sign-in"
              : "No forced password change"}
          </dd>
        </div>
        <div className="admin-profile__fact">
          <dt>Sign-in method</dt>
          <dd>Username + password (super admin)</dd>
        </div>
      </dl>
      <p className="admin-muted">
        Password changes are managed by another platform admin from the
        Platform admins screen.
      </p>
    </div>
  );
}

function ActivityTab() {
  return (
    <div className="admin-profile__section">
      <h2 className="admin-profile__section-title">Activity</h2>
      <p className="admin-profile__section-lead">
        A timeline of your admin actions will appear here.
      </p>
      <div className="admin-profile__empty-activity">
        <i className="fas fa-clock-rotate-left" aria-hidden="true" />
        <p>No recent activity recorded yet.</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type MenuItem = {
  href?: string;
  label: string;
  icon: string;
  onClick?: () => void;
  badge?: string;
};

export function AdminUserMenu() {
  const user = useAuthUser();
  const pathname = usePathname();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const displayName = user.name || user.username || "Super admin";
  const handle = user.username ?? "super-admin";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function logout() {
    setOpen(false);
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.href = "/admin/login";
  }

  const navItems: MenuItem[] = [
    { href: "/admin/profile", label: "Your profile", icon: "fa-user" },
    { href: "/admin", label: "Overview", icon: "fa-gauge-high" },
    { href: "/admin/merchants", label: "Merchants", icon: "fa-store" },
    {
      href: "/admin/users",
      label: "Platform admins",
      icon: "fa-user-shield",
      badge: "Admin",
    },
    { href: "/admin/settings", label: "Settings", icon: "fa-gear" },
    { href: "/dashboard", label: "Merchant view", icon: "fa-arrow-up-right-from-square" },
  ];

  return (
    <div className="admin-user-menu" ref={rootRef}>
      <button
        type="button"
        className="admin-user-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        <span className="admin-app__avatar" aria-hidden="true">
          {initials(displayName)}
        </span>
        <span className="admin-app__user-meta">
          <strong>{displayName}</strong>
          <span>@{handle}</span>
        </span>
        <i
          className={`fas fa-chevron-down admin-user-menu__chevron${
            open ? " is-open" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          id={menuId}
          className="admin-user-menu__panel"
          role="menu"
          aria-label="Account menu"
        >
          <div className="admin-user-menu__header">
            <span className="admin-user-menu__header-avatar" aria-hidden="true">
              {initials(displayName)}
            </span>
            <div className="admin-user-menu__header-text">
              <strong>{handle}</strong>
              <span>{displayName}</span>
            </div>
          </div>

          <div className="admin-user-menu__divider" />

          <nav className="admin-user-menu__nav">
            {navItems.map((item) =>
              item.href ? (
                <Link
                  key={item.href}
                  href={item.href}
                  className="admin-user-menu__item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <i className={`fas ${item.icon}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span className="admin-user-menu__badge">{item.badge}</span>
                  ) : null}
                </Link>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  className="admin-user-menu__item"
                  role="menuitem"
                  onClick={item.onClick}
                >
                  <i className={`fas ${item.icon}`} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ),
            )}
          </nav>

          <div className="admin-user-menu__divider" />

          <button
            type="button"
            className="admin-user-menu__item admin-user-menu__item--danger"
            role="menuitem"
            onClick={() => void logout()}
          >
            <i className="fas fa-right-from-bracket" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

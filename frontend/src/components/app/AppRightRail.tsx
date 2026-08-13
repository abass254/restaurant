import Link from "next/link";
import type { AuthUser } from "@/lib/types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppRightRail({ user }: { user: AuthUser }) {
  const business = user.account;
  const ig = user.instagram_account;

  return (
    <aside className="fb-rail" aria-label="Shortcuts">
      <div className="fb-rail-card">
        <div className="fb-rail-profile">
          <span className="fb-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        {business ? (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--app-text-secondary)" }}>
            {business.business_name}
            {business.business_location ? ` · ${business.business_location}` : ""}
          </p>
        ) : null}
      </div>

      <div className="fb-rail-card">
        <h3>Your shortcuts</h3>
        <ul className="fb-rail-links">
          <li>
            <Link href="/tickets">
              <i className="fas fa-comment-dots" aria-hidden="true" />
              Tickets
            </Link>
          </li>
          <li>
            <Link href="/settings">
              <i className="fas fa-store" aria-hidden="true" />
              Shop settings
            </Link>
          </li>
          {ig?.username ? (
            <li>
              <Link href="/settings">
                <i className="fab fa-link" aria-hidden="true" />
                @{ig.username}
              </Link>
            </li>
          ) : (
            <li>
              <Link href="/settings">
                <i className="fab fa-link" aria-hidden="true" />
                Connect Instagram
              </Link>
            </li>
          )}
          <li>
            <Link href="/tools/onboarding">
              <i className="fas fa-circle-check" aria-hidden="true" />
              Setup checklist
            </Link>
          </li>
        </ul>
      </div>

      <div className="fb-rail-card">
        <h3>Tip</h3>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--app-text-secondary)", lineHeight: 1.5 }}>
          This shop uses one shared Instagram inbox for the whole platform. Open Inbox to see customer DMs.
        </p>
      </div>
    </aside>
  );
}

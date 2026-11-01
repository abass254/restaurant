import Link from "next/link";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import { adminLoginFormAction } from "./actions";

type PageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export const metadata = {
  title: "Admin sign in — TransChap",
};

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error ?? null;

  return (
    <div className="landing-ufanisi auth-page auth-page--admin">
      <nav className="ufanisi-nav auth-nav" aria-label="Admin sign in">
        <Link href="/" className="logo">
          <TransChapLogoMark size={48} />
          <span className="logo-text">
            TransChap
          </span>
        </Link>
        <Link href="/sign-in" className="auth-nav__home">
          ← Merchant sign-in
        </Link>
      </nav>

      <main className="auth-layout">
        <aside className="auth-brand auth-brand--admin">
          <div className="auth-brand__content">
            <span className="auth-brand__badge">
              <i className="fas fa-shield-halved" aria-hidden="true" />
              Platform admin
            </span>
            <h1>
              Super admin <span>console</span>
            </h1>
            <p>
              Oversight for every merchant on TransChap. Inspect accounts, users,
              connected channels and platform-wide activity.
            </p>
            <ul className="auth-brand__list">
              <li>
                <i className="fas fa-check-circle" aria-hidden="true" />
                Every merchant on the platform
              </li>
              <li>
                <i className="fas fa-check-circle" aria-hidden="true" />
                Users registered against each business
              </li>
              <li>
                <i className="fas fa-check-circle" aria-hidden="true" />
                Channel connection status at a glance
              </li>
            </ul>
          </div>
          <AdminBrandVisual />
        </aside>

        <div className="auth-form-wrap">
          <div className="auth-card">
            <header className="auth-card__header">
              <span className="section-tag">
                <i className="fas fa-lock" aria-hidden="true" /> Restricted
              </span>
              <h2>Sign in to admin</h2>
              <p>
                Only platform super admins can continue. Use your admin
                username — not your merchant email.
              </p>
            </header>

            {error ? (
              <p
                role="alert"
                style={{
                  margin: "0 0 1rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "10px",
                  fontSize: "0.875rem",
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                }}
              >
                {error}
              </p>
            ) : null}

            <form className="auth-form" action={adminLoginFormAction}>
              <div className="auth-field">
                <label htmlFor="admin-username">Username</label>
                <div className="auth-field__input-wrap">
                  <i
                    className="fas fa-user-shield auth-field__icon"
                    aria-hidden="true"
                  />
                  <input
                    id="admin-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    placeholder="Admin username"
                  />
                </div>
              </div>

              <div className="auth-field">
                <label htmlFor="admin-password">Password</label>
                <div className="auth-field__input-wrap auth-field__input-wrap--password">
                  <i
                    className="fas fa-lock auth-field__icon"
                    aria-hidden="true"
                  />
                  <input
                    id="admin-password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <AuthSubmitButton>
                <i className="fas fa-arrow-right-to-bracket" aria-hidden="true" />
                Sign in to admin
              </AuthSubmitButton>
            </form>

            <p className="auth-card__footer">
              Looking for your shop?{" "}
              <Link href="/sign-in">Sign in as a merchant</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function AdminBrandVisual() {
  return (
    <div className="auth-visual" aria-hidden="true">
      <div className="auth-visual__glow" />
      <div className="admin-visual-card">
        <div className="admin-visual-card__head">
          <span className="admin-visual-card__badge">
            <i className="fas fa-shield-halved" aria-hidden="true" />
            Admin overview
          </span>
        </div>
        <div className="admin-visual-card__stats">
          <div className="admin-visual-stat">
            <i className="fas fa-store" aria-hidden="true" />
            <strong>128</strong>
            <span>Merchants</span>
          </div>
          <div className="admin-visual-stat">
            <i className="fas fa-users" aria-hidden="true" />
            <strong>342</strong>
            <span>Users</span>
          </div>
          <div className="admin-visual-stat">
            <i className="fab fa-instagram" aria-hidden="true" />
            <strong>96</strong>
            <span>IG connected</span>
          </div>
        </div>
        <ul className="admin-visual-card__list">
          <li>
            <span className="admin-visual-card__dot" aria-hidden="true" />
            Mama Watoto Shop · 4 users
          </li>
          <li>
            <span className="admin-visual-card__dot" aria-hidden="true" />
            Westlands Boutique · 2 users
          </li>
          <li>
            <span className="admin-visual-card__dot" aria-hidden="true" />
            Karen Pharmacy · 1 user
          </li>
        </ul>
      </div>
    </div>
  );
}

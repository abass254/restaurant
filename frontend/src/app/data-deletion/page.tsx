import type { Metadata } from "next";
import Link from "next/link";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { LEGAL_OPERATOR_LINE, legalFooterLine } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Data Deletion — DukAI",
  description:
    "How to request deletion of your data from DukAI when you remove Instagram access.",
};

const lastUpdated = "June 29, 2026";

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function DataDeletionPage({ searchParams }: Props) {
  const params = await searchParams;
  const confirmationCode = params.code?.trim() || null;
  const year = new Date().getFullYear();

  return (
    <div className="landing-ufanisi legal-ufanisi">
      <nav className="ufanisi-nav legal-nav" aria-label="Legal">
        <Link href="/" className="logo">
          <DukAiLogoMark size={48} />
          <span className="logo-text">
            Duk<span className="logo-accent">AI</span>
          </span>
        </Link>
        <div className="legal-nav__links">
          <Link href="/">Home</Link>
          <Link href="/sign-in">Log in</Link>
        </div>
      </nav>

      <header className="legal-hero">
        <div className="legal-hero__inner">
          <span className="section-tag">Legal</span>
          <h1>Data deletion</h1>
          <p>
            How to remove your Instagram and messaging data from DukAI.
          </p>
          <p className="legal-hero__date">Last updated: {lastUpdated}</p>
        </div>
        <div className="legal-hero__visual" aria-hidden="true">
          <div className="legal-shield">
            <i className="fas fa-eraser" />
          </div>
        </div>
      </header>

      <div className="legal-body legal-body--solo">
        <main className="legal-content-wrap legal-content-wrap--solo">
          <article className="legal-content">
            {confirmationCode ? (
              <>
                <h2>Deletion request status</h2>
                <p className="legal-lead">
                  Your data deletion request has been received and processed.
                </p>
                <p>
                  <strong>Confirmation code:</strong>{" "}
                  <code>{confirmationCode}</code>
                </p>
                <p>
                  We removed Instagram connection data, stored direct messages,
                  conversation history, auto-reply rules, and conversation starters
                  associated with your connected account. Some anonymized server logs
                  may be retained for security and legal compliance for a limited
                  period.
                </p>
                <p>
                  If you did not initiate this request, contact{" "}
                  <a href="mailto:privacy@dukai.co.ke">privacy@dukai.co.ke</a> with
                  your confirmation code.
                </p>
              </>
            ) : (
              <>
                <p className="legal-lead">
                  {LEGAL_OPERATOR_LINE} DukAI stores Instagram connection details,
                  direct messages, and merchant configuration so we can provide
                  inbox management and automation. You can delete this data in
                  several ways.
                </p>

                <h2>Option 1 — Remove DukAI in Instagram</h2>
                <p>
                  When you remove DukAI from Instagram&apos;s Website permissions,
                  Meta notifies us automatically. We delete your Instagram-linked
                  data and provide a confirmation code and status URL through
                  Meta&apos;s removal flow.
                </p>
                <ol>
                  <li>Open Instagram on your phone</li>
                  <li>Go to Settings and privacy → Website permissions</li>
                  <li>Select DukAI and remove access</li>
                </ol>

                <h2>Option 2 — Disconnect in DukAI</h2>
                <p>
                  Log in to DukAI, open <strong>Settings → Channels</strong>, and
                  disconnect your Instagram account. This removes stored tokens,
                  conversations, and related configuration from our systems.
                </p>

                <h2>Option 3 — Email us</h2>
                <p>
                  Email{" "}
                  <a href="mailto:privacy@dukai.co.ke">privacy@dukai.co.ke</a> from
                  the address associated with your DukAI account. Include your
                  Instagram username and request deletion of all personal data. We
                  respond within 30 days.
                </p>

                <h2>What we delete</h2>
                <ul>
                  <li>Instagram OAuth tokens and connection metadata</li>
                  <li>Stored direct messages and conversation threads</li>
                  <li>Auto-reply rules and conversation starters</li>
                  <li>Webhook subscription for your account</li>
                </ul>

                <h2>What may be retained</h2>
                <p>
                  We may retain minimal records where required by law, for fraud
                  prevention, or to resolve disputes. Aggregated analytics without
                  personal identifiers may also be kept.
                </p>

                <p>
                  See also our <Link href="/privacy_policy">Privacy Policy</Link>{" "}
                  and <Link href="/terms">Terms of Service</Link>.
                </p>
              </>
            )}
          </article>
        </main>
      </div>

      <footer className="legal-site-footer">
        <p>{legalFooterLine(year)} Built with care for African commerce.</p>
        <div className="legal-site-footer__links">
          <Link href="/">Home</Link>
          <Link href="/privacy_policy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}

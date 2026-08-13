import type { Metadata } from "next";
import Link from "next/link";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import {
  LEGAL_ENTITY_NAME,
  LEGAL_OPERATOR_LINE,
  legalFooterLine,
} from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Privacy Policy — DukAI",
  description:
    "How DukAI collects, uses, and protects information when you use our Instagram commerce platform.",
};

const lastUpdated = "June 29, 2026";

const SECTIONS = [
  { id: "who", title: "Who this applies to" },
  { id: "collect", title: "Information we collect" },
  { id: "use", title: "How we use information" },
  { id: "legal", title: "Legal bases" },
  { id: "share", title: "How we share" },
  { id: "retention", title: "Data retention" },
  { id: "security", title: "Security" },
  { id: "rights", title: "Your rights" },
  { id: "transfers", title: "International transfers" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Policy changes" },
  { id: "contact", title: "Contact us" },
];

export default function PrivacyPolicyPage() {
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
          <Link href="/terms">Terms</Link>
          <Link href="/data-deletion">Data deletion</Link>
          <Link href="/sign-in">Log in</Link>
        </div>
      </nav>

      <header className="legal-hero">
        <div className="legal-hero__inner">
          <span className="section-tag">Legal</span>
          <h1>Privacy Policy</h1>
          <p>
            How we collect, use, and protect your information when you use DukAI
            for Instagram commerce.
          </p>
          <p className="legal-hero__date">Last updated: {lastUpdated}</p>
        </div>
        <div className="legal-hero__visual" aria-hidden="true">
          <div className="legal-shield">
            <i className="fas fa-shield-alt" />
          </div>
        </div>
      </header>

      <div className="legal-body">
        <aside className="legal-toc">
          <p className="legal-toc__title">On this page</p>
          <nav aria-label="Table of contents">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="legal-content-wrap">
          <article className="legal-content">
            <p className="legal-lead">
              {LEGAL_OPERATOR_LINE} Throughout this Privacy Policy,
              &quot;DukAI&quot;, &quot;we&quot;, &quot;us&quot;, and
              &quot;our&quot; refer to {LEGAL_ENTITY_NAME}. This policy explains
              what information we collect, how we use it, and the choices you have
              when you use our website, merchant dashboard, and related services
              (collectively, the &quot;Service&quot;).
            </p>

            <h2 id="who">1. Who this policy applies to</h2>
            <p>
              This policy applies to merchants who create an account and connect
              an Instagram professional account to DukAI. It also describes how we
              handle information about people who message a connected merchant on
              Instagram, because those messages are processed through our Service
              on the merchant&apos;s behalf.
            </p>

            <h2 id="collect">2. Information we collect</h2>
            <h3>Account and Instagram connection data</h3>
            <p>When you sign in with Instagram, we receive and store:</p>
            <ul>
              <li>Instagram user ID, username, display name, and account type</li>
              <li>OAuth access tokens needed to connect to Instagram on your behalf</li>
              <li>Permissions you grant through Meta&apos;s authorization flow</li>
              <li>Onboarding and connection status related to your account</li>
            </ul>

            <h3>Messages and conversation data</h3>
            <p>
              To provide inbox management, auto-replies, and conversation
              starters, we process Instagram direct messages sent to and from your
              connected account, including message text, timestamps, sender
              identifiers, and related metadata delivered through Instagram
              webhooks and APIs.
            </p>

            <h3>Configuration you provide</h3>
            <p>
              We store settings you create in the dashboard, such as auto-reply
              rules, conversation starter prompts, and automated response content.
            </p>

            <h3>Technical and usage data</h3>
            <p>
              We may collect standard server logs, including IP address, browser
              type, device information, pages visited, and timestamps. We use this
              data to operate, secure, and improve the Service.
            </p>

            <h2 id="use">3. How we use information</h2>
            <p>We use collected information to:</p>
            <ul>
              <li>Authenticate you and maintain your merchant account</li>
              <li>Display and manage Instagram conversations in your inbox</li>
              <li>Send automated and manual replies you configure or approve</li>
              <li>Sync conversation starters and webhook subscriptions with Instagram</li>
              <li>Monitor service health, prevent abuse, and troubleshoot issues</li>
              <li>Communicate with you about access, support, or product updates</li>
            </ul>
            <p>
              We do not sell your personal information. We process customer
              message content solely to provide the Service to the merchant whose
              account received or sent those messages.
            </p>

            <h2 id="legal">4. Legal bases for processing</h2>
            <p>
              Where applicable, we process personal data to perform our contract
              with you, to comply with legal obligations, with your consent (for
              example, when you connect Instagram), and where necessary for our
              legitimate interests in operating a secure and reliable platform.
            </p>

            <h2 id="share">5. How we share information</h2>
            <p>We may share information with:</p>
            <ul>
              <li>
                <strong>Meta / Instagram</strong> — to send and receive messages,
                manage permissions, and maintain API integrations you authorize
              </li>
              <li>
                <strong>Service providers</strong> — who process data on our
                behalf under contractual safeguards, including:
                <ul>
                  <li>Amazon Web Services, Inc. — cloud hosting and database storage</li>
                  <li>OpenAI, LLC — AI-assisted direct message and comment replies</li>
                  <li>Groq, Inc. — fallback AI processing for messaging features</li>
                  <li>Google LLC — Gemini API for fallback AI processing</li>
                  <li>Cloudflare, Inc. — infrastructure and optional AI processing</li>
                </ul>
              </li>
              <li>
                <strong>Legal and safety requests</strong> — when required by law
                or to protect rights, safety, and security
              </li>
            </ul>
            <p>
              We do not share merchant inbox data with unrelated third parties for
              their own marketing purposes.
            </p>

            <h2 id="retention">6. Data retention</h2>
            <p>
              We retain account, message, and configuration data for as long as
              your account is active or as needed to provide the Service. If you
              disconnect or delete your account, we will delete or anonymize
              personal data within a reasonable period, except where retention is
              required for legal, security, or dispute-resolution purposes.
            </p>

            <h2 id="security">7. Security</h2>
            <p>
              We use administrative, technical, and organizational measures to
              protect information, including encryption of access tokens at rest.
              No method of transmission or storage is completely secure, and we
              cannot guarantee absolute security.
            </p>

            <h2 id="rights">8. Your choices and rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul>
              <li>Access, correct, or delete personal information we hold about you</li>
              <li>Withdraw consent by disconnecting Instagram or deleting your account</li>
              <li>Object to or restrict certain processing activities</li>
              <li>Request a copy of your data in a portable format</li>
            </ul>
            <p>
              You can revoke DukAI&apos;s access at any time through Instagram
              settings under Website permissions, by disconnecting in Settings, or
              via our{" "}
              <Link href="/data-deletion">data deletion instructions</Link>.
              To exercise privacy rights, email{" "}
              <a href="mailto:privacy@dukai.co.ke">privacy@dukai.co.ke</a>.
            </p>

            <h2 id="transfers">9. International transfers</h2>
            <p>
              Our Service may process data on servers located outside Kenya,
              including through cloud providers and Meta&apos;s global
              infrastructure. Where required, we take steps designed to ensure
              appropriate safeguards for cross-border transfers.
            </p>

            <h2 id="children">10. Children</h2>
            <p>
              The Service is intended for merchants operating a business. It is not
              directed to children under 18, and we do not knowingly collect personal
              information from children.
            </p>

            <h2 id="changes">11. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we do, we
              will revise the &quot;Last updated&quot; date above. Material changes
              may be communicated through the Service or by email where appropriate.
            </p>

            <h2 id="contact">12. Contact us</h2>
            <p>
              If you have questions about this Privacy Policy or our data practices,
              contact us at{" "}
              <a href="mailto:privacy@dukai.co.ke">privacy@dukai.co.ke</a> or{" "}
              <a href="mailto:hello@dukai.co.ke">hello@dukai.co.ke</a>.
            </p>
            <p>{LEGAL_ENTITY_NAME} · Nairobi, Kenya</p>
          </article>
        </main>
      </div>

      <footer className="legal-site-footer">
        <p>{legalFooterLine(year)} Built with care for African commerce.</p>
        <div className="legal-site-footer__links">
          <Link href="/">Home</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/data-deletion">Data deletion</Link>
          <Link href="/sign-in">Log in</Link>
        </div>
      </footer>
    </div>
  );
}

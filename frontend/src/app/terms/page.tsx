import type { Metadata } from "next";
import Link from "next/link";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import {
  LEGAL_ENTITY_NAME,
  legalFooterLine,
} from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Terms of Service — DukAI",
  description:
    "Terms governing use of DukAI, the Instagram commerce platform for Kenyan merchants.",
};

const lastUpdated = "June 29, 2026";

const SECTIONS = [
  { id: "acceptance", title: "Acceptance" },
  { id: "service", title: "The Service" },
  { id: "accounts", title: "Accounts" },
  { id: "instagram", title: "Instagram connection" },
  { id: "merchant", title: "Merchant responsibilities" },
  { id: "acceptable", title: "Acceptable use" },
  { id: "fees", title: "Fees and availability" },
  { id: "ip", title: "Intellectual property" },
  { id: "disclaimer", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "termination", title: "Termination" },
  { id: "law", title: "Governing law" },
  { id: "contact", title: "Contact" },
];

export default function TermsOfServicePage() {
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
          <h1>Terms of Service</h1>
          <p>
            Rules for using DukAI to manage Instagram commerce, messaging, and
            related merchant tools.
          </p>
          <p className="legal-hero__date">Last updated: {lastUpdated}</p>
        </div>
        <div className="legal-hero__visual" aria-hidden="true">
          <div className="legal-shield">
            <i className="fas fa-file-contract" />
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
              These Terms of Service (&quot;Terms&quot;) are a contract between
              you and {LEGAL_ENTITY_NAME}, which operates the DukAI platform
              (&quot;DukAI&quot;, &quot;we&quot;, &quot;us&quot;, or
              &quot;our&quot;). They govern your access to and use of our website,
              merchant dashboard, and related services (collectively, the
              &quot;Service&quot;). By creating an account or using the Service,
              you agree to these Terms and our{" "}
              <Link href="/privacy_policy">Privacy Policy</Link>.
            </p>

            <h2 id="acceptance">1. Acceptance</h2>
            <p>
              If you do not agree to these Terms, do not use the Service. If you
              use the Service on behalf of a business, you represent that you have
              authority to bind that business to these Terms.
            </p>

            <h2 id="service">2. The Service</h2>
            <p>
              DukAI provides tools that help merchants connect an Instagram
              professional account, manage direct messages, configure automated
              replies, publish content, view insights, and coordinate commerce
              workflows including payments. Features may change over time. We may add,
              modify, or discontinue features with reasonable notice where
              practicable.
            </p>

            <h2 id="accounts">3. Accounts</h2>
            <p>
              You must provide accurate registration information and keep your
              login credentials secure. You are responsible for activity under your
              account. Notify us promptly at{" "}
              <a href="mailto:hello@dukai.co.ke">hello@dukai.co.ke</a> if you
              suspect unauthorized access.
            </p>

            <h2 id="instagram">4. Instagram connection</h2>
            <p>
              Connecting Instagram requires a Business or Creator account and
              authorization through Meta&apos;s OAuth flow. You grant DukAI
              permission to access Instagram data only as needed to provide the
              Service and only for accounts you connect. You may revoke access at
              any time through Instagram settings or by disconnecting in DukAI
              Settings. See our{" "}
              <Link href="/data-deletion">data deletion instructions</Link> for
              removal of stored data.
            </p>

            <h2 id="merchant">5. Merchant responsibilities</h2>
            <p>When you use DukAI to message customers on Instagram, you agree to:</p>
            <ul>
              <li>
                Comply with Meta&apos;s Platform Terms, Instagram Terms of Use, and
                applicable commerce and consumer protection laws in Kenya
              </li>
              <li>
                Obtain any consents required before sending automated or marketing
                messages
              </li>
              <li>
                Ensure product descriptions, pricing, and order commitments you make
                through the Service are accurate
              </li>
              <li>
                Handle customer data received through Instagram in accordance with
                our Privacy Policy and applicable law
              </li>
            </ul>
            <p>
              You are the data controller for customer messages processed on your
              behalf. {LEGAL_ENTITY_NAME} acts as a processor providing the
              technical DukAI platform.
            </p>

            <h2 id="acceptable">6. Acceptable use</h2>
            <p>You may not use the Service to:</p>
            <ul>
              <li>Violate law, third-party rights, or Meta platform policies</li>
              <li>Send spam, harassment, fraud, or deceptive content</li>
              <li>Attempt to bypass security, rate limits, or access controls</li>
              <li>Reverse engineer or resell the Service except as permitted in writing</li>
              <li>Upload malware or interfere with Service operation</li>
            </ul>
            <p>
              We may suspend or terminate access for violations or risks to users,
              Meta integrations, or platform security.
            </p>

            <h2 id="fees">7. Fees and availability</h2>
            <p>
              Some features may be free during early access. Paid plans, if offered,
              will be described separately. We strive for reliable uptime but do
              not guarantee uninterrupted access. Scheduled maintenance and factors
              outside our control (including Meta API outages) may affect availability.
            </p>

            <h2 id="ip">8. Intellectual property</h2>
            <p>
              DukAI retains all rights in the Service, software, and branding. You
              retain rights in content you provide. You grant DukAI a limited license
              to host, process, and display your content solely to operate the
              Service.
            </p>

            <h2 id="disclaimer">9. Disclaimers</h2>
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
              WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              WE DO NOT WARRANT THAT INSTAGRAM OR META APIs WILL REMAIN AVAILABLE OR
              UNCHANGED.
            </p>

            <h2 id="liability">10. Limitation of liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, DUKAI AND ITS AFFILIATES WILL
              NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
              PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, OR GOODWILL.
              OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM THE SERVICE IS LIMITED
              TO THE GREATER OF AMOUNTS YOU PAID US IN THE TWELVE MONTHS BEFORE THE
              CLAIM OR KES 10,000.
            </p>

            <h2 id="termination">11. Termination</h2>
            <p>
              You may stop using the Service at any time by disconnecting Instagram
              and closing your account. We may suspend or terminate access for breach
              of these Terms, legal requirements, or to protect the platform. Upon
              termination, sections that by nature should survive (including
              disclaimers and liability limits) remain in effect.
            </p>

            <h2 id="law">12. Governing law</h2>
            <p>
              These Terms are governed by the laws of Kenya, without regard to
              conflict-of-law principles. Disputes shall be subject to the exclusive
              jurisdiction of courts in Nairobi, Kenya, unless mandatory law requires
              otherwise.
            </p>

            <h2 id="contact">13. Contact</h2>
            <p>
              Questions about these Terms:{" "}
              <a href="mailto:hello@dukai.co.ke">hello@dukai.co.ke</a>. Privacy
              inquiries:{" "}
              <a href="mailto:privacy@dukai.co.ke">privacy@dukai.co.ke</a>.
            </p>
            <p>{LEGAL_ENTITY_NAME} · Nairobi, Kenya</p>
          </article>
        </main>
      </div>

      <footer className="legal-site-footer">
        <p>{legalFooterLine(year)} Built with care for African commerce.</p>
        <div className="legal-site-footer__links">
          <Link href="/">Home</Link>
          <Link href="/privacy_policy">Privacy Policy</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </div>
      </footer>
    </div>
  );
}

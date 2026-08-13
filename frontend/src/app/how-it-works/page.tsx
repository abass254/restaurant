import type { Metadata } from "next";
import Link from "next/link";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { legalFooterLine } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "AI Order Processing Workflow — DukAI",
  description:
    "A clear walkthrough of DukAI's AI order processing workflow from first message to payment, approval, and fulfillment.",
};

const FLOW_STEPS = [
  {
    title: "Customer inquiry intake",
    detail:
      "A buyer sends a message on Instagram or WhatsApp. AI handles first response instantly and classifies intent.",
    icon: "fa-comments",
  },
  {
    title: "AI qualification and cart building",
    detail:
      "AI confirms SKU, quantity, size, and location, then compiles a structured cart with totals and delivery details.",
    icon: "fa-cart-shopping",
  },
  {
    title: "Order creation and validation",
    detail:
      "The system creates a draft order, applies validation rules, and flags missing fields before payment confirmation.",
    icon: "fa-list-check",
  },
  {
    title: "M-Pesa payment matching",
    detail:
      "Incoming payment confirmations are automatically matched to the exact order, removing screenshot-based checks.",
    icon: "fa-wallet",
  },
  {
    title: "Merchant review and approval",
    detail:
      "Merchant teams review a clean order summary and approve or decline in one tap with full context.",
    icon: "fa-circle-check",
  },
  {
    title: "Fulfillment and dispatch",
    detail:
      "Approved orders move to dispatch-ready status with customer details and route-ready notes.",
    icon: "fa-motorcycle",
  },
  {
    title: "AI operations analytics",
    detail:
      "Leadership monitors conversion, payment latency, pending approvals, and fulfillment performance in real time.",
    icon: "fa-chart-line",
  },
] as const;

const BUSINESS_OUTCOMES = [
  "Respond to customers 24/7 without increasing support headcount",
  "Reduce missed orders and manual follow-up in DMs",
  "Shorten payment confirmation time from minutes to seconds",
  "Give managers real-time visibility across channels and teams",
  "Scale from solo merchant to multi-agent operations confidently",
] as const;

const BEFORE_AFTER = [
  {
    area: "Customer response",
    before: "Manual replies in DMs with delayed response outside business hours.",
    after: "Always-on AI support with instant answers and guided checkout.",
  },
  {
    area: "Order processing",
    before: "Orders scattered across chat threads and screenshots.",
    after: "Every order captured in a structured workflow with clear status.",
  },
  {
    area: "Payment confirmation",
    before: "Manual M-Pesa matching, error-prone and slow.",
    after: "Automatic matching of payments to the correct order in seconds.",
  },
  {
    area: "Management visibility",
    before: "Limited reporting, hard to track team performance daily.",
    after: "Live dashboards for orders, revenue, pending actions, and growth.",
  },
] as const;

export default function HowItWorksPage() {
  const year = new Date().getFullYear();
  const embeddedDeckUrl = process.env.NEXT_PUBLIC_CLIENT_DECK_URL;

  return (
    <div className="landing-ufanisi legal-ufanisi">
      <nav className="ufanisi-nav legal-nav" aria-label="How DukAI works">
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

      <header className="legal-hero how-it-works-hero">
        <div className="legal-hero__inner">
          <span className="section-tag">Presentation View</span>
          <h1>AI Order Processing Workflow</h1>
          <p>
            A client-ready walkthrough of how DukAI converts chat conversations
            into validated, paid, and fulfilled orders.
          </p>
          <p className="legal-hero__date">Updated for demos: June 2026</p>
        </div>
        <div className="legal-hero__visual" aria-hidden="true">
          <div className="legal-shield">
            <i className="fas fa-diagram-project" />
          </div>
        </div>
      </header>

      <div className="legal-body legal-body--solo">
        <main className="legal-content-wrap legal-content-wrap--solo">
          <article className="legal-content">
            <p className="legal-lead">
              This workflow shows how AI handles order processing from intake to
              completion. The goal is faster conversion, lower manual overhead,
              and stronger operational control at every step.
            </p>

            <section className="how-flow" aria-label="System flow">
              {FLOW_STEPS.map((step, index) => (
                <div key={step.title} className="how-step">
                  <div className="how-step__index">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="how-step__content">
                    <h2>
                      <i className={`fas ${step.icon}`} aria-hidden="true" />{" "}
                      {step.title}
                    </h2>
                    <p>{step.detail}</p>
                  </div>
                </div>
              ))}
            </section>

            <section className="how-before-after" aria-label="Before and after">
              <h2>Before vs after DukAI</h2>
              <div className="how-compare-grid">
                {BEFORE_AFTER.map((row) => (
                  <div key={row.area} className="how-compare-card">
                    <h3>{row.area}</h3>
                    <div className="how-compare-row">
                      <p className="how-compare-label">Before</p>
                      <p>{row.before}</p>
                    </div>
                    <div className="how-compare-row is-after">
                      <p className="how-compare-label">After</p>
                      <p>{row.after}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="how-outcomes" aria-label="Business outcomes">
              <h2>Why this system is commercially convincing</h2>
              <ul>
                {BUSINESS_OUTCOMES.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="how-cta-note">
                Present this as a practical shift: fewer operational bottlenecks,
                faster order cycles, and clearer visibility for leadership.
              </p>
            </section>

            {embeddedDeckUrl ? (
              <section className="how-embed" aria-label="Embedded presentation">
                <h2>Presentation mode</h2>
                <p>
                  This embedded deck can be shown directly during client demos.
                </p>
                <div className="how-embed-frame">
                  <iframe
                    src={embeddedDeckUrl}
                    title="Client presentation"
                    loading="lazy"
                    allowFullScreen
                  />
                </div>
              </section>
            ) : null}
          </article>
        </main>
      </div>

      <footer className="legal-site-footer">
        <p>{legalFooterLine(year)} Built with care for African commerce.</p>
        <div className="legal-site-footer__links">
          <Link href="/">Home</Link>
          <Link href="/privacy_policy">Privacy Policy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </div>
  );
}

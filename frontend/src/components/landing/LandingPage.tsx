"use client";

import { useLandingAnimations } from "@/hooks/useLandingAnimations";
import { JoinPlatformButton } from "@/components/landing/JoinPlatformButton";
import { ThemeToggle } from "@/components/landing/ThemeToggle";
import { ProcessShowcase } from "@/components/landing/ProcessShowcase";
import { CookiePreferencesFooterItem } from "@/components/consent/CookiePreferencesLink";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import { legalFooterLine } from "@/lib/legal-entity";
import { RegisterHashRedirect } from "@/components/landing/RegisterHashRedirect";

const ABOUT_CARDS = [
  {
    icon: "fa-comments",
    title: "Instagram & WhatsApp",
    desc: "Meet customers where they shop. One AI across both channels, one dashboard for you.",
  },
  {
    icon: "fa-wallet",
    title: "M-Pesa, matched",
    desc: "Payments linked to orders automatically. No more screenshot archaeology.",
  },
  {
    icon: "fa-chart-line",
    title: "Revenue clarity",
    desc: "Live orders, daily revenue, and pending payments — all in one place.",
  },
  {
    icon: "fa-shield-alt",
    title: "Secure & reliable",
    desc: "Enterprise-grade security with session-based auth and encrypted credentials.",
  },
];

const PRODUCT_FEATURES = [
  "Instagram & WhatsApp order automation",
  "Natural-language conversations in English & Swahili",
  "M-Pesa payment matching to every order",
  "One-tap merchant approve or decline",
  "Delivery coordination and order summaries",
  "Dashboard analytics and live order feed",
] as const;

const FEATURES = [
  {
    num: "01",
    title: "DM automation",
    desc: "Answer stock, sizing, and delivery questions automatically — 24/7.",
  },
  {
    num: "02",
    title: "Order capture",
    desc: "Turn chats into structured orders with totals, items, and delivery details.",
  },
  {
    num: "03",
    title: "M-Pesa sync",
    desc: "Link every payment to the right order without manual matching.",
  },
  {
    num: "04",
    title: "Merchant control",
    desc: "Accept or decline from one notification. Stay in charge without the grind.",
  },
  {
    num: "05",
    title: "Multi-channel",
    desc: "Run Instagram DMs and WhatsApp from the same AI and dashboard.",
  },
  {
    num: "06",
    title: "Growth insights",
    desc: "Track revenue, order volume, and pending approvals at a glance.",
  },
] as const;

type PackagePlan = {
  name: string;
  price: string;
  period: string;
  features: string[];
  badge?: string;
};

const PACKAGES: PackagePlan[] = [
  {
    name: "Starter",
    price: "KSh 30-50",
    period: "per order",
    features: [
      "Up to 50 orders/mo",
      "WhatsApp AI agent",
      "M-Pesa integration",
      "Basic dashboard",
    ],
  },
  {
    name: "Growth",
    price: "KSh 3,500",
    period: "per month",
    badge: "Most popular",
    features: [
      "Unlimited orders",
      "Instagram + WhatsApp",
      "Rider dispatch",
      "Inventory tracking",
      "Daily reports",
    ],
  },
  {
    name: "Pro",
    price: "KSh 7,000",
    period: "per month",
    features: [
      "Everything in Growth",
      "Multi-location",
      "Analytics & forecasting",
      "Priority support",
      "Custom branding",
    ],
  },
] as const;

const HERO_ORDERS = [
  {
    time: "09:12 AM",
    name: "Jane Wanjiku",
    detail: "Red Wrap Dress M · Westlands",
    status: "confirmed" as const,
  },
  {
    time: "10:45 AM",
    name: "Kevin Odhiambo",
    detail: "White Linen Top S · CBD",
    status: "confirmed" as const,
  },
  {
    time: "11:30 AM",
    name: "Aisha Kamau",
    detail: "Green Midi L · Karen",
    status: "pending" as const,
  },
  {
    time: "02:15 PM",
    name: "Brian Otieno",
    detail: "2× Ankara Set · Kilimani",
    status: "confirmed" as const,
  },
];

function LandingPageContent() {
  useLandingAnimations();
  const year = new Date().getFullYear();

  return (
    <div className="landing-ufanisi">
      <RegisterHashRedirect />
      <nav className="ufanisi-nav" aria-label="Main">
        <a href="#top" className="logo">
          <TransChapLogoMark size={56} />
          <span className="logo-text">TransChap</span>
        </a>
        <ul className="nav-links">
          <li>
            <a href="#how-it-works">How it works</a>
          </li>
          <li>
            <a href="#about">About</a>
          </li>
          <li>
            <a href="#product">Product</a>
          </li>
          <li>
            <a href="#features">Features</a>
          </li>
          <li>
            <a href="#contact">Contact</a>
          </li>
          <li>
            <a href="/brand">Brand Assets</a>
          </li>
          <li>
            <a href="/sign-in">Log in</a>
          </li>
          <li>
            <JoinPlatformButton
              className="cta-btn"
             
            >
              Get Started
            </JoinPlatformButton>
          </li>
        </ul>
        <div className="nav-tools">
          <ThemeToggle />
          <button
            type="button"
            className="mobile-toggle"
            aria-label="Toggle menu"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-content">
          <div className="hero-badge">
            <i className="fas fa-rocket" aria-hidden="true" />
            Transforming Instagram Commerce
          </div>
          <h1>
            Streamline Your <span>Instagram Shop</span> Today
          </h1>
          <p>
            We create intelligent order systems for Kenyan merchants on Instagram
            and WhatsApp. Centralize conversations, M-Pesa payments, and deliveries
            — boost sales while you sleep.
          </p>
          <div className="hero-buttons">
            <JoinPlatformButton
              className="cta-btn"
             
            >
              <i className="fas fa-rocket pr-2" aria-hidden="true" />
              Get Started
            </JoinPlatformButton>
            <a href="#product" className="cta-btn secondary">
              Explore TransChap
            </a>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-card">
            <div className="hero-card-header">
              <span className="hero-card-title">Today&apos;s Orders</span>
              <div className="hero-card-icon">
                <i className="fas fa-shopping-bag" aria-hidden="true" />
              </div>
            </div>
            {HERO_ORDERS.map((order) => (
              <div key={order.time + order.name} className="schedule-item">
                <span className="schedule-time">{order.time}</span>
                <div className="schedule-info">
                  <h4>{order.name}</h4>
                  <p>{order.detail}</p>
                </div>
                <span className={`schedule-status ${order.status}`}>
                  {order.status === "confirmed" ? "Confirmed" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="stats" aria-label="Key metrics">
        <div className="stat-item">
          <span className="stat-number">500+</span>
          <span className="stat-label">Orders Processed</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">50+</span>
          <span className="stat-label">Merchants Served</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">99.9%</span>
          <span className="stat-label">Uptime</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">40%</span>
          <span className="stat-label">Time Saved</span>
        </div>
      </section>

      <ProcessShowcase />

      <section className="about" id="about">
        <div className="section-header reveal">
          <span className="section-tag">About Us</span>
          <h2>Empowering Instagram Merchants</h2>
          <p>
            We understand the chaos of selling on social — endless DMs, manual
            M-Pesa matching, and delivery coordination. TransChap simplifies operations
            so you can focus on what matters most: growing your brand.
          </p>
        </div>
        <div className="about-grid">
          {ABOUT_CARDS.map((card) => (
            <article key={card.title} className="about-card reveal">
              <div className="about-icon">
                <i className={`fas ${card.icon}`} aria-hidden="true" />
              </div>
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="product" id="product">
        <div className="product-container">
          <div className="product-content reveal">
            <span className="section-tag">Our Product</span>
            <h2>
              Meet <span>TransChap</span>
            </h2>
            <p>
              The all-in-one operating system for Kenyan Instagram commerce — from
              first DM to delivered order, powered by AI.
            </p>
            <ul className="feature-list">
              {PRODUCT_FEATURES.map((item) => (
                <li key={item}>
                  <i className="fas fa-check-circle" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <JoinPlatformButton className="cta-btn">
              <i className="fas fa-bell pr-2" aria-hidden="true" />
              Get Started
            </JoinPlatformButton>
          </div>
          <div className="product-preview reveal">
            <ProductMockup />
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <div className="section-header reveal">
          <span className="section-tag">Why Choose Us</span>
          <h2>Everything You Need</h2>
          <p>
            Comprehensive tools designed to transform how you sell on Instagram and
            WhatsApp.
          </p>
        </div>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <article key={f.num} className="feature-card reveal">
              <div className="feature-number">{f.num}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="packages" id="packages">
        <div className="section-header reveal">
          <span className="section-tag">Packages</span>
          <h2>Choose Your Plan</h2>
          <p>
            Flexible pricing for every growth stage, from first orders to
            full-scale operations.
          </p>
        </div>
        <div className="packages-grid">
          {PACKAGES.map((pkg) => (
            <article
              key={pkg.name}
              className={`package-card reveal${pkg.badge ? " is-featured" : ""}`}
            >
              {pkg.badge ? (
                <span className="package-badge">{pkg.badge}</span>
              ) : null}
              <h3>{pkg.name}</h3>
              <p className="package-price">{pkg.price}</p>
              <p className="package-period">{pkg.period}</p>
              <ul>
                {pkg.features.map((feature) => (
                  <li key={feature}>
                    <i className="fas fa-check" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="cta" id="contact">
        <div className="cta-content reveal">
          <h2>Be First on the TransChap Waitlist</h2>
          <p>
            We&apos;re putting the finishing touches on TransChap. Join the waitlist
            and we&apos;ll personally onboard your shop the moment we go live.
          </p>
          <div className="cta-buttons">
            <JoinPlatformButton className="cta-btn white">
              <i className="fas fa-bell pr-2" aria-hidden="true" />
              Get Started
            </JoinPlatformButton>
            <a
              href="mailto:hello@transchap.co.ke?subject=TransChap%20Demo"
              className="cta-btn outline"
            >
              Schedule Demo
            </a>
            <a href="/sign-in" className="cta-btn outline">
              Merchant login
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="footer-grid">
          <div className="footer-brand">
            <a href="#top" className="logo">
              <TransChapLogoMark size={48} />
              <span className="logo-text">
                TransChap
              </span>
            </a>
            <p>
              Transforming Instagram commerce across Kenya with intelligent order
              automation and M-Pesa-ready workflows.
            </p>
            <div className="footer-social">
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                <i className="fab fa-instagram" aria-hidden="true" />
              </a>
              <a href="mailto:hello@transchap.co.ke" aria-label="Email">
                <i className="fas fa-envelope" aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="footer-column">
            <h4>Product</h4>
            <ul>
              <li>
                <a href="#product">TransChap</a>
              </li>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="/brand">Brand Assets</a>
              </li>
              <li>
                <a href="/how-it-works">How TransChap works</a>
              </li>
              <li>
                <a href="/install">Download app</a>
              </li>
              <li>
                <JoinPlatformButton
                  className="footer-link-btn"
                 
                >
                  Join
                </JoinPlatformButton>
              </li>
              <li>
                <a href="/sign-in">Log in</a>
              </li>
            </ul>
          </div>
          <div className="footer-column">
            <h4>Company</h4>
            <ul>
              <li>
                <a href="#about">About Us</a>
              </li>
              <li>
                <a href="#contact">Contact</a>
              </li>
            </ul>
          </div>
          <div className="footer-column">
            <h4>Support</h4>
            <ul>
              <li>
                <a href="mailto:hello@transchap.co.ke">hello@transchap.co.ke</a>
              </li>
              <li>
                <a href="/privacy_policy">Privacy Policy</a>
              </li>
              <li>
                <a href="/terms">Terms of Service</a>
              </li>
              <li>
                <a href="/data-deletion">Data deletion</a>
              </li>
              <CookiePreferencesFooterItem />
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>
            {legalFooterLine(year)} Built with care for African commerce.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function LandingPage() {
  return <LandingPageContent />;
}

function ProductMockup() {
  const rows = [
    { patient: "Jane W.", time: "09:12", status: "✓ Paid", color: "#0b2545" },
    { patient: "Kevin O.", time: "10:45", status: "● In transit", color: "#14345f" },
    { patient: "Aisha K.", time: "11:30", status: "○ Pending", color: "#c8b898" },
  ];

  return (
    <div className="product-mockup">
      <div className="mockup-header">
        <div className="mockup-dot red" />
        <div className="mockup-dot yellow" />
        <div className="mockup-dot green" />
      </div>
      <div className="mockup-content">
        <div className="mockup-nav">
          <span className="active">Dashboard</span>
          <span>Orders</span>
          <span>Messages</span>
          <span>Revenue</span>
        </div>
        <div className="mockup-stats">
          <div className="mockup-stat">
            <div className="mockup-stat-value">23</div>
            <div className="mockup-stat-label">Today&apos;s Orders</div>
          </div>
          <div className="mockup-stat">
            <div className="mockup-stat-value">57K</div>
            <div className="mockup-stat-label">Revenue (KSh)</div>
          </div>
          <div className="mockup-stat">
            <div className="mockup-stat-value">4</div>
            <div className="mockup-stat-label">Pending</div>
          </div>
        </div>
        <div className="mockup-table">
          <div className="mockup-table-header">
            <span>Customer</span>
            <span>Time</span>
            <span>Status</span>
          </div>
          {rows.map((row) => (
            <div key={row.patient} className="mockup-table-row">
              <span>{row.patient}</span>
              <span>{row.time}</span>
              <span style={{ color: row.color }}>{row.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

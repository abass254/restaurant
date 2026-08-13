import type { Metadata } from "next";
import Link from "next/link";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { InstallPwaPanel } from "@/components/pwa/InstallPwaPanel";
import { legalFooterLine } from "@/lib/legal-entity";

export const metadata: Metadata = {
  title: "Download DukAI Merchant — Install the app",
  description:
    "Install DukAI Merchant on your phone or tablet. Add to home screen for faster order alerts — no App Store required.",
};

export default function InstallPage() {
  const year = new Date().getFullYear();

  return (
    <div className="landing-ufanisi legal-ufanisi">
      <nav className="ufanisi-nav legal-nav" aria-label="Download DukAI">
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

      <main className="legal-body legal-body--solo install-page">
        <div className="legal-content-wrap legal-content-wrap--solo">
          <InstallPwaPanel />
        </div>
      </main>

      <footer className="legal-site-footer">
        <p>{legalFooterLine(year)} Built with care for African commerce.</p>
        <div className="legal-site-footer__links">
          <Link href="/">Home</Link>
          <Link href="/m">Companion</Link>
          <Link href="/sign-in">Log in</Link>
        </div>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { RiderArchitecturePresentation } from "@/components/canvas/RiderArchitecturePresentation";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";

export const metadata: Metadata = {
  title: "TransChap Rider Architecture Canvas",
  description:
    "Graphical architecture presentation for the TransChap Rider mobile MVP — sequence diagrams, system flows, and 9-screen map.",
};

export default function RiderArchitectureCanvasPage() {
  const year = new Date().getFullYear();

  return (
    <div className="landing-ufanisi legal-ufanisi rider-canvas-page">
      <nav className="ufanisi-nav legal-nav" aria-label="Rider architecture navigation">
        <Link href="/" className="logo">
          <TransChapLogoMark size={48} />
          <span className="logo-text">
            TransChap
          </span>
        </Link>
        <div className="legal-nav__links">
          <Link href="/">Home</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/sign-in">Log in</Link>
        </div>
      </nav>

      <header className="legal-hero rider-canvas-hero">
        <div className="legal-hero__inner">
          <span className="section-tag">Architecture Canvas</span>
          <h1>TransChap Rider Mobile App Architecture</h1>
          <p>
            Interactive graphical models for stakeholder review — sequence flows, system
            architecture, navigation map, and the ideal 9 MVP screens.
          </p>
          <div className="rider-canvas-hero__chips">
            <span>Sequence diagrams</span>
            <span>System flows</span>
            <span>9 MVP screens</span>
          </div>
        </div>
      </header>

      <div className="legal-body legal-body--solo">
        <main className="legal-content-wrap legal-content-wrap--solo">
          <article className="legal-content rider-canvas-content">
            <RiderArchitecturePresentation />
          </article>
        </main>
      </div>

      <footer className="legal-site-footer">
        <p>© {year} TransChap · Rider architecture canvas</p>
        <div className="legal-site-footer__links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/privacy_policy">Privacy Policy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </div>
  );
}

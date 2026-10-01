"use client";

import Link from "next/link";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";

export function TransChapBrandHeader() {
  return (
    <div className="auth-split__brand trans-chap-auth__brand">
      <Link href="/trans-chap/sign-in" className="trans-chap-auth__logo-link">
        <div className="trans-chap-auth__brand-icon">
          <TransChapLogoMark size={52} color="#ffffff" accentColor="#ffdbcc" />
        </div>
        <div className="trans-chap-auth__brand-text">
          <span className="trans-chap-auth__wordmark">Trans Chap</span>
          <span className="trans-chap-auth__badge">by DukAI</span>
        </div>
      </Link>
      <p className="auth-split__tagline trans-chap-auth__tagline">
        Point of Sale, Sales & Receipts
      </p>
    </div>
  );
}

export function TransChapHeroContent() {
  return (
    <div className="trans-chap-hero__content">
      <div className="trans-chap-hero__pill-wrap">
        <span className="trans-chap-hero__pill">
          <span className="trans-chap-hero__pill-dot" />
          Point of Sale & Register
        </span>
      </div>

      <div className="trans-chap-hero__card">
        <div className="trans-chap-hero__card-header">
          <div className="trans-chap-hero__card-title">Trans Chap Register</div>
          <div className="trans-chap-hero__card-sub">
            Built for retail shops, counters & quick dining
          </div>
        </div>
        <div className="trans-chap-hero__feature-list">
          <div className="trans-chap-hero__feature-item">
            <span className="trans-chap-hero__feature-icon">
              <i className="fa-solid fa-bolt" />
            </span>
            <div className="trans-chap-hero__feature-text">
              <strong>Instant Ring-up & Barcode</strong>
              <span>Fast scanning with camera or external barcode scanner</span>
            </div>
          </div>
          <div className="trans-chap-hero__feature-item">
            <span className="trans-chap-hero__feature-icon">
              <i className="fa-solid fa-mobile-screen-button" />
            </span>
            <div className="trans-chap-hero__feature-text">
              <strong>Direct M-Pesa Integration</strong>
              <span>Automated STK push and real-time payment matching</span>
            </div>
          </div>
          <div className="trans-chap-hero__feature-item">
            <span className="trans-chap-hero__feature-icon">
              <i className="fa-solid fa-boxes-stacked" />
            </span>
            <div className="trans-chap-hero__feature-text">
              <strong>Live Stock & Receipts</strong>
              <span>Automatic inventory deductions & instant receipt sharing</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

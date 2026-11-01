"use client";

import Link from "next/link";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";

export function TransChapBrandHeader() {
  return (
    <div className="auth-split__brand trans-chap-auth__brand">
      <Link href="/sign-in" className="trans-chap-auth__logo-link">
        <div className="trans-chap-auth__brand-icon">
          <TransChapLogoMark size={52} color="#ffffff" accentColor="#77f665" />
        </div>
        <div className="trans-chap-auth__brand-text">
          <span className="trans-chap-auth__wordmark">TransChap</span>
        </div>
      </Link>
      <p className="auth-split__tagline trans-chap-auth__tagline">
        Restaurant POS, Kitchen & Stock
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
          Restaurant POS & Kitchen
        </span>
      </div>

      <div className="trans-chap-hero__card">
        <div className="trans-chap-hero__card-header">
          <div className="trans-chap-hero__card-title">Made for restaurant teams</div>
          <div className="trans-chap-hero__card-sub">
            Orders, kitchen, stock, and payments in one place
          </div>
        </div>
        <div className="trans-chap-hero__feature-list">
          <div className="trans-chap-hero__feature-item">
            <span className="trans-chap-hero__feature-icon">
              <i className="fa-solid fa-utensils" />
            </span>
            <div className="trans-chap-hero__feature-text">
              <strong>Orders from table to till</strong>
              <span>Keep dine-in and takeaway orders moving</span>
            </div>
          </div>
          <div className="trans-chap-hero__feature-item">
            <span className="trans-chap-hero__feature-icon">
              <i className="fa-solid fa-fire-burner" />
            </span>
            <div className="trans-chap-hero__feature-text">
              <strong>Kitchen and recipe control</strong>
              <span>Track ingredients as meals are prepared and sold</span>
            </div>
          </div>
          <div className="trans-chap-hero__feature-item">
            <span className="trans-chap-hero__feature-icon">
              <i className="fa-solid fa-mobile-screen-button" />
            </span>
            <div className="trans-chap-hero__feature-text">
              <strong>M-Pesa and guest receipts</strong>
              <span>Take payment and share a receipt in seconds</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

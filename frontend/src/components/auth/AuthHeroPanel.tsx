"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Vertical word drawn on the hero art (e.g. MERCHANTS, ONBOARDING). */
  label?: string;
};

export function AuthHeroPanel({ label = "MERCHANTS" }: Props) {
  const word = label.trim().toUpperCase() || "MERCHANTS";
  const long = word.length > 8;
  const fontSize = long ? 56 : 72;
  const letterSpacing = long ? 6 : 10;
  // Apply CSS transform animation only after mount — avoids SVG hydration mismatches.
  const [motionOn, setMotionOn] = useState(false);
  useEffect(() => {
    setMotionOn(true);
  }, []);

  return (
    <aside className="auth-split__hero" aria-hidden="true">
      <div className="auth-split__hero-glow" />
      <svg
        className="auth-split__art"
        viewBox="0 0 420 900"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="authHeroBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#070d16" />
            <stop offset="45%" stopColor="#0d1b2a" />
            <stop offset="78%" stopColor="#152238" />
            <stop offset="100%" stopColor="#1e3a5f" />
          </linearGradient>
        </defs>

        <rect width="420" height="900" fill="url(#authHeroBg)" />

        <g transform="translate(34 820) rotate(-90)">
          <text
            x="0"
            y="0"
            fill="none"
            stroke="#faf8f4"
            strokeWidth="3"
            fontFamily="Satoshi, system-ui, sans-serif"
            fontSize={fontSize}
            fontWeight="800"
            letterSpacing={letterSpacing}
            opacity="0.55"
          >
            {word}
          </text>
        </g>

        <g className={motionOn ? "auth-split__art-motion" : undefined}>
          <g fill="#faf8f4" opacity="0.85">
            <circle cx="320" cy="90" r="5" />
            <circle cx="345" cy="120" r="3.5" />
            <circle cx="90" cy="210" r="4" />
            <circle cx="360" cy="520" r="4.5" />
            <circle cx="120" cy="760" r="5" />
          </g>
          <g stroke="#8b9bb4" strokeWidth="4" strokeLinecap="round" fill="none">
            <path d="M300 160 l10 -12 l10 12 l10 -12" />
            <path d="M70 640 l12 -10 l12 10 l12 -10" />
          </g>
          <g fill="#faf8f4" fontSize="28" fontWeight="700" opacity="0.9">
            <text x="250" y="200">+</text>
            <text x="80" y="470">+</text>
            <text x="340" y="700">+</text>
          </g>

          {/* Shopping bag */}
          <g transform="translate(250 55) rotate(10)">
            <path
              d="M18 38 L22 118 C22 126 30 132 40 132 L80 132 C90 132 98 126 98 118 L102 38 Z"
              fill="#faf8f4"
              stroke="#070d16"
              strokeWidth="4"
            />
            <path
              d="M40 38 C40 18 80 18 80 38"
              fill="none"
              stroke="#0d1b2a"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <rect x="48" y="70" width="24" height="18" rx="4" fill="#1877f2" stroke="#070d16" strokeWidth="3" />
          </g>

          {/* Storefront */}
          <g transform="translate(48 70) rotate(-8)">
            <rect x="8" y="48" width="120" height="78" rx="8" fill="#faf8f4" stroke="#070d16" strokeWidth="4" />
            <path d="M0 48 L68 12 L136 48 Z" fill="#0d1b2a" stroke="#070d16" strokeWidth="4" />
            <rect x="28" y="68" width="28" height="36" rx="4" fill="#1877f2" stroke="#070d16" strokeWidth="3" />
            <rect x="72" y="68" width="36" height="28" rx="4" fill="#8b9bb4" stroke="#070d16" strokeWidth="3" />
            <circle cx="50" cy="88" r="3" fill="#070d16" />
          </g>

          {/* POS / card terminal */}
          <g transform="translate(290 220) rotate(16)">
            <rect width="78" height="110" rx="14" fill="#faf8f4" stroke="#070d16" strokeWidth="4" />
            <rect x="12" y="14" width="54" height="36" rx="6" fill="#0d1b2a" stroke="#070d16" strokeWidth="3" />
            <rect x="18" y="62" width="16" height="12" rx="3" fill="#8b9bb4" />
            <rect x="42" y="62" width="16" height="12" rx="3" fill="#8b9bb4" />
            <rect x="18" y="82" width="42" height="12" rx="3" fill="#1877f2" stroke="#070d16" strokeWidth="2.5" />
          </g>

          {/* Shopkeeper */}
          <g transform="translate(125 320)">
            <ellipse cx="85" cy="255" rx="78" ry="18" fill="#070d16" opacity="0.18" />
            <path
              d="M42 118 C42 92 60 80 85 80 C110 80 128 92 128 118 L136 220 C136 238 118 250 85 250 C52 250 34 238 34 220 Z"
              fill="#152238"
              stroke="#070d16"
              strokeWidth="5"
            />
            <path
              d="M52 120 L85 150 L118 120 L122 190 L85 210 L48 190 Z"
              fill="#1877f2"
              stroke="#070d16"
              strokeWidth="4"
            />
            <circle cx="85" cy="52" r="38" fill="#edd9c4" stroke="#070d16" strokeWidth="5" />
            <path
              d="M50 55 C50 22 68 10 85 10 C104 10 120 24 120 52 C108 40 96 36 85 36 C72 36 58 42 50 55 Z"
              fill="#070d16"
            />
            <circle cx="72" cy="50" r="3.5" fill="#070d16" />
            <circle cx="98" cy="50" r="3.5" fill="#070d16" />
            <path d="M74 64 Q85 72 96 64" fill="none" stroke="#070d16" strokeWidth="3.5" strokeLinecap="round" />
            <rect x="40" y="198" width="90" height="18" rx="6" fill="#0d1b2a" stroke="#070d16" strokeWidth="3" />
            <path
              d="M128 140 C152 128 168 145 160 168"
              fill="none"
              stroke="#edd9c4"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d="M128 140 C152 128 168 145 160 168"
              fill="none"
              stroke="#070d16"
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* barcode scanner in hand */}
            <rect x="150" y="158" width="28" height="42" rx="6" fill="#8b9bb4" stroke="#070d16" strokeWidth="3" />
            <rect x="156" y="166" width="16" height="10" rx="2" fill="#070d16" />
          </g>

          {/* Delivery box */}
          <g transform="translate(48 540) rotate(-8)">
            <rect x="8" y="28" width="100" height="72" rx="10" fill="#8b9bb4" stroke="#070d16" strokeWidth="4" />
            <path d="M8 52 H108" stroke="#070d16" strokeWidth="4" />
            <path d="M58 28 V100" stroke="#070d16" strokeWidth="4" />
            <rect x="40" y="8" width="36" height="24" rx="6" fill="#1877f2" stroke="#070d16" strokeWidth="3" />
          </g>

          {/* Shopping cart */}
          <g transform="translate(280 560) rotate(12)">
            <path
              d="M12 18 H28 L40 78 H96"
              fill="none"
              stroke="#faf8f4"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M32 32 H102 L94 72 H40 Z"
              fill="#faf8f4"
              stroke="#070d16"
              strokeWidth="4"
            />
            <circle cx="48" cy="90" r="8" fill="#0d1b2a" stroke="#070d16" strokeWidth="3" />
            <circle cx="86" cy="90" r="8" fill="#0d1b2a" stroke="#070d16" strokeWidth="3" />
          </g>

          {/* Receipt */}
          <g transform="translate(200 700) rotate(-6)">
            <path
              d="M12 8 H76 V108 L64 98 L52 108 L40 98 L28 108 L12 98 Z"
              fill="#faf8f4"
              stroke="#070d16"
              strokeWidth="4"
            />
            <path d="M26 28 H62 M26 42 H62 M26 56 H50" stroke="#0d1b2a" strokeWidth="4" strokeLinecap="round" />
            <path d="M26 74 H48" stroke="#1877f2" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Barcode tile */}
          <g transform="translate(300 760) rotate(8)">
            <rect width="88" height="72" rx="14" fill="#faf8f4" stroke="#070d16" strokeWidth="4" />
            <g fill="#070d16">
              <rect x="16" y="16" width="6" height="40" />
              <rect x="26" y="16" width="3" height="40" />
              <rect x="33" y="16" width="8" height="40" />
              <rect x="45" y="16" width="3" height="40" />
              <rect x="52" y="16" width="5" height="40" />
              <rect x="62" y="16" width="10" height="40" />
            </g>
          </g>

          {/* M-Pesa coin */}
          <g transform="translate(90 760) rotate(-10)">
            <circle cx="40" cy="40" r="36" fill="#8b9bb4" stroke="#070d16" strokeWidth="4" />
            <text
              x="40"
              y="48"
              textAnchor="middle"
              fill="#070d16"
              fontSize="22"
              fontWeight="800"
            >
              KSh
            </text>
          </g>
        </g>
      </svg>
    </aside>
  );
}

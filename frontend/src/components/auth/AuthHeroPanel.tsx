type Props = {
  /** Vertical word drawn on the hero art (e.g. MERCHANTS, ONBOARDING). */
  label?: string;
  children?: React.ReactNode;
};

export function AuthHeroPanel({ label = "MERCHANTS", children }: Props) {
  const word = label.trim().toUpperCase() || "MERCHANTS";

  return (
    <aside className="auth-split__hero" aria-hidden={children ? undefined : "true"}>
      <div className="auth-split__hero-glow" />
      <svg
        className="auth-split__art"
        viewBox="0 0 420 900"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{word} restaurant service illustration</title>
        <defs>
          <linearGradient id="authHeroBg" x1="0" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#04142b" />
            <stop offset="52%" stopColor="#0b2545" />
            <stop offset="100%" stopColor="#25487a" />
          </linearGradient>
          <linearGradient id="authHeroCounter" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f0ddcf" />
            <stop offset="100%" stopColor="#cfae6c" />
          </linearGradient>
          <linearGradient id="authHeroApron" x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#be9b58" />
            <stop offset="100%" stopColor="#25487a" />
          </linearGradient>
          <radialGradient id="authHeroHalo">
            <stop offset="0%" stopColor="#be9b58" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#be9b58" stopOpacity="0" />
          </radialGradient>
          <pattern id="authHeroGrid" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M42 0H0V42" fill="none" stroke="#f0ddcf" strokeOpacity="0.055" />
          </pattern>
        </defs>

        <rect width="420" height="900" fill="url(#authHeroBg)" />
        <rect width="420" height="900" fill="url(#authHeroGrid)" />
        <ellipse cx="225" cy="405" rx="270" ry="310" fill="url(#authHeroHalo)" />
        <path d="M0 690 C100 630 220 750 420 655V900H0Z" fill="#061a33" fillOpacity="0.55" />
        <path d="M0 742 C128 690 280 804 420 716" fill="none" stroke="#e6ccba" strokeOpacity="0.17" strokeWidth="2" />

        <g className="auth-split__art-motion">
          <g fill="#f8ede5" opacity="0.72">
            <circle cx="337" cy="115" r="3" />
            <circle cx="88" cy="290" r="4" />
            <circle cx="348" cy="494" r="3.5" />
            <circle cx="86" cy="702" r="3" />
          </g>
          <g fill="none" stroke="#e6ccba" strokeOpacity="0.55" strokeWidth="2">
            <path d="M303 115h24v24h-24z" rx="5" />
            <path d="M315 121v12m-6-6h12" />
            <circle cx="76" cy="488" r="13" />
            <path d="M70 488h12m-6-6v12" />
          </g>

          {/* Restaurant storefront and service counter */}
          <g transform="translate(58 92)">
            <path d="M16 66h228v132H16z" fill="#08203f" stroke="#030e20" strokeWidth="6" />
            <path d="M26 76h208v112H26z" fill="#14345f" />
            <path d="M6 67 27 16h206l21 51z" fill="url(#authHeroCounter)" stroke="#030e20" strokeWidth="6" strokeLinejoin="round" />
            <path d="m51 19-10 48m54-48-4 48m54-48 4 48m53-48 10 48" stroke="#fcf6f1" strokeWidth="9" />
            <path d="M42 118h176v70H42z" rx="8" fill="#061a33" stroke="#e6ccba" strokeOpacity="0.8" strokeWidth="3" />
            <path d="M72 157c18-30 47-42 76-31 13 5 24 15 34 31" fill="none" stroke="#cfae6c" strokeWidth="8" strokeLinecap="round" />
            <circle cx="147" cy="144" r="9" fill="#f8ede5" />
            <path d="M91 177h110" stroke="#f8ede5" strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" />
          </g>

          {/* Order tablet */}
          <g transform="translate(286 278) rotate(12)">
            <rect width="78" height="112" rx="14" fill="#f8ede5" stroke="#030e20" strokeWidth="5" />
            <rect x="10" y="12" width="58" height="63" rx="7" fill="#0b2545" />
            <path d="M20 31h37M20 43h28M20 55h33" stroke="#e6ccba" strokeWidth="4" strokeLinecap="round" />
            <circle cx="39" cy="93" r="6" fill="#be9b58" />
          </g>

          {/* Chef */}
          <g transform="translate(112 332)">
            <ellipse cx="96" cy="320" rx="94" ry="20" fill="#030e20" fillOpacity="0.42" />
            <path d="M49 138c0-34 20-54 48-54s48 20 48 54l12 136c2 30-23 49-60 49s-62-19-60-49z" fill="#14345f" stroke="#030e20" strokeWidth="7" />
            <path d="m62 148 35 33 35-33 10 104-45 24-45-24z" fill="url(#authHeroApron)" stroke="#030e20" strokeWidth="5" strokeLinejoin="round" />
            <path d="M76 231h42" stroke="#f0ddcf" strokeOpacity="0.75" strokeWidth="5" strokeLinecap="round" />
            <circle cx="97" cy="60" r="43" fill="#fcf6f1" stroke="#030e20" strokeWidth="6" />
            <path d="M57 56c-9-18 2-31 16-31 2-21 25-27 37-9 13-16 36-8 36 11 15 6 18 21 9 35-13-13-29-20-49-20-18 0-35 6-49 19z" fill="#f8ede5" stroke="#030e20" strokeWidth="5" strokeLinejoin="round" />
            <circle cx="82" cy="62" r="4" fill="#0b2545" />
            <circle cx="111" cy="62" r="4" fill="#0b2545" />
            <path d="M83 79q14 13 28 0" fill="none" stroke="#0b2545" strokeWidth="4" strokeLinecap="round" />
            <path d="M153 174c26-20 50-2 42 23" fill="none" stroke="#fcf6f1" strokeWidth="15" strokeLinecap="round" />
            <path d="M153 174c26-20 50-2 42 23" fill="none" stroke="#030e20" strokeWidth="5" strokeLinecap="round" />
            <ellipse cx="207" cy="207" rx="31" ry="19" fill="#fcf6f1" stroke="#030e20" strokeWidth="4" />
            <ellipse cx="207" cy="204" rx="17" ry="10" fill="#be9b58" />
            <path d="M199 194q-7-8-2-14m13 13q7-8 3-14" fill="none" stroke="#e6ccba" strokeWidth="3" strokeLinecap="round" />
          </g>

          {/* Takeaway bag */}
          <g transform="translate(38 604) rotate(-8)">
            <path d="M16 46h98l-9 112H25z" fill="url(#authHeroCounter)" stroke="#030e20" strokeWidth="5" strokeLinejoin="round" />
            <path d="M39 47c2-35 50-35 53 0" fill="none" stroke="#030e20" strokeWidth="6" strokeLinecap="round" />
            <path d="M39 91h51m-43 18h35" stroke="#25487a" strokeWidth="6" strokeLinecap="round" />
            <path d="M58 130h15" stroke="#f8ede5" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Plated meal */}
          <g transform="translate(260 637) rotate(9)">
            <ellipse cx="70" cy="55" rx="67" ry="43" fill="#f8ede5" stroke="#030e20" strokeWidth="6" />
            <ellipse cx="70" cy="53" rx="43" ry="26" fill="none" stroke="#cfae6c" strokeWidth="5" />
            <path d="M53 54c5-18 30-23 40-5-7 19-28 25-40 5z" fill="#be9b58" />
            <circle cx="71" cy="51" r="6" fill="#08203f" />
            <path d="M28 103h84m-70 0v15m56-15v15" fill="none" stroke="#030e20" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Receipt and payment marker */}
          <g transform="translate(228 772) rotate(-5)">
            <path d="M12 8h74v106l-12-9-12 9-12-9-12 9-12-9-14 9z" fill="#fcf6f1" stroke="#030e20" strokeWidth="4" strokeLinejoin="round" />
            <path d="M27 33h44M27 49h44M27 65h30" stroke="#25487a" strokeWidth="4" strokeLinecap="round" />
            <path d="M27 84h22" stroke="#be9b58" strokeWidth="6" strokeLinecap="round" />
          </g>
          <g transform="translate(90 788)">
            <circle cx="35" cy="35" r="32" fill="#f0ddcf" stroke="#030e20" strokeWidth="5" />
            <circle cx="35" cy="35" r="21" fill="none" stroke="#be9b58" strokeWidth="4" />
            <path d="M35 21v28m9-22c-4-7-20-6-20 2 0 10 20 4 20 14 0 8-15 10-22 3" fill="none" stroke="#25487a" strokeWidth="4" strokeLinecap="round" />
          </g>
        </g>
      </svg>
      {children}
    </aside>
  );
}

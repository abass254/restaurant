"use client";

import { JoinPlatformButton } from "@/components/landing/JoinPlatformButton";

const PERKS = [
  {
    icon: "fa-bolt",
    title: "Early access",
    desc: "Be among the first shops onboarded the day we flip the switch.",
  },
  {
    icon: "fa-gift",
    title: "Founding-merchant pricing",
    desc: "Lock in launch pricing reserved for waitlist members only.",
  },
  {
    icon: "fa-handshake",
    title: "Hands-on onboarding",
    desc: "We'll personally help connect Instagram, WhatsApp and M-Pesa.",
  },
] as const;

export function RegisterPlatformSection() {
  return (
    <section className="section" id="register">
      <div className="landing-wrap">
        <div className="register-section reveal">
          <div className="register-section__glow" aria-hidden="true" />
          <div className="register-intro">
            <div className="section-tag">
              <i className="fas fa-bell" aria-hidden="true" />
              Joining Soon
            </div>
            <h2 className="section-title">Get Started Today!</h2>
            <p className="section-desc">
              Set up your retail shop in minutes — products, payments, AI, and
              channels in one guided flow.
            </p>
            <ul className="register-perks">
              {PERKS.map((perk) => (
                <li key={perk.title}>
                  <span className="register-perks__icon">
                    <i className={`fas ${perk.icon}`} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{perk.title}</strong>
                    <span>{perk.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
            <JoinPlatformButton>
              <i className="fas fa-rocket pr-2" aria-hidden="true" />
              Get Started
            </JoinPlatformButton>
          </div>
        </div>
      </div>
    </section>
  );
}

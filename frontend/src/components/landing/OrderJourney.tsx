"use client";

import { useEffect, useRef, useState } from "react";

const STAGES = [
  {
    id: "dm",
    label: "01 · Message",
    title: "Customer DMs you",
    desc: "On Instagram or WhatsApp — in English, Swahili, or Sheng.",
    icon: "💬",
    panel: "chat" as const,
  },
  {
    id: "order",
    label: "02 · Order",
    title: "AI takes the order",
    desc: "Stock, sizes, delivery — confirmed in natural conversation.",
    icon: "✨",
    panel: "order" as const,
  },
  {
    id: "pay",
    label: "03 · Pay",
    title: "M-Pesa collected",
    desc: "Payment prompted and matched to the order automatically.",
    icon: "📲",
    panel: "pay" as const,
  },
  {
    id: "tap",
    label: "04 · Approve",
    title: "You tap once",
    desc: "Accept or decline. One notification — that's your entire job.",
    icon: "👆",
    panel: "tap" as const,
  },
  {
    id: "deliver",
    label: "05 · Deliver",
    title: "Order at their door",
    desc: "Rider briefed with details. Customer kept in the loop.",
    icon: "📦",
    panel: "deliver" as const,
  },
];

const CYCLE_MS = 3200;

export function OrderJourney() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setIsRunning(true);
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsRunning(true);
            intervalId = setInterval(() => {
              setActiveIndex((i) => (i + 1) % STAGES.length);
            }, CYCLE_MS);
          } else {
            setIsRunning(false);
            if (intervalId) clearInterval(intervalId);
          }
        });
      },
      { threshold: 0.25 },
    );

    observer.observe(section);
    return () => {
      observer.disconnect();
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const active = STAGES[activeIndex];

  return (
    <section
      className="journey-section section"
      id="how-it-works"
      ref={sectionRef}
      aria-label="Order journey from social media to delivery"
    >
      <div className="journey-bg" aria-hidden="true" />
      <div className="landing-wrap">
        <div className="section-header-center">
          <div className="section-tag reveal">How it works</div>
          <h2 className="section-title reveal reveal-delay-1">
            From Instagram DM to delivered order
          </h2>
          <p className="section-desc reveal reveal-delay-2">
            Watch how TransChap moves every sale — you stay in control with a single tap
            while conversation, payment, and delivery run themselves.
          </p>
        </div>

        <div
          className={`journey-layout reveal reveal-delay-2${isRunning ? " is-running" : ""}`}
          data-active={activeIndex}
        >
          <div className="journey-stages" role="tablist" aria-label="Order steps">
            {STAGES.map((stage, i) => (
              <button
                key={stage.id}
                type="button"
                role="tab"
                aria-selected={activeIndex === i}
                className={`journey-stage${activeIndex === i ? " is-active" : ""}${activeIndex > i ? " is-done" : ""}`}
                onClick={() => setActiveIndex(i)}
              >
                <span className="journey-stage-icon" aria-hidden="true">
                  {stage.icon}
                </span>
                <span className="journey-stage-label">{stage.label}</span>
                <span className="journey-stage-title">{stage.title}</span>
              </button>
            ))}
            <div className="journey-progress-track" aria-hidden="true">
              <div
                className="journey-progress-fill"
                style={{
                  width: `${((activeIndex + 1) / STAGES.length) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="journey-visual">
            <div className="journey-visual-glow" aria-hidden="true" />
            <div className="journey-phone">
              <div className="journey-phone-notch" aria-hidden="true" />
              <div className="journey-phone-screen">
                {STAGES.map((stage, i) => (
                  <div
                    key={stage.id}
                    className={`journey-panel journey-panel--${stage.panel}${activeIndex === i ? " is-visible" : ""}`}
                    aria-hidden={activeIndex !== i}
                  >
                    {stage.panel === "chat" && <JourneyChatPanel />}
                    {stage.panel === "order" && <JourneyOrderPanel />}
                    {stage.panel === "pay" && <JourneyPayPanel />}
                    {stage.panel === "tap" && <JourneyTapPanel />}
                    {stage.panel === "deliver" && <JourneyDeliverPanel />}
                  </div>
                ))}
              </div>
            </div>

            <div className="journey-caption">
              <span className="journey-caption-step">{active.label}</span>
              <h3>{active.title}</h3>
              <p>{active.desc}</p>
            </div>
          </div>
        </div>

        <div className="journey-pills reveal reveal-delay-3">
          <span className="journey-pill">Instagram & WhatsApp</span>
          <span className="journey-pill">M-Pesa matched</span>
          <span className="journey-pill">One-tap approve</span>
          <span className="journey-pill">Rider coordinated</span>
        </div>
      </div>
    </section>
  );
}

function JourneyChatPanel() {
  return (
    <div className="jp-chat">
      <div className="jp-chat-header">
        <span className="jp-ig-icon">IG</span>
        <span>Amina&apos;s Boutique</span>
      </div>
      <div className="jp-bubble jp-bubble--in jp-anim-1">
        Hi, do you have the red dress in M?
      </div>
      <div className="jp-bubble jp-bubble--out jp-anim-2">
        Yes! Red Wrap Dress, M — KSh 2,500. Place order?
      </div>
      <div className="jp-bubble jp-bubble--in jp-anim-3">
        Yes, deliver to Westlands
      </div>
      <div className="jp-typing jp-anim-4">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function JourneyOrderPanel() {
  return (
    <div className="jp-order">
      <div className="jp-order-card">
        <div className="jp-order-row">
          <span>Red Wrap Dress · M</span>
          <strong>KSh 2,500</strong>
        </div>
        <div className="jp-order-row">
          <span>Delivery · Westlands</span>
          <strong>KSh 200</strong>
        </div>
        <div className="jp-order-total">
          <span>Total</span>
          <strong>KSh 2,700</strong>
        </div>
      </div>
      <div className="jp-order-status jp-anim-pulse">Order confirmed ✓</div>
    </div>
  );
}

function JourneyPayPanel() {
  return (
    <div className="jp-pay">
      <div className="jp-mpesa">
        <span className="jp-mpesa-logo">M-PESA</span>
        <p>Payment request</p>
        <strong className="jp-mpesa-amount">KSh 2,700</strong>
        <span className="jp-mpesa-ref">Ref: DUK-2847</span>
      </div>
      <div className="jp-pay-done jp-anim-slide">
        <span className="jp-pay-check">✓</span>
        Payment received
      </div>
    </div>
  );
}

function JourneyTapPanel() {
  return (
    <div className="jp-tap">
      <div className="jp-notif">
        <span className="jp-notif-badge">TransChap</span>
        <p>New order · Jane Wanjiku</p>
        <span className="jp-notif-meta">Red Wrap Dress · KSh 2,700 · PAID</span>
      </div>
      <div className="jp-tap-actions">
        <button type="button" className="jp-btn-decline">
          Decline
        </button>
        <button type="button" className="jp-btn-accept jp-anim-tap">
          Accept order
        </button>
      </div>
    </div>
  );
}

function JourneyDeliverPanel() {
  return (
    <div className="jp-deliver">
      <div className="jp-map">
        <div className="jp-map-route" />
        <span className="jp-map-pin jp-map-pin--a">🏪</span>
        <span className="jp-map-pin jp-map-pin--b jp-anim-bounce">📍</span>
        <span className="jp-rider jp-anim-ride">🏍️</span>
      </div>
      <div className="jp-delivered jp-anim-pop">
        <span>✓</span> Delivered to Westlands
      </div>
    </div>
  );
}

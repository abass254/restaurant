"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    id: "dm",
    label: "01 · Message",
    title: "Customer DMs your shop",
    desc: "Instagram or WhatsApp — English, Swahili, or Sheng.",
    scene: "dm" as const,
  },
  {
    id: "order",
    label: "02 · Order",
    title: "AI captures the order",
    desc: "Items, sizes, delivery address, and total — confirmed in chat.",
    scene: "order" as const,
  },
  {
    id: "pay",
    label: "03 · Pay",
    title: "M-Pesa matched automatically",
    desc: "Payment prompt sent and linked to the right order.",
    scene: "pay" as const,
  },
  {
    id: "approve",
    label: "04 · Approve",
    title: "You tap once",
    desc: "Accept or decline from a single notification.",
    scene: "approve" as const,
  },
  {
    id: "deliver",
    label: "05 · Deliver",
    title: "Rider on the way",
    desc: "Customer updated. Order delivered to their door.",
    scene: "deliver" as const,
  },
];

const CYCLE_MS = 3500;

export function ProcessShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const container = stepsRef.current;
    const tab = container?.querySelector<HTMLButtonElement>(
      `#process-tab-${STEPS[active].id}`,
    );
    if (!container || !tab) return;

    tab.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [active]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setRunning(true);
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRunning(true);
          timer = setInterval(() => {
            setActive((i) => (i + 1) % STEPS.length);
          }, CYCLE_MS);
        } else {
          setRunning(false);
          if (timer) clearInterval(timer);
        }
      },
      { threshold: 0.2 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearInterval(timer);
    };
  }, []);

  const step = STEPS[active];

  return (
    <section
      ref={sectionRef}
      className="process-showcase"
      id="how-it-works"
      aria-label="How DukAI processes orders"
    >
      <div className="process-showcase__inner">
        <div className="section-header reveal">
          <span className="section-tag">How it works</span>
          <h2>From DM to delivered order</h2>
          <p>
            Watch how DukAI moves every sale — conversation, payment, and delivery
            on autopilot while you stay in control with one tap.
          </p>
        </div>

        <div
          className={`process-showcase__layout${running ? " is-running" : ""}`}
          data-step={active}
        >
          <div className="process-steps-wrap">
            <div
              ref={stepsRef}
              className="process-steps"
              role="tablist"
              aria-label="Order steps"
            >
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`process-tab-${s.id}`}
                  aria-controls={`process-panel-${s.id}`}
                  aria-selected={active === i}
                  tabIndex={active === i ? 0 : -1}
                  className={`process-step${active === i ? " is-active" : ""}${active > i ? " is-done" : ""}`}
                  onClick={() => setActive(i)}
                >
                  <span className="process-step__num">{s.label}</span>
                  <span className="process-step__title">{s.title}</span>
                </button>
              ))}
            </div>
            <div className="process-progress" aria-hidden="true">
              <div
                className="process-progress__fill"
                style={{ width: `${((active + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          <div
            className="process-visual"
            role="tabpanel"
            id={`process-panel-${step.id}`}
            aria-labelledby={`process-tab-${step.id}`}
          >
            <div className="process-visual__glow" aria-hidden="true" />
            <div className="process-phone">
              <div className="process-phone__notch" aria-hidden="true" />
              <div className="process-phone__screen">
                {STEPS.map((s, i) => (
                  <div
                    key={s.id}
                    className={`process-scene process-scene--${s.scene}${active === i ? " is-visible" : ""}`}
                    aria-hidden={active !== i}
                  >
                    {s.scene === "dm" && <SceneDM />}
                    {s.scene === "order" && <SceneOrder />}
                    {s.scene === "pay" && <ScenePay />}
                    {s.scene === "approve" && <SceneApprove />}
                    {s.scene === "deliver" && <SceneDeliver />}
                  </div>
                ))}
              </div>
            </div>
            <div className="process-caption">
              <span className="process-caption__tag">{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          </div>
        </div>

        <div className="process-pills reveal">
          <span>Instagram & WhatsApp</span>
          <span>M-Pesa matched</span>
          <span>One-tap approve</span>
          <span>Rider coordinated</span>
        </div>
      </div>
    </section>
  );
}

function SceneDM() {
  return (
    <div className="scene-dm">
      <div className="scene-dm__header">
        <span className="scene-dm__ig">IG</span>
        <span>Amina&apos;s Boutique</span>
      </div>
      <div className="scene-bubble scene-bubble--in scene-anim-1">
        Hi, do you have the red dress in M?
      </div>
      <div className="scene-bubble scene-bubble--out scene-anim-2">
        Yes! Red Wrap Dress, M — KSh 2,500. Shall I place an order?
      </div>
      <div className="scene-bubble scene-bubble--in scene-anim-3">
        Yes please, deliver to Westlands
      </div>
      <div className="scene-typing scene-anim-4">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function SceneOrder() {
  return (
    <div className="scene-order">
      <div className="scene-order__card">
        <div className="scene-order__row">
          <span>Red Wrap Dress · M</span>
          <strong>KSh 2,500</strong>
        </div>
        <div className="scene-order__row">
          <span>Delivery · Westlands</span>
          <strong>KSh 200</strong>
        </div>
        <div className="scene-order__total">
          <span>Total</span>
          <strong>KSh 2,700</strong>
        </div>
      </div>
      <div className="scene-order__badge scene-anim-pulse">Order confirmed ✓</div>
    </div>
  );
}

function ScenePay() {
  return (
    <div className="scene-pay">
      <div className="scene-mpesa">
        <span className="scene-mpesa__logo">M-PESA</span>
        <p>Payment request</p>
        <strong className="scene-mpesa__amt">KSh 2,700</strong>
        <span className="scene-mpesa__ref">Ref: DUK-2847</span>
      </div>
      <div className="scene-pay__done scene-anim-slide">
        <span className="scene-pay__check">✓</span>
        Payment received
      </div>
    </div>
  );
}

function SceneApprove() {
  return (
    <div className="scene-approve">
      <div className="scene-notif">
        <span className="scene-notif__badge">DukAI</span>
        <p>New order · Jane Wanjiku</p>
        <span className="scene-notif__meta">Red Wrap Dress · KSh 2,700 · PAID</span>
      </div>
      <div className="scene-approve__actions">
        <span className="scene-btn scene-btn--ghost">Decline</span>
        <span className="scene-btn scene-btn--primary scene-anim-tap">Accept order</span>
      </div>
    </div>
  );
}

function SceneDeliver() {
  return (
    <div className="scene-deliver">
      <div className="scene-map">
        <svg className="scene-map__svg" viewBox="0 0 200 120" aria-hidden="true">
          <path
            className="scene-map__route"
            d="M30 90 Q80 40 120 55 T170 35"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray="6 4"
          />
        </svg>
        <span className="scene-map__shop">🏪</span>
        <span className="scene-map__pin scene-anim-bounce">📍</span>
        <span className="scene-map__rider scene-anim-ride">🏍️</span>
      </div>
      <div className="scene-deliver__done scene-anim-pop">
        <span>✓</span> Delivered to Westlands
      </div>
    </div>
  );
}

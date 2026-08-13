"use client";

import { useState } from "react";

type Tab = "sequence" | "system" | "navigation" | "screens";

const SCREENS = [
  { id: 1, name: "Splash / Auth Gate", purpose: "Restore session and route rider.", features: ["Token restore", "Deep-link parse", "Route decision"] },
  { id: 2, name: "Invite Acceptance", purpose: "Join merchant fleet via invite token.", features: ["Merchant context", "Name/phone confirm", "Join action"] },
  { id: 3, name: "Permissions Primer", purpose: "Collect OS permissions.", features: ["Notifications", "Location", "Retry path"] },
  { id: 4, name: "Active Deliveries", purpose: "List assigned active jobs.", features: ["Status badges", "Pull refresh", "Empty state"] },
  { id: 5, name: "Delivery Detail", purpose: "Full order context and actions.", features: ["Customer/contact", "Items + notes", "Dispatch CTA"] },
  { id: 6, name: "Navigation", purpose: "Guide rider to destination.", features: ["Map preview", "External maps", "Pickup/drop"] },
  { id: 7, name: "Confirm Delivery", purpose: "Complete handoff.", features: ["Final CTA", "Conflict retry", "Done state"] },
  { id: 8, name: "Profile", purpose: "Rider identity and session.", features: ["Rider details", "Merchant link", "Logout"] },
  { id: 9, name: "Blocked / Error", purpose: "Recover from failures.", features: ["Expired invite", "No network", "Suspended"] },
] as const;

function SequenceDiagram() {
  const w = 920;
  const h = 520;
  const actors = [
    { id: "merchant", label: "Merchant", x: 50 },
    { id: "sms", label: "SMS / WhatsApp", x: 175 },
    { id: "rider", label: "Rider", x: 310 },
    { id: "store", label: "App Store", x: 430 },
    { id: "app", label: "Rider App", x: 560 },
    { id: "api", label: "FastAPI", x: 720 },
  ];

  const lifelineTop = 56;
  const lifelineBottom = h - 24;

  type Msg = { from: number; to: number; y: number; label: string; dashed?: boolean };
  const messages: Msg[] = [
    { from: 0, to: 5, y: 78, label: "POST /riders (name, phone)" },
    { from: 5, to: 0, y: 98, label: "invite_url", dashed: true },
    { from: 0, to: 1, y: 118, label: "Send link" },
    { from: 2, to: 4, y: 148, label: "Tap link (universal link)" },
    { from: 4, to: 3, y: 218, label: "Deferred deep link" },
    { from: 2, to: 3, y: 238, label: "Install app" },
    { from: 3, to: 4, y: 258, label: "Open with invite token" },
    { from: 4, to: 5, y: 318, label: "GET /riders/join/{token}" },
    { from: 4, to: 5, y: 342, label: "POST /riders/join/{token}" },
    { from: 5, to: 4, y: 366, label: "rider profile + mobile tokens", dashed: true },
    { from: 4, to: 2, y: 402, label: "Active deliveries home" },
  ];

  function arrow(m: Msg) {
    const x1 = actors[m.from].x + 52;
    const x2 = actors[m.to].x + 52;
    const mid = (x1 + x2) / 2;
    return (
      <g key={`${m.from}-${m.to}-${m.y}`}>
        <line
          x1={x1}
          y1={m.y}
          x2={x2}
          y2={m.y}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray={m.dashed ? "5 4" : undefined}
          markerEnd={m.dashed ? "url(#seqArrowDashed)" : "url(#seqArrow)"}
          opacity={0.9}
        />
        <text x={mid} y={m.y - 5} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.85}>
          {m.label}
        </text>
      </g>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      className="rider-diagram-svg"
      role="img"
      aria-label="Invite to delivery sequence diagram"
    >
      <defs>
        <marker id="seqArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
        <marker id="seqArrowDashed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity={0.7} />
        </marker>
      </defs>

      {actors.map((a) => (
        <g key={a.id}>
          <rect x={a.x} y={12} width={104} height={32} rx={6} className="rider-diagram-actor" />
          <text x={a.x + 52} y={32} textAnchor="middle" fontSize={11} fontWeight={600}>
            {a.label}
          </text>
          <line
            x1={a.x + 52}
            y1={lifelineTop}
            x2={a.x + 52}
            y2={lifelineBottom}
            stroke="currentColor"
            strokeDasharray="4 4"
            opacity={0.35}
          />
        </g>
      ))}

      <rect x={280} y={188} width={360} height={88} rx={6} className="rider-diagram-alt" />
      <text x={292} y={204} fontSize={10} fontWeight={700} opacity={0.8}>
        alt — App not installed
      </text>

      {messages.map(arrow)}
    </svg>
  );
}

function SystemFlowDiagram() {
  return (
    <svg viewBox="0 0 900 220" width="100%" className="rider-diagram-svg" role="img" aria-label="System architecture flow">
      <defs>
        <marker id="sysArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>

      <rect x={24} y={48} width={200} height={72} rx={10} className="rider-diagram-box" />
      <text x={124} y={78} textAnchor="middle" fontSize={13} fontWeight={700}>Merchant Web</text>
      <text x={124} y={98} textAnchor="middle" fontSize={11} opacity={0.75}>Invite + share link</text>

      <rect x={340} y={28} width={200} height={72} rx={10} className="rider-diagram-box rider-diagram-box--accent" />
      <text x={440} y={58} textAnchor="middle" fontSize={13} fontWeight={700}>FastAPI</text>
      <text x={440} y={78} textAnchor="middle" fontSize={11} opacity={0.75}>Rider API + mobile auth</text>

      <rect x={340} y={120} width={200} height={48} rx={10} className="rider-diagram-box" />
      <text x={440} y={150} textAnchor="middle" fontSize={12}>Push service</text>

      <rect x={656} y={48} width={200} height={72} rx={10} className="rider-diagram-box" />
      <text x={756} y={78} textAnchor="middle" fontSize={13} fontWeight={700}>Rider App</text>
      <text x={756} y={98} textAnchor="middle" fontSize={11} opacity={0.75}>Onboard + deliver</text>

      <path d="M 224 84 C 270 84, 300 64, 340 64" fill="none" stroke="currentColor" strokeWidth={2} markerEnd="url(#sysArrow)" />
      <path d="M 540 64 C 590 64, 620 84, 656 84" fill="none" stroke="currentColor" strokeWidth={2} markerEnd="url(#sysArrow)" />
      <path d="M 540 144 C 590 144, 620 110, 656 96" fill="none" stroke="currentColor" strokeWidth={2} markerEnd="url(#sysArrow)" />
    </svg>
  );
}

function NavigationFlowDiagram() {
  const nodes = [
    { id: "splash", label: "Splash", x: 60, y: 40 },
    { id: "invite", label: "Invite", x: 200, y: 40 },
    { id: "perms", label: "Permissions", x: 360, y: 40 },
    { id: "home", label: "Deliveries", x: 520, y: 40 },
    { id: "detail", label: "Detail", x: 680, y: 40 },
    { id: "nav", label: "Navigation", x: 600, y: 130 },
    { id: "confirm", label: "Confirm", x: 760, y: 130 },
    { id: "profile", label: "Profile", x: 520, y: 130 },
    { id: "error", label: "Error", x: 200, y: 130 },
  ];

  const edges = [
    ["splash", "invite"],
    ["splash", "home"],
    ["invite", "perms"],
    ["perms", "home"],
    ["home", "detail"],
    ["detail", "nav"],
    ["detail", "confirm"],
    ["home", "profile"],
    ["invite", "error"],
  ] as const;

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <svg viewBox="0 0 900 200" width="100%" className="rider-diagram-svg" role="img" aria-label="Screen navigation flow">
      <defs>
        <marker id="navArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map(([from, to]) => {
        const a = byId[from];
        const b = byId[to];
        const x1 = a.x + 56;
        const y1 = a.y + 24;
        const x2 = b.x + 56;
        const y2 = b.y + 24;
        return (
          <line
            key={`${from}-${to}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth={1.5}
            opacity={0.5}
            markerEnd="url(#navArrow)"
          />
        );
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={112} height={48} rx={8} className="rider-diagram-box" />
          <text x={n.x + 56} y={n.y + 28} textAnchor="middle" fontSize={12} fontWeight={600}>
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function RiderArchitecturePresentation() {
  const [tab, setTab] = useState<Tab>("sequence");

  const tabs: { id: Tab; label: string }[] = [
    { id: "sequence", label: "Sequence" },
    { id: "system", label: "System flow" },
    { id: "navigation", label: "Navigation" },
    { id: "screens", label: "9 screens" },
  ];

  return (
    <div className="rider-arch-presentation">
      <div className="rider-arch-tabs" role="tablist" aria-label="Diagram views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "is-active" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sequence" ? (
        <section className="rider-arch-panel" aria-label="Sequence diagram">
          <h2>Invite → download → login sequence</h2>
          <p>End-to-end rider onboarding from merchant invite through first deliveries screen.</p>
          <div className="rider-arch-diagram-wrap">
            <SequenceDiagram />
          </div>
        </section>
      ) : null}

      {tab === "system" ? (
        <section className="rider-arch-panel" aria-label="System flow">
          <h2>System architecture</h2>
          <p>Merchant web, FastAPI backend, push service, and native rider app.</p>
          <div className="rider-arch-diagram-wrap">
            <SystemFlowDiagram />
          </div>
        </section>
      ) : null}

      {tab === "navigation" ? (
        <section className="rider-arch-panel" aria-label="Navigation flow">
          <h2>Screen navigation map</h2>
          <p>How riders move between the 9 MVP screens during onboarding and delivery.</p>
          <div className="rider-arch-diagram-wrap">
            <NavigationFlowDiagram />
          </div>
        </section>
      ) : null}

      {tab === "screens" ? (
        <section className="rider-arch-panel" aria-label="Nine screens">
          <h2>Ideal 9 MVP screens</h2>
          <p>Each screen with purpose and core features.</p>
          <div className="rider-arch-screens-grid">
            {SCREENS.map((s) => (
              <article key={s.id} className="rider-screen-card">
                <h3>
                  <span>{s.id}.</span> {s.name}
                </h3>
                <p>{s.purpose}</p>
                <ul>
                  {s.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

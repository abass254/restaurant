// Centralised motion vocabulary for the merchant app.
//
// One file, one set of springs/durations/variants so the whole platform
// breathes with the same rhythm. If a motion ever feels off, tune it here
// rather than chasing the value across components.
//
// The aesthetic target: "expressive" — 280–420ms transitions, gentle
// overshoot on enter, faster crisp exits, all respecting
// `prefers-reduced-motion`.

import type { Transition, Variants } from "motion/react";

// ── Easings ─────────────────────────────────────────────────────────────────
// Cubic-bezier presets paired with the brand. `easeOutExpressive` is the
// workhorse for entrances; `easeInOutSilk` for layout shifts; `springSoft`
// adds the touch of overshoot you can feel but not name.

export const easeOutExpressive: [number, number, number, number] = [
  0.22, 1, 0.36, 1,
];
export const easeInOutSilk: [number, number, number, number] = [
  0.65, 0, 0.35, 1,
];
export const easeOutBack: [number, number, number, number] = [
  0.34, 1.56, 0.64, 1,
];

export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.9,
};

export const springSnap: Transition = {
  type: "spring",
  stiffness: 480,
  damping: 36,
  mass: 0.7,
};

export const springSlow: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
  mass: 1,
};

// ── Durations ──────────────────────────────────────────────────────────────

export const duration = {
  micro: 0.16,
  base: 0.24,
  expressive: 0.36,
  scene: 0.45,
} as const;

// ── Page transition variants ───────────────────────────────────────────────
// Used by <PageTransition>. Enter rises a touch and fades, exit drops a touch.
// `when: "beforeChildren"` lets nested staggered lists feel like they're
// arriving as a single piece.

export const pageVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 14,
    scale: 0.985,
    filter: "blur(6px)",
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      duration: duration.expressive,
      ease: easeOutExpressive,
      when: "beforeChildren",
    },
  },
  exiting: {
    opacity: 0,
    y: -8,
    scale: 0.99,
    filter: "blur(4px)",
    transition: {
      duration: duration.base,
      ease: easeInOutSilk,
    },
  },
};

// ── Stagger list variants ──────────────────────────────────────────────────
// Drop `staggerContainer` on a parent and `staggerItem` on each child to
// get a coordinated cascade in. Tweak `staggerChildren` for density.

export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.04,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springSoft,
  },
};

// ── Hover / press micro-interactions ───────────────────────────────────────
// Use on cards/tiles that already have a shadow. The lift is intentionally
// small — anything bigger fights with the box-shadow and looks cheap.

export const liftHover = {
  whileHover: { y: -3, transition: { duration: duration.micro, ease: easeOutExpressive } },
  whileTap: { y: 0, scale: 0.985, transition: { duration: 0.08 } },
};

export const buttonPress = {
  whileTap: { scale: 0.96, transition: { duration: 0.08 } },
};

// ── Modal / drawer ─────────────────────────────────────────────────────────

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: duration.base, ease: easeOutExpressive },
  },
  exiting: {
    opacity: 0,
    transition: { duration: duration.micro, ease: easeInOutSilk },
  },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springSoft,
  },
  exiting: {
    opacity: 0,
    y: 12,
    scale: 0.98,
    transition: { duration: duration.base, ease: easeInOutSilk },
  },
};

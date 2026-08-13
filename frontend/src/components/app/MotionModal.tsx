"use client";

// Reusable motion-driven modal.
//
// Everything in the merchant app goes through this so the open/close motion
// stays consistent: backdrop fades, panel scales-and-rises in with a small
// overshoot, and both run in reverse on close (instead of vanishing).
//
// What it adds on top of the bare `<div className="inventory-modal-backdrop">`
// pattern that pages used to roll by hand:
//   • smooth EXIT animation (via AnimatePresence)
//   • body-scroll lock while open
//   • Esc-to-close
//   • respects prefers-reduced-motion (simple cross-fade)
//
// Pages keep their own DOM inside; this just provides the chrome.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  backdropVariants,
  modalVariants,
  duration,
} from "@/lib/motion";

export type MotionModalProps = {
  open: boolean;
  onClose: () => void;
  /** Optional aria label for the dialog. Use `ariaLabelledBy` if you have
   *  a visible heading instead. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Extra class(es) appended to `.inventory-modal` (the panel). */
  panelClassName?: string;
  /** If true, clicking the backdrop won't close the modal. Use for
   *  destructive/long-running operations where an accidental dismiss
   *  would lose user work. */
  closeOnBackdrop?: boolean;
  /** Same as above for the Esc key. */
  closeOnEscape?: boolean;
  children: React.ReactNode;
};

export function MotionModal({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  panelClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
}: MotionModalProps) {
  const reduce = useReducedMotion();

  // Portal target. We render into <body> so the modal escapes any ancestor
  // that establishes a containing block for `position: fixed` (e.g. the page
  // transition wrapper sets `transform`/`filter`/`will-change`, which would
  // otherwise trap the backdrop inside the content area and shift it down by
  // the topbar height instead of centering on the real viewport).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Esc to close.
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeOnEscape]);

  // Body scroll lock — the modal already covers the viewport, but locking
  // prevents the page underneath from scrolling when the user wheels over
  // a non-scrollable patch of the modal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reduced-motion users get a fast cross-fade with no movement/scale.
  const _backdropVariants = reduce
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.12 } },
        exiting: { opacity: 0, transition: { duration: 0.1 } },
      }
    : backdropVariants;

  const _modalVariants = reduce
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.15 } },
        exiting: { opacity: 0, transition: { duration: duration.micro } },
      }
    : modalVariants;

  const panelCls = ["inventory-modal", panelClassName].filter(Boolean).join(" ");

  if (!mounted) return null;

  // The modal CSS is scoped under `.fb-app`, but the portal lands on <body>
  // (outside that wrapper). Re-introduce the scope with `display: contents`
  // so the selectors match again without the wrapper generating a box — a
  // real box would paint `.fb-app`'s full-height background over the page.
  return createPortal(
    <div className="fb-app" style={{ display: "contents" }}>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="backdrop"
            className="inventory-modal-backdrop motion-modal-backdrop"
            role="presentation"
            variants={_backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exiting"
            onClick={closeOnBackdrop ? onClose : undefined}
          >
            <motion.div
              className={panelCls}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabelledBy ? undefined : ariaLabel}
              aria-labelledby={ariaLabelledBy}
              variants={_modalVariants}
              // Inherit initial/animate/exit from the parent backdrop so the two
              // stay in lockstep without a double-trigger.
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

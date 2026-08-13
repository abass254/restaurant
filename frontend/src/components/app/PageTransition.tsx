"use client";

// Wraps the dashboard's route content so that switching pages feels like a
// scene change instead of a hard cut. AnimatePresence + a pathname-keyed
// inner element drive the in/out cycle.

import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { finishNavigationLoading } from "@/lib/alerts";
import { pageVariants } from "@/lib/motion";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  // Reduced-motion users still get a soft cross-fade, but no movement, scale,
  // or blur. The route key is what tells AnimatePresence "this is a new page".
  const variants = reduce
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.15 } },
        exiting: { opacity: 0, transition: { duration: 0.1 } },
      }
    : pageVariants;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="page-transition"
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exiting"
        onAnimationComplete={(definition) => {
          if (definition === "visible") {
            finishNavigationLoading();
          }
        }}
        // Hint the compositor — we're animating transform/opacity/filter.
        style={{ willChange: "transform, opacity, filter" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

"use client";

// Tiny ergonomic wrappers around motion's variants for staggered list/grid
// entrances. Use like:
//
//   <MotionList as="div" className="dashboard-tiles">
//     {tiles.map((t) => (
//       <MotionItem as="article" key={t.id}>…</MotionItem>
//     ))}
//   </MotionList>

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import {
  staggerContainer,
  staggerItem,
  duration,
  easeOutExpressive,
} from "@/lib/motion";

type ContainerTag = "div" | "ul" | "ol" | "section" | "nav";
type ItemTag = "div" | "li" | "article" | "section";

type ListProps = HTMLMotionProps<"div"> & {
  as?: ContainerTag;
  /** Override the per-child delay; useful when batches of items arrive at
   *  different times (e.g. infinite scroll). */
  staggerChildren?: number;
};

export function MotionList({
  as = "div",
  staggerChildren,
  children,
  ...rest
}: ListProps) {
  const reduce = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  if (reduce) {
    return <Tag {...rest}>{children}</Tag>;
  }

  return (
    <Tag
      {...rest}
      variants={{
        ...staggerContainer,
        visible: {
          ...staggerContainer.visible,
          transition: {
            ...(typeof staggerContainer.visible === "object" &&
            "transition" in staggerContainer.visible
              ? staggerContainer.visible.transition
              : {}),
            staggerChildren: staggerChildren ?? 0.045,
          },
        },
      }}
      initial="hidden"
      animate="visible"
    >
      {children}
    </Tag>
  );
}

type ItemProps = HTMLMotionProps<"div"> & {
  as?: ItemTag;
};

export function MotionItem({ as = "div", children, ...rest }: ItemProps) {
  const reduce = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  if (reduce) {
    return <Tag {...rest}>{children}</Tag>;
  }

  return (
    <Tag variants={staggerItem} {...rest}>
      {children}
    </Tag>
  );
}

// Fade-in for single elements that aren't part of a list — useful when an
// error banner appears or a section reveals after loading.
type FadeProps = HTMLMotionProps<"div"> & { as?: ItemTag; delay?: number };

export function MotionFade({
  as = "div",
  delay = 0,
  children,
  ...rest
}: FadeProps) {
  const reduce = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  if (reduce) {
    return <Tag {...rest}>{children}</Tag>;
  }

  return (
    <Tag
      {...rest}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.base, ease: easeOutExpressive, delay }}
    >
      {children}
    </Tag>
  );
}

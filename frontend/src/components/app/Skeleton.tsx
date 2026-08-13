"use client";

// Skeletons for loading states. Three shapes cover ~everything we render:
// rectangles for thumbnails/cards, lines for text, and circles for avatars.
// The shimmer comes from a CSS gradient sliding across via @keyframes; the
// component just sets dimensions.

type SkeletonProps = {
  /** "text" inherits height from font-size; the rest are explicit. */
  variant?: "text" | "rect" | "circle";
  width?: number | string;
  height?: number | string;
  className?: string;
  /** Use on the last line of a paragraph to look natural. */
  short?: boolean;
};

export function Skeleton({
  variant = "text",
  width,
  height,
  className,
  short,
}: SkeletonProps) {
  const cls = [
    "skeleton",
    `skeleton--${variant}`,
    short ? "skeleton--short" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={cls}
      aria-hidden="true"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}

// Convenience: a stacked block of skeleton lines.
type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
};

export function Spinner({
  size = "md",
  label = "Loading",
  className,
}: SpinnerProps) {
  return (
    <span
      className={["spinner", `spinner--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={label}
    >
      <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
    </span>
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span
      className={["skeleton-stack", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} variant="text" short={i === lines - 1} />
      ))}
    </span>
  );
}

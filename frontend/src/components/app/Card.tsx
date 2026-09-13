import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type CardOwnProps<T extends ElementType> = {
  as?: T;
  /**
   * `solid` — 12px padding on the shell (default).
   * `split` — no shell padding; use CardHeader + CardBody instead.
   */
  variant?: "solid" | "split";
  className?: string;
  children?: ReactNode;
};

export type CardProps<T extends ElementType = "article"> = CardOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof CardOwnProps<T>>;

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Shared surface card — uses `--space-card` inset by default. */
export function Card<T extends ElementType = "article">({
  as,
  variant = "solid",
  className,
  children,
  ...rest
}: CardProps<T>) {
  const Tag = as ?? "article";
  return (
    <Tag
      className={joinClassNames(
        "app-card",
        variant === "solid" && "app-card--pad",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export type CardHeaderProps = ComponentPropsWithoutRef<"header">;

export function CardHeader({ className, ...rest }: CardHeaderProps) {
  return <header className={joinClassNames("app-card__header", className)} {...rest} />;
}

export type CardBodyProps = ComponentPropsWithoutRef<"div">;

export function CardBody({ className, ...rest }: CardBodyProps) {
  return <div className={joinClassNames("app-card__body", className)} {...rest} />;
}

export type CardTitleProps = ComponentPropsWithoutRef<"h2">;

export function CardTitle({ className, ...rest }: CardTitleProps) {
  return <h2 className={joinClassNames("app-card__title", className)} {...rest} />;
}

export type CardSubtitleProps = ComponentPropsWithoutRef<"p">;

export function CardSubtitle({ className, ...rest }: CardSubtitleProps) {
  return <p className={joinClassNames("app-card__subtitle", className)} {...rest} />;
}

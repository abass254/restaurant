import Image from "next/image";

type Props = {
  /** Kept for callers; the hero is now a photo, so the label only names it for assistive tech. */
  label?: string;
  children?: React.ReactNode;
};

export function AuthHeroPanel({ label = "MERCHANTS", children }: Props) {
  const word = label.trim().toUpperCase() || "MERCHANTS";

  return (
    <aside className="auth-split__hero" aria-hidden={children ? undefined : "true"}>
      <Image
        className="auth-split__photo"
        src="/images/auth-hero-kenyan-diners.jpg"
        alt={`${word}: a group of Kenyan friends sharing a meal at a restaurant`}
        fill
        priority
        sizes="(max-width: 900px) 0px, 40vw"
      />
      <div className="auth-split__photo-shade" />
      {children}
    </aside>
  );
}

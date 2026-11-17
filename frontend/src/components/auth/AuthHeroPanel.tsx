import Image from "next/image";

type Props = {
  /** Kept for callers; the hero is a photo, so the label only names it for assistive tech. */
  label?: string;
  children?: React.ReactNode;
};

export function AuthHeroPanel({ label = "MERCHANTS", children }: Props) {
  const word = label.trim().toUpperCase() || "MERCHANTS";

  return (
    <aside className="auth-split__hero auth-split__hero--dishes" aria-hidden={children ? undefined : "true"}>
      <Image
        className="auth-split__photo"
        src="/images/auth-hero-dishes-v2.jpg"
        alt={`${word}: plated dishes from different cuisines on a restaurant table`}
        fill
        priority
        sizes="(max-width: 900px) 0px, 48vw"
      />
      <div className="auth-split__photo-shade" aria-hidden="true" />
      {children}
    </aside>
  );
}

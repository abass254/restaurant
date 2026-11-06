import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";

type StorefrontHeaderProps = {
  tag: string;
};

export function StorefrontHeader({ tag }: StorefrontHeaderProps) {
  return (
    <header className="sf-header">
      <div className="sf-brand-lockup" aria-label="TransChap">
        <TransChapLogoMark
          size={44}
          className="sf-brand-lockup__mark"
          color="var(--app-text)"
          accentColor="var(--brown-500, #25487a)"
        />
      </div>
      <span className="sf-header__tag">{tag}</span>
    </header>
  );
}

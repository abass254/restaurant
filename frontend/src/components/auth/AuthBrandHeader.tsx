import Link from "next/link";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";

type Props = {
  href?: string;
};

export function AuthBrandHeader({ href = "/sign-in" }: Props) {
  return (
    <div className="auth-split__brand">
      <Link href={href} className="auth-split__logo">
        <span className="auth-split__wordmark">duk</span>
        <DukAiLogoMark size={64} color="#1a100c" accentColor="#e85d04" />
        <span className="auth-split__wordmark">
          ai<span className="auth-split__tm">™</span>
        </span>
      </Link>
      <p className="auth-split__tagline">
        your retail <span>companion</span>
      </p>
    </div>
  );
}

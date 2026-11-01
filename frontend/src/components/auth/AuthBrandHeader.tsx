import Link from "next/link";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";

type Props = {
  href?: string;
};

export function AuthBrandHeader({ href = "/sign-in" }: Props) {
  return (
    <div className="auth-split__brand">
      <Link href={href} className="auth-split__logo">
        <TransChapLogoMark size={56} color="#20154c" accentColor="#77f665" />
        <span className="auth-split__wordmark">TransChap</span>
      </Link>
      <p className="auth-split__tagline">
        your retail <span>companion</span>
      </p>
    </div>
  );
}

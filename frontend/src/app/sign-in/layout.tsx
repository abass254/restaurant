import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — TransChap",
  description: "Sign in to your TransChap account.",
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}

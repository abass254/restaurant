import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — DukAI Merchants",
  description: "Sign in to your DukAI Merchants shop dashboard.",
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}

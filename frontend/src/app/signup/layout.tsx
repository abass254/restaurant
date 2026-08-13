import type { Metadata } from "next";
import "@/styles/auth.css";
import "@/styles/landing-ufanisi.css";

export const metadata: Metadata = {
  title: "Sign up — DukAI Merchants",
  description: "Create your DukAI Merchants account, then set up your shop.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}

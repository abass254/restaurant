import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot password — DukAI Merchants",
  description: "Request a password reset for your DukAI Merchants account.",
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

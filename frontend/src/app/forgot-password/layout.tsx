import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot password — TransChap",
  description: "Request a password reset for your TransChap account.",
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

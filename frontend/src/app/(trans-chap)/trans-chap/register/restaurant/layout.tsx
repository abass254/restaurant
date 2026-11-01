import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register your restaurant — TransChap",
  description: "Create a TransChap restaurant account.",
};

export default function RestaurantRegistrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

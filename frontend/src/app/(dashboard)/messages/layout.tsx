import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Messages — TransChap",
  description: "Customer Instagram direct messages",
};

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

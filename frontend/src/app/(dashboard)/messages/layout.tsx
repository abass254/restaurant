import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Messages — DukAI",
  description: "Customer Instagram direct messages",
};

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

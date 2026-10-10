import type { Metadata, Viewport } from "next";
import { TransChapMachineScript } from "@/components/trans-chap/TransChapMachineScript";
import "@/styles/station.css";
import "@/styles/app-dashboard.css";
import "@/styles/messages-chat.css";
import "@/styles/tickets-analytics.css";
import "@/styles/orders-pos.css";
import "@/styles/trans-chap.css";
import "@/styles/restaurant-supplies.css";

export const metadata: Metadata = {
  title: "Trans Chap",
  description: "Sales and receipts for DukAI merchants",
  manifest: "/trans-chap-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Trans Chap",
    // Draw under the iOS status bar so the header color fills to the top edge
    // (no black gap). Header already pads with env(safe-area-inset-top).
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      { url: "/icons/trans-chap-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#e8412a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function TransChapRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TransChapMachineScript />
      {children}
    </>
  );
}

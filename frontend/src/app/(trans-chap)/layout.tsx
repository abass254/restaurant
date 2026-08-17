import type { Metadata, Viewport } from "next";
import "@/styles/station.css";
import "@/styles/trans-chap.css";

export const metadata: Metadata = {
  title: "Trans Chap",
  description: "Sales and receipts for DukAI merchants",
  manifest: "/trans-chap-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Trans Chap",
    statusBarStyle: "default",
  },
  icons: {
    apple: [
      { url: "/icons/trans-chap-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#e85d04",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function TransChapRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

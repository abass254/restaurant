import type { Metadata, Viewport } from "next";
import "@/styles/rider-pwa.css";
import { RiderProvider } from "@/components/rider/RiderProvider";
import { RiderShell } from "@/components/rider/RiderShell";

export const metadata: Metadata = {
  title: "DukAI Rider",
  description: "Delivery rider app for DukAI merchant fleets",
  manifest: "/rider-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "DukAI Rider",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1a17",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return (
    <RiderProvider>
      <RiderShell>{children}</RiderShell>
    </RiderProvider>
  );
}

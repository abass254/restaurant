import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DevCompileLoading } from "@/components/app/DevCompileLoading";
import { NavigationClickLoading } from "@/components/app/NavigationClickLoading";
import { NavigationLoadingToast } from "@/components/app/NavigationLoadingToast";
import { PageLoadingBar } from "@/components/app/PageLoadingBar";
import { AnalyticsConsentProvider } from "@/components/consent/AnalyticsConsentProvider";
import { ThemeScript } from "@/components/landing/ThemeScript";
import "./globals.css";

export const metadata: Metadata = {
  title: "TransChap",
  description:
    "Sales, stock, and receipts for restaurants and retailers.",
  manifest: "/trans-chap-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TransChap",
  },
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/trans-chap-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/trans-chap-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/trans-chap-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  verification: {
    other: {
      "facebook-domain-verification": "8j8ji3wxgyi6cfu9wl2ima9cadysno",
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#0b2545",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body>
        <ThemeScript />
        <AnalyticsConsentProvider>
          <Suspense fallback={null}>
            <NavigationClickLoading />
            <PageLoadingBar />
            <NavigationLoadingToast />
            <DevCompileLoading />
            {children}
          </Suspense>
        </AnalyticsConsentProvider>
      </body>
    </html>
  );
}

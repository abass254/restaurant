import type { NextConfig } from "next";
import os from "os";
import { loadRootEnvFile } from "./loadRootEnv";

loadRootEnvFile();

/** Backend API (server-side proxy target only). Defaults to FastAPI. */
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:7001";

function lanDevOrigins(): string[] {
  const origins = new Set(["uat.dukai.app", "dukai.app", "127.0.0.1", "localhost"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        origins.add(addr.address);
      }
    }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanDevOrigins(),
  env: {
    // Expose shared root .env UPLOADS_PUBLIC_BASE_URL to the browser bundle.
    NEXT_PUBLIC_UPLOADS_PUBLIC_BASE_URL:
      process.env.NEXT_PUBLIC_UPLOADS_PUBLIC_BASE_URL ||
      process.env.UPLOADS_PUBLIC_BASE_URL ||
      "",
  },
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self)",
          },
        ],
      },
    ];
  },
  // @ffmpeg/ffmpeg loads core via blob URLs; avoid bundling Node polyfills.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
  async redirects() {
    return [
      {
        source: "/login",
        destination: "/sign-in",
        permanent: false,
      },
      {
        source: "/conversation-starters",
        destination: "/tools/starters",
        permanent: true,
      },
      {
        source: "/auto-reply",
        destination: "/tools/auto-reply",
        permanent: true,
      },
      {
        source: "/payments",
        destination: "/tools/payments",
        permanent: true,
      },
      {
        source: "/customers",
        destination: "/customer",
        permanent: true,
      },
      {
        source: "/customersd",
        destination: "/customer",
        permanent: false,
      },
      {
        source: "/suppliers",
        destination: "/supplier",
        permanent: true,
      },
      {
        source: "/setup-checklist",
        destination: "/tools/onboarding",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/test",
        destination: `${backendUrl}/test`,
      },
      {
        source: "/sanctum/:path*",
        destination: `${backendUrl}/sanctum/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/auth/:path*",
        destination: `${backendUrl}/auth/:path*`,
      },
      {
        source: "/instagram/callback",
        destination: `${backendUrl}/instagram/callback`,
      },
      {
        source: "/webhooks/:path*",
        destination: `${backendUrl}/webhooks/:path*`,
      },
      {
        source: "/mpesa/:path*",
        destination: `${backendUrl}/mpesa/:path*`,
      },
      {
        // Uploaded product photos/videos live on FastAPI's static mount.
        source: "/uploads/:path*",
        destination: `${backendUrl}/uploads/:path*`,
      },
      {
        source: "/robots.txt",
        destination: `${backendUrl}/robots.txt`,
      },
    ];
  },
};

export default nextConfig;

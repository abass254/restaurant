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
  turbopack: {
    root: __dirname,
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

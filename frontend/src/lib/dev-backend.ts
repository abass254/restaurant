import { spawn } from "node:child_process";
import path from "node:path";
import { backendUrl } from "@/lib/backend";

export function isDevBackendControlEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function backendProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function backendRunScript(): string {
  return path.join(backendProjectRoot(), "backend", "run.sh");
}

export async function isBackendHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${backendUrl}/up`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startBackendProcess(): Promise<
  "already_running" | "starting"
> {
  if (await isBackendHealthy()) {
    return "already_running";
  }

  const backendDir = path.join(backendProjectRoot(), "backend");
  const child = spawn("bash", ["./run.sh"], {
    cwd: backendDir,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return "starting";
}

import { NextResponse } from "next/server";
import {
  isBackendHealthy,
  isDevBackendControlEnabled,
} from "@/lib/dev-backend";

export const runtime = "nodejs";

export async function GET() {
  if (!isDevBackendControlEnabled()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const up = await isBackendHealthy();
  return NextResponse.json({ up });
}

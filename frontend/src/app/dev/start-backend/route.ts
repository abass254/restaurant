import { NextResponse } from "next/server";
import {
  isDevBackendControlEnabled,
  startBackendProcess,
} from "@/lib/dev-backend";

export const runtime = "nodejs";

export async function POST() {
  if (!isDevBackendControlEnabled()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  try {
    const status = await startBackendProcess();
    return NextResponse.json({ status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start the API server.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

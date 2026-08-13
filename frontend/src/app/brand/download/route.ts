import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("file");
  const forceDownload = request.nextUrl.searchParams.get("download") === "1";

  if (!relativePath) {
    return NextResponse.json({ error: "Missing file path." }, { status: 400 });
  }

  const projectRoot = path.resolve(process.cwd(), "..");
  const brandRoot = path.resolve(projectRoot, "brand");
  const requestedPath = path.resolve(brandRoot, relativePath);
  const isInsideBrandDir =
    requestedPath === brandRoot ||
    requestedPath.startsWith(`${brandRoot}${path.sep}`);

  if (!isInsideBrandDir) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }

  try {
    const data = await readFile(requestedPath);
    const ext = path.extname(requestedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const fileName = path.basename(requestedPath);
    const dispositionType = forceDownload ? "attachment" : "inline";

    return new NextResponse(data, {
      headers: {
        "Content-Disposition": `${dispositionType}; filename="${fileName}"`,
        "Content-Type": contentType,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}

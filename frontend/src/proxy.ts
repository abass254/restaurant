import { NextResponse, type NextRequest } from "next/server";

const TRANS_CHAP_PATH = "/trans-chap";
const SHARED_AUTH_PATHS = [
  "/change-password",
  "/forgot-password",
  "/reset-password",
];
const BACKEND_PATHS = [
  "/api",
  "/auth",
  "/instagram/callback",
  "/mpesa",
  "/sanctum",
  "/test",
  "/uploads",
  "/webhooks",
];

function isWithinPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isWithinPath(pathname, TRANS_CHAP_PATH)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(TRANS_CHAP_PATH.length) || "/";
    return NextResponse.redirect(url);
  }

  if (
    SHARED_AUTH_PATHS.some((path) => isWithinPath(pathname, path)) ||
    (pathname !== "/mpesa" &&
      BACKEND_PATHS.some((path) => isWithinPath(pathname, path)))
  ) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname =
    pathname === "/mpesa"
      ? `${TRANS_CHAP_PATH}/mpesa`
      : `${TRANS_CHAP_PATH}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};

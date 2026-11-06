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
const PATH_ALIASES: Record<string, string> = {
  "/customer": "/customers",
  "/supplier": "/suppliers",
};

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

  // Rewrite rather than redirect: browsers cached an old permanent /customers -> /customer redirect.
  const alias = Object.keys(PATH_ALIASES).find((path) => isWithinPath(pathname, path));
  if (alias) {
    const url = request.nextUrl.clone();
    url.pathname = `${TRANS_CHAP_PATH}${PATH_ALIASES[alias]}${pathname.slice(alias.length)}`;
    return NextResponse.rewrite(url);
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

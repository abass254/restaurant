import { redirect } from "next/navigation";
import { BackendUnavailableError } from "@/lib/backend";
import { firstAllowedPath } from "@/lib/merchant-permissions";
import { getServerUser } from "@/lib/server-auth";
import LoginForm from "./LoginForm";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    email?: string;
    password?: string;
    next?: string;
    registered?: string;
  }>;
};

function safeNextPath(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  if (params.email || params.password) {
    const clean = new URLSearchParams();
    if (params.error) {
      clean.set("error", params.error);
    }
    if (nextPath) {
      clean.set("next", nextPath);
    }
    if (params.registered) {
      clean.set("registered", params.registered);
    }
    redirect(clean.size > 0 ? `/sign-in?${clean.toString()}` : "/sign-in");
  }

  try {
    const user = await getServerUser();
    if (user) {
      if (user.require_change_password) {
        redirect(
          nextPath
            ? `/change-password?next=${encodeURIComponent(nextPath)}`
            : "/change-password",
        );
      }
      redirect(nextPath || firstAllowedPath(user));
    }
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }
  }

  let statusMessage: string | null = params.error || null;
  let statusOk = false;
  if (!statusMessage && params.registered) {
    statusMessage = "Account created successfully. Sign in to continue.";
    statusOk = true;
  }

  return (
    <LoginForm
      statusMessage={statusMessage}
      statusOk={statusOk}
      nextPath={nextPath}
    />
  );
}

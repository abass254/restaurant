import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthProvider } from "@/components/app/AuthProvider";
import { BackendUnavailablePanel } from "@/components/app/BackendUnavailablePanel";
import { SessionTimeoutGuard } from "@/components/app/SessionTimeoutGuard";
import { TransChapShell } from "@/components/trans-chap/TransChapShell";
import { BackendUnavailableError, backendUrl } from "@/lib/backend";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import { getServerUser } from "@/lib/server-auth";

const SIGN_IN_PATH = `/sign-in?error=${encodeURIComponent("Your session expired. Please sign in again.")}&next=/`;

export default async function TransChapAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await getServerUser();
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      return <BackendUnavailablePanel apiUrl={backendUrl} context="dashboard" />;
    }
    throw error;
  }

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  if (user.require_change_password) {
    redirect(`/change-password?next=${encodeURIComponent("/")}`);
  }

  if (!userCanAccessSection(user, "dashboard")) {
    notFound();
  }

  return (
    <AuthProvider user={user}>
      <SessionTimeoutGuard loginPath={SIGN_IN_PATH} />
      <Suspense>
        <TransChapShell>{children}</TransChapShell>
      </Suspense>
    </AuthProvider>
  );
}

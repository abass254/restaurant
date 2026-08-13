import { redirect } from "next/navigation";
import "@/styles/bundles/dashboard.css";
import { AuthProvider } from "@/components/app/AuthProvider";
import { BackendUnavailablePanel } from "@/components/app/BackendUnavailablePanel";
import { BackendUnavailableError, backendUrl } from "@/lib/backend";
import { getServerUser } from "@/lib/server-auth";
import { DashboardShell } from "./DashboardShell";

export default async function DashboardLayout({
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
    redirect(
      `/sign-in?error=${encodeURIComponent("Your session expired. Please sign in again.")}`,
    );
  }

  if (user.require_change_password) {
    redirect("/change-password");
  }

  const hasShop = Boolean(
    user.active_account?.id ||
      user.account?.id ||
      (user.memberships && user.memberships.length > 0),
  );
  if (!hasShop && user.user_role !== "super_admin") {
    redirect("/onboarding");
  }

  return (
    <AuthProvider user={user}>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}

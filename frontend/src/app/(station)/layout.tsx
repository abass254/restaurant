import { redirect } from "next/navigation";
import "@/styles/station.css";
import { AuthProvider } from "@/components/app/AuthProvider";
import { BackendUnavailablePanel } from "@/components/app/BackendUnavailablePanel";
import { BackendUnavailableError, backendUrl } from "@/lib/backend";
import { getServerUser } from "@/lib/server-auth";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import { StationShell } from "@/components/station/StationShell";

export default async function StationLayout({
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
      `/sign-in?error=${encodeURIComponent("Your session expired. Please sign in again.")}&next=/station`,
    );
  }

  if (user.require_change_password) {
    redirect("/change-password");
  }

  if (!userCanAccessSection(user, "orders")) {
    redirect("/dashboard");
  }

  return (
    <AuthProvider user={user}>
      <StationShell>{children}</StationShell>
    </AuthProvider>
  );
}

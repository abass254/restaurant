import { redirect } from "next/navigation";
import "@/styles/admin.css";
import "@/styles/messages-chat.css";
import { AuthProvider } from "@/components/app/AuthProvider";
import { BackendUnavailablePanel } from "@/components/app/BackendUnavailablePanel";
import { BackendUnavailableError, backendUrl } from "@/lib/backend";
import { PlatformRuntimeProvider } from "@/lib/platform-runtime";
import { getServerUser } from "@/lib/server-auth";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata = {
  title: "DukAI Admin",
};

export default async function AdminAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await getServerUser();
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      return <BackendUnavailablePanel apiUrl={backendUrl} context="admin" />;
    }
    throw error;
  }

  const normalizedRole = (user?.user_role ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "")
    .replaceAll("-", "")
    .replaceAll(" ", "");

  if (!user) {
    redirect("/admin/login");
  }

  if (normalizedRole !== "superadmin") {
    redirect(
      `/admin/login?error=${encodeURIComponent(
        "Your session is not a super-admin session. Please sign in again.",
      )}`,
    );
  }

  return (
    <AuthProvider user={user}>
      <PlatformRuntimeProvider>
        <AdminShell>{children}</AdminShell>
      </PlatformRuntimeProvider>
    </AuthProvider>
  );
}

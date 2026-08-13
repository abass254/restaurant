import { redirect } from "next/navigation";
import { BackendUnavailablePanel } from "@/components/app/BackendUnavailablePanel";
import { BackendUnavailableError, backendUrl } from "@/lib/backend";
import { getServerUser } from "@/lib/server-auth";
import { firstAllowedPath } from "@/lib/merchant-permissions";
import ChangePasswordClient from "./ChangePasswordClient";

export default async function ChangePasswordPage() {
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
    redirect("/sign-in");
  }

  if (!user.require_change_password) {
    redirect(firstAllowedPath(user));
  }

  return <ChangePasswordClient user={user} />;
}

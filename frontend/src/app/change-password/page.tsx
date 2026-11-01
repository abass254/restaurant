import { redirect } from "next/navigation";
import { BackendUnavailablePanel } from "@/components/app/BackendUnavailablePanel";
import { BackendUnavailableError, backendUrl } from "@/lib/backend";
import { getServerUser } from "@/lib/server-auth";
import ChangePasswordClient from "./ChangePasswordClient";

function safeNextPath(raw: string | undefined): string | null {
  if (raw?.startsWith("/") && !raw.startsWith("//")) {
    if (raw === "/trans-chap") return "/";
    if (raw.startsWith("/trans-chap/")) return raw.slice("/trans-chap".length);
    return raw;
  }
  return null;
}

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function ChangePasswordPage({ searchParams }: PageProps) {
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

  const params = await searchParams;
  const nextPath = safeNextPath(params.next) ?? "/";

  if (!user.require_change_password) {
    redirect(nextPath);
  }

  return <ChangePasswordClient user={user} nextPath={nextPath} />;
}

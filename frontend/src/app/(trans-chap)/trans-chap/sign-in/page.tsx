import { redirect } from "next/navigation";
import { TransChapShell } from "@/components/trans-chap/TransChapShell";
import { BackendUnavailableError } from "@/lib/backend";
import { getServerUser } from "@/lib/server-auth";
import LoginForm from "@/app/sign-in/LoginForm";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

function safeNextPath(raw: string | undefined): string {
  if (raw?.startsWith("/") && !raw.startsWith("//") && raw.startsWith("/trans-chap")) {
    return raw;
  }
  return "/trans-chap";
}

export default async function TransChapSignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  try {
    const user = await getServerUser();
    if (user) {
      if (user.require_change_password) {
        redirect(`/change-password?next=${encodeURIComponent(nextPath)}`);
      }
      redirect(nextPath);
    }
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }
  }

  return (
    <TransChapShell>
      <LoginForm
        statusMessage={params.error || null}
        statusOk={false}
        nextPath={nextPath}
        embedded
        signInPath="/trans-chap/sign-in"
      />
    </TransChapShell>
  );
}

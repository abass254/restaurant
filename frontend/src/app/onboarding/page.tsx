import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthProvider } from "@/components/app/AuthProvider";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { getServerUser } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "Setup — DukAI Merchants",
  description: "Set up location and products for your DukAI shop.",
};

export default async function OnboardingPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/sign-in?next=/onboarding");
  }
  if (user.require_change_password) {
    redirect("/change-password?next=/onboarding");
  }

  return (
    <AuthProvider user={user}>
      <OnboardingWizard />
    </AuthProvider>
  );
}

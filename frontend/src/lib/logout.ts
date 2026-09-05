import { apiFetch } from "@/lib/api";
import { confirmAction } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";

export async function logoutToSignIn(options?: { confirm?: boolean }) {
  if (options?.confirm !== false) {
    const ok = await confirmAction(
      "Log out?",
      "You will need to sign in again to manage this shop.",
      "Log out",
    );
    if (!ok) return;
  }

  try {
    await apiFetch(apiRoutes.logout, { method: "POST" });
  } catch {
    /* still leave */
  }
  window.location.href = "/sign-in";
}

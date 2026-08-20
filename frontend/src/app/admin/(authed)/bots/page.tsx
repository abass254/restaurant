import { redirect } from "next/navigation";

/** Legacy /admin/bots — menu and autopilot bots were removed. */
export default function AdminBotsRedirectPage() {
  redirect("/admin/settings#section-ai-agent");
}

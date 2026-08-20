import { redirect } from "next/navigation";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import { getServerUser } from "@/lib/server-auth";

export default async function TransChapChatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getServerUser();
  if (!user || !userCanAccessSection(user, "tickets")) {
    redirect("/trans-chap");
  }
  return children;
}

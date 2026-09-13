import { redirect } from "next/navigation";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import { getServerUser } from "@/lib/server-auth";

export default async function TransChapPosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getServerUser();
  if (!user || !userCanAccessSection(user, "pos")) {
    redirect("/trans-chap");
  }
  return children;
}

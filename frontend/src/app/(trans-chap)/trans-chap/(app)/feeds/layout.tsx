import { redirect } from "next/navigation";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import { getServerUser } from "@/lib/server-auth";

export default async function TransChapFeedsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getServerUser();
  if (!user || !userCanAccessSection(user, "feeds")) {
    redirect("/trans-chap");
  }
  return children;
}

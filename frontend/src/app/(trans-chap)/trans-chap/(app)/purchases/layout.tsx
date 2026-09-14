import { requireTransChapSection } from "../require-section";

export default async function TransChapPurchasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("inventory");
  return children;
}

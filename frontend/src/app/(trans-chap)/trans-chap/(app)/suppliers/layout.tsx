import { requireTransChapAnySection } from "../require-section";

export default async function TransChapSuppliersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapAnySection("supplier", "inventory");
  return children;
}

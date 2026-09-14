import { requireTransChapOwner } from "../../require-section";

export default async function TransChapOpeningStockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapOwner();
  return children;
}

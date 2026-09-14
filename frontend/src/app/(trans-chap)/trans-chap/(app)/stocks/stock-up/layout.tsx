import { requireTransChapOwner } from "../../require-section";

export default async function TransChapStockUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapOwner();
  return children;
}

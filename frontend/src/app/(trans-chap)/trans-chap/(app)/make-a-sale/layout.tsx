import { requireTransChapSection } from "../require-section";

export default async function TransChapSalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("pos");
  return children;
}

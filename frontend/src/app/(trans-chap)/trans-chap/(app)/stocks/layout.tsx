import { requireTransChapSection } from "../require-section";

export default async function TransChapStocksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("inventory");
  return children;
}

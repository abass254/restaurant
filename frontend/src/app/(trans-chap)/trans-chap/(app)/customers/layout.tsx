import { requireTransChapSection } from "../require-section";

export default async function TransChapCustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("customer");
  return children;
}

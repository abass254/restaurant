import { requireTransChapSection } from "../require-section";

export default async function TransChapCreditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("customer");
  return children;
}

import { requireTransChapSection } from "../require-section";

export default async function TransChapMpesaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("pos");
  return children;
}

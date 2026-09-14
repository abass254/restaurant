import { requireTransChapSection } from "../require-section";

export default async function TransChapPosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("pos");
  return children;
}

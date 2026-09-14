import { requireTransChapOwner } from "../require-section";

export default async function TransChapReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapOwner();
  return children;
}

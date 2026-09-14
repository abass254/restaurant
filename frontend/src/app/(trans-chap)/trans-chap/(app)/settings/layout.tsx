import { requireTransChapSection } from "../require-section";

export default async function TransChapSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTransChapSection("settings");
  return children;
}

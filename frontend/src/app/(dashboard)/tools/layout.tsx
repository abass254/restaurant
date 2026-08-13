import { ToolsSubNav } from "@/components/app/ToolsSubNav";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="tickets-page-nav">
        <ToolsSubNav />
      </div>
      {children}
    </>
  );
}

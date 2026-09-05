const INTERNAL_TOOLS_ALLOWED_EMAILS = new Set([
  "abassahmed1738@gmail.com",
  "amal.mohamedali10@gmail.com",
]);

export function isInternalToolsUser(user: { email?: string | null }): boolean {
  const email = (user.email ?? "").trim().toLowerCase();
  return email.length > 0 && INTERNAL_TOOLS_ALLOWED_EMAILS.has(email);
}

/** @deprecated Use isInternalToolsUser */
export const isQaUser = isInternalToolsUser;

export function isLoginCodesPath(pathname: string): boolean {
  return pathname === "/tools/login-codes" || pathname.startsWith("/tools/login-codes/");
}

export function isQaPath(pathname: string): boolean {
  return pathname === "/tools/qa" || pathname.startsWith("/tools/qa/");
}

export function isInternalToolsPath(pathname: string): boolean {
  return isLoginCodesPath(pathname) || isQaPath(pathname);
}

export const QA_ISSUE_TYPES = [
  { value: "bug", label: "Bug" },
  { value: "task", label: "Task" },
  { value: "improvement", label: "Improvement" },
  { value: "question", label: "Question" },
] as const;

export const QA_PRIORITIES = [
  { value: "highest", label: "Highest" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "lowest", label: "Lowest" },
] as const;

export const QA_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "wont_fix", label: "Won't Fix" },
] as const;

export const QA_COMPONENTS = [
  { value: "general", label: "General" },
  { value: "dashboard", label: "Dashboard" },
  { value: "orders", label: "Orders" },
  { value: "delivery", label: "Delivery" },
  { value: "inventory", label: "Inventory" },
  { value: "pos", label: "POS" },
  { value: "customer", label: "Customers" },
  { value: "tickets", label: "Tickets" },
  { value: "feeds", label: "Feeds" },
  { value: "tools", label: "Tools" },
  { value: "settings", label: "Settings" },
  { value: "rider_app", label: "Rider app" },
  { value: "auth", label: "Auth" },
  { value: "payments", label: "Payments" },
] as const;

export type QaIssueType = (typeof QA_ISSUE_TYPES)[number]["value"];
export type QaPriority = (typeof QA_PRIORITIES)[number]["value"];
export type QaStatus = (typeof QA_STATUSES)[number]["value"];
export type QaComponent = (typeof QA_COMPONENTS)[number]["value"];

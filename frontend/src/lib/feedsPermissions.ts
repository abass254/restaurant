const REQUIRED_FEED_SCOPES = [
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
] as const;

export function instagramAccountMissingFeedPermissions(
  granted: string | null | undefined,
): boolean {
  if (!granted?.trim()) return false;
  const grantedList = granted
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return REQUIRED_FEED_SCOPES.some((scope) => !grantedList.includes(scope));
}

export function isInstagramPermissionError(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("permission") ||
    normalized.includes("scope") ||
    normalized.includes("oauth") ||
    normalized.includes("access token") ||
    normalized.includes("not authorized") ||
    normalized.includes("authorized") ||
    normalized.includes("manage_insights") ||
    normalized.includes("manage_comments") ||
    normalized.includes("insufficient") ||
    normalized.includes("(#200)") ||
    normalized.includes("(#10)") ||
    normalized.includes("(#190)")
  );
}

export function hasInstagramPermissionIssue(
  ...messages: Array<string | null | undefined>
): boolean {
  return messages.some((message) => isInstagramPermissionError(message));
}

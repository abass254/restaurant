import { ChatWorkspace } from "@/components/messages/ChatWorkspace";
import { MessagesEmptyState } from "@/components/messages/MessagesEmptyState";
import { getServerInbox } from "@/lib/server-messages";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const { inbox, error, errorCode } = await getServerInbox(false, true);

  if (
    errorCode === "no_channel_connected" ||
    errorCode === "channel_not_onboarded"
  ) {
    return <MessagesEmptyState />;
  }

  return (
    <ChatWorkspace
      initialInbox={inbox}
      initialInboxError={error}
      title="Messages"
    />
  );
}

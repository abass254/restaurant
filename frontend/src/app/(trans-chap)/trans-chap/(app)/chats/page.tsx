import { ChatWorkspace } from "@/components/messages/ChatWorkspace";
import { MessagesEmptyState } from "@/components/messages/MessagesEmptyState";
import { TransChapSocial } from "@/components/trans-chap/TransChapSocial";
import { getServerInbox } from "@/lib/server-messages";

export const dynamic = "force-dynamic";

export default async function TransChapChatsPage() {
  const { inbox, error, errorCode } = await getServerInbox(false, true);

  return (
    <TransChapSocial>
      {errorCode === "no_channel_connected" || errorCode === "channel_not_onboarded" ? (
        <MessagesEmptyState />
      ) : (
        <ChatWorkspace
          initialInbox={inbox}
          initialInboxError={error}
          title="Chats"
        />
      )}
    </TransChapSocial>
  );
}

import { ChatWorkspace } from "@/components/messages/ChatWorkspace";
import { MessagesEmptyState } from "@/components/messages/MessagesEmptyState";
import { TicketsSubNav } from "@/components/tickets/TicketsSubNav";
import { getServerInbox } from "@/lib/server-messages";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const { inbox, error, errorCode } = await getServerInbox(false, true);

  if (
    errorCode === "no_channel_connected" ||
    errorCode === "channel_not_onboarded"
  ) {
    return <MessagesEmptyState />;
  }

  return (
    <>
      <div className="tickets-page-nav">
        <TicketsSubNav />
      </div>
      <ChatWorkspace
        initialInbox={inbox}
        initialInboxError={error}
        title="Tickets"
        showTicketFilters
        defaultTicketFilter="open"
      />
    </>
  );
}

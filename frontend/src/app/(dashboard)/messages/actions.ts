"use server";

import { getServerConversation, getServerInbox } from "@/lib/server-messages";
import type { InboxResponse, InstagramConversation } from "@/lib/types";

export async function loadConversationAction(
  conversationId: string,
): Promise<InstagramConversation> {
  const conversation = await getServerConversation(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found.");
  }
  return conversation;
}

export async function refreshInboxAction(
  sync = false,
): Promise<{ inbox: InboxResponse | null; error: string | null }> {
  return getServerInbox(sync, true);
}

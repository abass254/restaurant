"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadConversationAction,
  refreshInboxAction,
} from "@/app/(dashboard)/messages/actions";
import { ConversationAvatar } from "@/components/messages/ConversationAvatar";
import { ChatConversationListSkeleton } from "@/components/messages/ChatConversationListSkeleton";
import { ChatCatalog } from "@/components/messages/ChatCatalog";
import { ChatProductCard } from "@/components/messages/ChatProductCard";
import { ChatThreadSkeleton } from "@/components/messages/ChatThreadSkeleton";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { toDisplayMessages } from "@/lib/chat-messages";
import { ChatOrderTrackCard } from "@/components/messages/ChatOrderTrackCard";
import { ChatOrderPayCard } from "@/components/messages/ChatOrderPayCard";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  formatNairobiDayLabel,
  formatNairobiFeedDate,
  formatNairobiListTime,
  formatNairobiTime,
} from "@/lib/nairobi-time";
import type {
  ChannelPlatform,
  InboxResponse,
  InstagramConversation,
  InstagramMessage,
  SettingsResponse,
  SupportTicket,
  TicketResolution,
  TicketStatus,
} from "@/lib/types";

function displayName(
  username: string | null | undefined,
  igId: string | null | undefined,
): string {
  if (username) {
    return username.replace(/^@/, "").trim();
  }
  if (igId) {
    return `User ${igId.slice(-6)}`;
  }
  return "Unknown";
}

type MessageGroup = { day: string; messages: InstagramMessage[] };

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  tiktok: "TikTok",
};

const PLATFORM_ICON: Record<string, string> = {
  instagram: "fa-brands fa-instagram",
  whatsapp: "fa-brands fa-whatsapp",
  facebook: "fa-brands fa-facebook",
  tiktok: "fa-brands fa-tiktok",
};

function normalizePlatform(platform: string | null | undefined): ChannelPlatform {
  const value = String(platform || "instagram").toLowerCase();
  if (value === "whatsapp" || value === "facebook" || value === "tiktok") {
    return value;
  }
  return "instagram";
}

function platformLabel(platform: string | null | undefined): string {
  return PLATFORM_LABEL[normalizePlatform(platform)] ?? "Instagram";
}

function platformIcon(platform: string | null | undefined): string {
  return PLATFORM_ICON[normalizePlatform(platform)] ?? "fa-brands fa-instagram";
}

function groupMessagesByDay(messages: InstagramMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentDay = "";

  for (const message of messages) {
    const day = formatNairobiDayLabel(message.sent_at);
    if (day !== currentDay) {
      currentDay = day;
      groups.push({ day, messages: [] });
    }
    groups[groups.length - 1].messages.push(message);
  }

  return groups;
}

const TICKET_EVENT_LABELS: Record<string, string> = {
  ticket_opened: "Ticket opened",
  greeting_sent: "Greeting sent",
  menu_selected: "Menu option chosen",
  customer_replied: "Customer replied",
  agent_replied: "Agent replied",
  auto_closed: "Auto-closed (no reply)",
  marked_solved: "Marked solved",
  marked_unresolved: "Marked unresolved",
  manually_closed: "Closed by agent",
  manually_reopened: "Reopened by agent",
};

function formatTicketDuration(seconds: number | null | undefined): string {
  if (seconds == null) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function resolutionLabel(resolution: TicketResolution | null | undefined): string | null {
  if (!resolution) {
    return null;
  }
  if (resolution === "solved") {
    return "Solved";
  }
  if (resolution === "unsolved") {
    return "Unresolved";
  }
  if (resolution === "auto_timeout") {
    return "Auto-closed";
  }
  return resolution;
}

function ticketIsOpen(ticket: SupportTicket | null | undefined): boolean {
  if (!ticket) {
    return false;
  }
  return ticket.status === "open" || ticket.status === "waiting_customer";
}

function conversationIsOpen(
  conversation: InstagramConversation | null | undefined,
  summary: InstagramConversation | undefined,
): boolean {
  const status = conversation?.ticket_status ?? summary?.ticket_status ?? "open";
  return status !== "closed";
}

type TicketFilter = "all" | TicketStatus;

type ChatWorkspaceProps = {
  initialInbox?: InboxResponse | null;
  initialInboxError?: string | null;
  title?: string;
  showTicketFilters?: boolean;
  defaultTicketFilter?: TicketFilter;
  /** Magazine-style list with source chips (Trans Chap chats). */
  listLayout?: "default" | "feed";
};

export function ChatWorkspace({
  initialInbox = null,
  initialInboxError = null,
  title = "Messages",
  showTicketFilters = false,
  defaultTicketFilter = "all",
  listLayout = "default",
}: ChatWorkspaceProps) {
  const [inbox, setInbox] = useState<InboxResponse | null>(initialInbox);
  const [inboxLoading, setInboxLoading] = useState(!initialInbox && !initialInboxError);
  const [inboxError, setInboxError] = useState<string | null>(initialInboxError);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | ChannelPlatform>("all");
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>(defaultTicketFilter);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<InstagramConversation | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  const [reply, setReply] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [ticketUpdating, setTicketUpdating] = useState(false);
  const [autoRepliesEnabled, setAutoRepliesEnabled] = useState(true);
  const [autoRepliesLoaded, setAutoRepliesLoaded] = useState(false);
  const [autoRepliesSaving, setAutoRepliesSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulseIds, setPulseIds] = useState<Set<string>>(() => new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const prevUnreadRef = useRef<Map<string, number>>(new Map());
  const prevLastMessageRef = useRef<Map<string, string | null>>(new Map());
  const skipInboxPulseRef = useRef(true);
  const didAutoOpenRef = useRef(false);
  activeIdRef.current = activeId;

  const markConversationReadInInbox = useCallback((conversationId: string) => {
    prevUnreadRef.current.set(conversationId, 0);

    setInbox((current) => {
      if (!current) {
        return current;
      }

      let cleared = 0;
      const conversations = current.conversations.map((item) => {
        if (item.id !== conversationId) {
          return item;
        }
        cleared = item.unread_count ?? 0;
        return { ...item, unread_count: 0, is_unread: false };
      });

      return {
        ...current,
        conversations,
        total_unread: Math.max(0, (current.total_unread ?? 0) - cleared),
      };
    });
  }, []);

  const applyInbox = useCallback((data: InboxResponse) => {
    const prevUnread = prevUnreadRef.current;
    const prevLastMessage = prevLastMessageRef.current;
    const nextPulse = new Set<string>();
    const skipPulse = skipInboxPulseRef.current;
    skipInboxPulseRef.current = false;

    for (const item of data.conversations) {
      const count = item.unread_count ?? 0;
      const was = prevUnread.get(item.id) ?? 0;
      const lastMessageAt = item.last_message_at ?? null;
      const hadLastMessage = prevLastMessage.get(item.id) ?? null;
      const hasNewMessage =
        lastMessageAt != null &&
        hadLastMessage != null &&
        lastMessageAt !== hadLastMessage;
      const becameUnread = count > 0 && (count > was || hasNewMessage);

      if (!skipPulse && becameUnread && item.id !== activeIdRef.current) {
        nextPulse.add(item.id);
      }

      prevUnread.set(item.id, count);
      prevLastMessage.set(item.id, lastMessageAt);
    }

    if (nextPulse.size > 0) {
      setPulseIds((current) => new Set([...current, ...nextPulse]));
      window.setTimeout(() => {
        setPulseIds((current) => {
          const copy = new Set(current);
          for (const id of nextPulse) {
            copy.delete(id);
          }
          return copy;
        });
      }, 2400);
    }

    setInbox(data);
    setInboxError(null);
    if (typeof data.auto_replies_enabled === "boolean") {
      setAutoRepliesEnabled(data.auto_replies_enabled);
    }
  }, []);

  const refreshInbox = useCallback(async (sync = false) => {
    const result = await refreshInboxAction(sync);
    if (result.error) {
      setInboxError(result.error);
      return;
    }
    if (result.inbox) {
      applyInbox(result.inbox);
    }
  }, [applyInbox]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        if (cancelled) {
          return;
        }
        const enabled = data.user.instagram_account?.auto_replies_enabled;
        if (typeof enabled === "boolean") {
          setAutoRepliesEnabled(enabled);
        }
      })
      .catch(() => {
        // keep default enabled
      })
      .finally(() => {
        if (!cancelled) {
          setAutoRepliesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeId == null) {
      setConversation(null);
      return;
    }

    const conversationId = activeId;

    let cancelled = false;

    async function loadThread() {
      setThreadLoading(true);
      setSendError(null);

      try {
        const loaded = await loadConversationAction(conversationId);
        if (!cancelled) {
          setConversation(loaded);
          if (loaded.live_agent_handoff === true) {
            setAutoRepliesEnabled(false);
          }
          markConversationReadInInbox(conversationId);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setSendError(
            err instanceof Error ? err.message : "Failed to load conversation.",
          );
          setConversation(null);
        }
      } finally {
        if (!cancelled) {
          setThreadLoading(false);
        }
      }
    }

    void loadThread();

    return () => {
      cancelled = true;
    };
  }, [activeId, markConversationReadInInbox]);

  useEffect(() => {
    if (!initialInbox && !initialInboxError) {
      setInboxLoading(true);
      void refreshInbox()
        .catch((err: unknown) => {
          setInboxError(err instanceof Error ? err.message : "Failed to load messages.");
        })
        .finally(() => setInboxLoading(false));
    } else if (initialInbox) {
      applyInbox(initialInbox);
    }

    const interval = window.setInterval(() => {
      void refreshInbox();
    }, 15000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + poll only
  }, []);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    const conversationId = activeId;
    let cancelled = false;

    async function refreshThread() {
      try {
        const updated = await loadConversationAction(conversationId);
        if (!cancelled && activeIdRef.current === conversationId) {
          setConversation(updated);
          markConversationReadInInbox(conversationId);
        }
      } catch {
        // keep existing thread on poll failure
      }
    }

    void refreshThread();
    const interval = window.setInterval(() => {
      void refreshThread();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeId, markConversationReadInInbox]);

  useEffect(() => {
    if (didAutoOpenRef.current || !inbox?.conversations[0]) {
      return;
    }
    didAutoOpenRef.current = true;
    setActiveId(inbox.conversations[0].id);
  }, [inbox]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    conversation?.messages,
    conversation?.participant_is_typing,
    conversation?.agent_is_typing,
  ]);

  const filteredConversations = useMemo(() => {
    const list = inbox?.conversations ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((item) => {
      const platform = normalizePlatform(item.platform);
      if (channelFilter !== "all" && platform !== channelFilter) {
        return false;
      }
      if (showTicketFilters && ticketFilter !== "all") {
        const status = item.ticket_status ?? "open";
        if (status !== ticketFilter) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      const name = (item.participant_username ?? item.participant_ig_id ?? "").toLowerCase();
      const preview = (item.latest_message?.body ?? "").toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
  }, [inbox, search, channelFilter, showTicketFilters, ticketFilter]);

  const availableChannelFilters = useMemo(() => {
    const set = new Set<ChannelPlatform>(
      (inbox?.connected_platforms ?? []).map((platform) => normalizePlatform(platform)),
    );
    for (const item of inbox?.conversations ?? []) {
      const platform = normalizePlatform(item.platform);
      if (!set.has(platform)) {
        set.add(platform);
      }
    }
    return Array.from(set.values());
  }, [inbox?.connected_platforms, inbox?.conversations]);

  const totalUnread = inbox?.total_unread ?? 0;
  const showBetaBanner =
    inbox?.instagram_beta_enabled &&
    (inbox.instagram_beta_connected ||
      inbox.instagram_outbound_transport === "beta" ||
      inbox.instagram_outbound_transport === "auto");

  const activeSummary = inbox?.conversations.find((c) => c.id === activeId);
  const activeTicket = conversation?.active_ticket ?? activeSummary?.active_ticket ?? null;
  const isConversationOpen = conversationIsOpen(conversation, activeSummary);
  const participantIsTyping = conversation?.participant_is_typing === true;
  const agentIsTyping = conversation?.agent_is_typing === true;
  const participantLabel = activeSummary
    ? displayName(activeSummary.participant_username, activeSummary.participant_ig_id)
    : "";
  const activePlatform = normalizePlatform(activeSummary?.platform);
  const liveAgentHandoff =
    conversation?.live_agent_handoff === true ||
    activeSummary?.live_agent_handoff === true;
  const hasLiveAgentHandoff =
    liveAgentHandoff ||
    (inbox?.conversations ?? []).some((item) => item.live_agent_handoff === true);
  const displayAutoRepliesEnabled = autoRepliesEnabled && !hasLiveAgentHandoff;
  const agentReplyAllowed =
    liveAgentHandoff ||
    (conversation?.agent_reply_allowed ??
      activeSummary?.agent_reply_allowed ??
      !autoRepliesEnabled);

  const messageGroups = useMemo(
    () => groupMessagesByDay(conversation?.messages ?? []),
    [conversation?.messages],
  );

  async function resolveTicket(resolution: "solved" | "unsolved") {
    if (!activeTicket?.id || !activeId) {
      return;
    }

    setResolving(true);
    setSendError(null);

    try {
      await apiFetch(apiRoutes.ticketResolve(activeTicket.id), {
        method: "PATCH",
        body: JSON.stringify({ resolution }),
      });
      const refreshed = await loadConversationAction(activeId);
      setConversation(refreshed);
      await refreshInbox();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to update ticket.");
    } finally {
      setResolving(false);
    }
  }

  async function reopenTicket() {
    if (!activeId) {
      return;
    }

    setTicketUpdating(true);
    setSendError(null);

    try {
      const response = await apiFetch<{ data: InstagramConversation }>(
        apiRoutes.conversationTicketStatus(activeId),
        {
          method: "PATCH",
          body: JSON.stringify({ status: "open" }),
        },
      );
      setConversation(response.data);
      await refreshInbox();
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to update ticket status.",
      );
    } finally {
      setTicketUpdating(false);
    }
  }

  async function handleAutoRepliesToggle(enabled: boolean) {
    setAutoRepliesEnabled(enabled);
    setAutoRepliesSaving(true);

    try {
      const data = await apiFetch<{ auto_replies_enabled: boolean }>(
        apiRoutes.autoRepliesSettings,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
      setAutoRepliesEnabled(data.auto_replies_enabled);
    } catch (err) {
      setAutoRepliesEnabled(!enabled);
      setSendError(
        err instanceof Error ? err.message : "Could not update auto-replies setting.",
      );
    } finally {
      setAutoRepliesSaving(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !reply.trim()) {
      return;
    }

    setSending(true);
    setSendError(null);

    try {
      await apiFetch(`${apiRoutes.messages}/${activeId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      const refreshed = await loadConversationAction(activeId);
      setConversation(refreshed);
      await refreshInbox();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendReply(event as unknown as FormEvent);
    }
  }

  const feedList = listLayout === "feed";

  return (
    <div
      className={[
        "chat-app",
        activeId ? "chat-app--thread-open" : "",
        activePlatform === "whatsapp" ? "chat-app--platform-whatsapp" : "",
        showTicketFilters ? "chat-app--tickets" : "",
        feedList ? "chat-app--feed-list" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={showTicketFilters ? "Tickets" : "Messages"}
    >
      <aside className="chat-sidebar chat-sidebar--compact">
        <div className="chat-sidebar__header">
          {!feedList ? (
            <div className="chat-sidebar__title-row">
              <h1 className="chat-sidebar__title">
                {title}
                {totalUnread > 0 ? (
                  <span className="chat-sidebar__unread-badge" aria-label={`${totalUnread} unread`}>
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                ) : null}
              </h1>
            </div>
          ) : null}
          {showBetaBanner ? (
            <p className="chat-sidebar__beta-banner" role="status">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
              Instagram Beta is active on UAT — replies go out via session login until Meta
              approves Advanced Access. Connect Instagram (Beta) in Settings → Channels.
            </p>
          ) : null}
          {!feedList && autoRepliesLoaded ? (
            <div className="chat-auto-replies-toggle">
              <span className="chat-auto-replies-toggle__label">Auto-replies</span>
              <button
                type="button"
                role="switch"
                aria-checked={displayAutoRepliesEnabled}
                aria-label={
                  displayAutoRepliesEnabled ? "Disable auto-replies" : "Enable auto-replies"
                }
                className={`chat-auto-replies-toggle__switch${
                  displayAutoRepliesEnabled ? " is-on" : ""
                }`}
                disabled={autoRepliesSaving}
                onClick={() => void handleAutoRepliesToggle(!displayAutoRepliesEnabled)}
              >
                <span className="chat-auto-replies-toggle__thumb" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {showTicketFilters ? (
            <div
              className="chat-sidebar__chips chat-sidebar__chips--tickets"
              role="tablist"
              aria-label="Filter tickets by status"
            >
              {(["all", "open", "closed"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`chat-sidebar__chip chat-sidebar__chip--text${
                    ticketFilter === status ? " is-active" : ""
                  }`}
                  onClick={() => setTicketFilter(status)}
                  aria-pressed={ticketFilter === status}
                >
                  {status === "all" ? "All" : status === "open" ? "Open" : "Closed"}
                </button>
              ))}
            </div>
          ) : null}
          {!showTicketFilters ? (
            <div
              className={`chat-sidebar__chips${feedList ? " chat-sidebar__chips--labeled" : ""}`}
              role="tablist"
              aria-label="Filter chats by channel"
            >
              <button
                type="button"
                className={`chat-sidebar__chip${feedList ? " chat-sidebar__chip--text" : ""}${
                  channelFilter === "all" ? " is-active" : ""
                }`}
                onClick={() => setChannelFilter("all")}
                aria-pressed={channelFilter === "all"}
                title="All channels"
              >
                {feedList ? (
                  "All"
                ) : (
                  <>
                    <i className="fas fa-layer-group chat-sidebar__chip-icon" aria-hidden="true" />
                    <span className="sr-only">All channels</span>
                  </>
                )}
              </button>
              {availableChannelFilters.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  className={`chat-sidebar__chip${feedList ? " chat-sidebar__chip--text" : ""}${
                    channelFilter === platform ? " is-active" : ""
                  }${platform === "whatsapp" ? " is-whatsapp" : ""}`}
                  onClick={() => setChannelFilter(platform)}
                  aria-pressed={channelFilter === platform}
                  title={platformLabel(platform)}
                >
                  {feedList ? (
                    <>
                      <i className={`${platformIcon(platform)} chat-sidebar__chip-icon`} aria-hidden="true" />
                      {platformLabel(platform)}
                    </>
                  ) : (
                    <>
                      <i className={`${platformIcon(platform)} chat-sidebar__chip-icon`} aria-hidden="true" />
                      <span className="sr-only">{platformLabel(platform)}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          <div className="chat-sidebar__search-row">
            <div className="chat-sidebar__search">
              <i className="fas fa-search" aria-hidden="true" />
              <input
                type="search"
                placeholder={showTicketFilters ? "Search tickets" : "Search conversations"}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search conversations"
              />
            </div>
            <button
              type="button"
              className="chat-sidebar__sync"
              disabled={syncing || inboxLoading}
              title="Pull conversation history from connected channels"
              onClick={() => {
                setSyncing(true);
                void refreshInbox(true).finally(() => setSyncing(false));
              }}
            >
              <i
                className={`fas fa-arrows-rotate${syncing ? " fa-spin" : ""}`}
                aria-hidden="true"
              />
              <span className="sr-only">Sync from Instagram</span>
            </button>
          </div>
          {inbox?.sync_error ? (
            <p className="chat-sidebar__error">{inbox.sync_error}</p>
          ) : null}
          {inboxError ? <p className="chat-sidebar__error">{inboxError}</p> : null}
        </div>

        {inboxLoading ? (
          <ChatConversationListSkeleton compact />
        ) : filteredConversations.length === 0 ? (
          <p className="chat-sidebar__empty">No conversations yet.</p>
        ) : (
          <ul className={`chat-conversation-list${feedList ? " chat-conversation-list--feed" : ""}`}>
            {filteredConversations.map((item) => {
              const name = displayName(item.participant_username, item.participant_ig_id);
              const preview =
                item.latest_message?.body ??
                `${item.messages_count ?? 0} message${(item.messages_count ?? 0) === 1 ? "" : "s"}`;
              const unread =
                item.is_unread === true || (item.unread_count ?? 0) > 0;
              const isActive = item.id === activeId;
              const platform = normalizePlatform(item.platform);
              const ticket = item.active_ticket;
              const resolution = resolutionLabel(ticket?.resolution);
              const duration = formatTicketDuration(ticket?.duration_seconds);
              const headline = feedList
                ? `${name}${preview ? ` — ${preview}` : ""}`
                : null;

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={[
                      "chat-conversation-item",
                      feedList ? "chat-conversation-item--feed" : "",
                      showTicketFilters ? "chat-conversation-item--ticket" : "",
                      isActive ? "is-active" : "",
                      unread ? "is-unread" : "is-read",
                      pulseIds.has(item.id) ? "is-pulse" : "",
                      platform === "whatsapp" ? "is-whatsapp" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setActiveId(item.id)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {feedList ? (
                      <>
                        <span className="chat-conversation-item__thumb">
                          <ConversationAvatar
                            name={name}
                            photoUrl={item.participant_profile_pic_url}
                          />
                          {unread ? (
                            <span className="chat-conversation-item__dot" aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="chat-conversation-item__body">
                          <span className="chat-conversation-item__headline">{headline}</span>
                          <span className="chat-conversation-item__foot">
                            <span
                              className={`chat-conversation-item__source is-${platform}`}
                            >
                              <i className={platformIcon(platform)} aria-hidden="true" />
                              {platformLabel(platform)}
                            </span>
                            <time className="chat-conversation-item__date">
                              {formatNairobiFeedDate(item.last_message_at)}
                            </time>
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="chat-conversation-item__avatar-wrap">
                          <ConversationAvatar
                            name={name}
                            photoUrl={item.participant_profile_pic_url}
                            compact
                          />
                          {unread && !showTicketFilters ? (
                            <span className="chat-conversation-item__dot" aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="chat-conversation-item__body">
                          <span className="chat-conversation-item__row">
                            <span className="chat-conversation-item__name-wrap">
                              {!showTicketFilters ? (
                                <span
                                  className="chat-conversation-item__channel chat-conversation-item__channel--inline"
                                  title={platformLabel(platform)}
                                >
                                  <i className={platformIcon(platform)} aria-hidden="true" />
                                </span>
                              ) : null}
                              <span className="chat-conversation-item__name">{name}</span>
                            </span>
                            <span className="chat-conversation-item__meta">
                              {showTicketFilters ? (
                                <>
                                  {ticket?.display_number ? (
                                    <span className="chat-ticket-number">{ticket.display_number}</span>
                                  ) : null}
                                  <span
                                    className={`chat-ticket-badge chat-ticket-badge--${
                                      item.ticket_status ?? "open"
                                    }`}
                                  >
                                    {(item.ticket_status ?? "open") === "open" ? "Open" : "Closed"}
                                  </span>
                                  {resolution ? (
                                    <span
                                      className={`chat-ticket-badge chat-ticket-badge--resolution chat-ticket-badge--${ticket?.resolution ?? "unknown"}`}
                                    >
                                      {resolution}
                                    </span>
                                  ) : null}
                                </>
                              ) : null}
                              <time className="chat-conversation-item__time">
                                {formatNairobiListTime(item.last_message_at)}
                              </time>
                            </span>
                          </span>
                          <span className="chat-conversation-item__row chat-conversation-item__row--preview">
                            <span className="chat-conversation-item__preview">{preview}</span>
                            {showTicketFilters && duration !== "—" ? (
                              <span className="chat-ticket-duration">{duration}</span>
                            ) : null}
                            {unread ? (
                              <span className="chat-conversation-item__count">
                                {item.unread_count}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="chat-main">
        {!activeId ? (
          <div className="chat-main__empty">
            <div className="chat-main__empty-icon" aria-hidden="true">
              <i className="fas fa-comments" />
            </div>
            <h2>Your messages</h2>
            <p>Select a conversation from the list to open it.</p>
            {totalUnread > 0 ? (
              <p className="chat-main__empty-unread">
                You have {totalUnread} unread message{totalUnread === 1 ? "" : "s"}.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <header className="chat-thread-header">
              <button
                type="button"
                className="chat-thread-header__back"
                aria-label="Back to conversations"
                onClick={() => {
                  setActiveId(null);
                  setConversation(null);
                  setSendError(null);
                }}
              >
                <i className="fas fa-arrow-left" aria-hidden="true" />
              </button>
              <ConversationAvatar
                name={participantLabel}
                photoUrl={activeSummary?.participant_profile_pic_url}
              />
              <div className="chat-thread-header__info">
                <strong>{participantLabel}</strong>
                <span>
                  {showTicketFilters && activeTicket?.display_number
                    ? `${activeTicket.display_number} · `
                    : ""}
                  {platformLabel(activePlatform)} · Shared platform inbox
                </span>
              </div>
              {showTicketFilters ? (
                <div className="chat-thread-header__ticket">
                  <span className="chat-ticket-meta">
                    <span
                      className={`chat-ticket-badge chat-ticket-badge--${
                        isConversationOpen ? "open" : "closed"
                      }`}
                    >
                      {isConversationOpen ? "Open" : "Closed"}
                    </span>
                    {formatTicketDuration(activeTicket?.duration_seconds) !== "—"
                      ? ` · ${formatTicketDuration(activeTicket?.duration_seconds)}`
                      : ""}
                    {resolutionLabel(activeTicket?.resolution)
                      ? ` · ${resolutionLabel(activeTicket?.resolution)}`
                      : ""}
                  </span>
                  <span className="chat-ticket-actions">
                    {isConversationOpen && ticketIsOpen(activeTicket) ? (
                      <>
                        <button
                          type="button"
                          className="chat-ticket-action chat-ticket-action--solved"
                          disabled={resolving || threadLoading}
                          onClick={() => void resolveTicket("solved")}
                        >
                          Mark solved
                        </button>
                        <button
                          type="button"
                          className="chat-ticket-action chat-ticket-action--unsolved"
                          disabled={resolving || threadLoading}
                          onClick={() => void resolveTicket("unsolved")}
                        >
                          Mark unresolved
                        </button>
                      </>
                    ) : !isConversationOpen ? (
                      <button
                        type="button"
                        className="chat-ticket-action chat-ticket-action--reopen"
                        disabled={ticketUpdating || threadLoading}
                        onClick={() => void reopenTicket()}
                      >
                        Reopen ticket
                      </button>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </header>

            {showTicketFilters && activeTicket?.events && activeTicket.events.length > 0 ? (
              <details className="chat-ticket-timeline">
                <summary>Ticket timeline</summary>
                <ol className="chat-ticket-timeline__list">
                  {activeTicket.events.map((event) => (
                    <li key={event.id} className="chat-ticket-timeline__item">
                      <span className="chat-ticket-timeline__label">
                        {TICKET_EVENT_LABELS[event.event_type] ?? event.event_type}
                      </span>
                      {event.created_at ? (
                        <time className="chat-ticket-timeline__time" dateTime={event.created_at}>
                          {formatNairobiTime(event.created_at)}
                        </time>
                      ) : null}
                      {event.body ? (
                        <span className="chat-ticket-timeline__body">{event.body}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}

            <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
              {threadLoading ? (
                <ChatThreadSkeleton />
              ) : sendError && !conversation ? (
                <p className="chat-composer__error">{sendError}</p>
              ) : messageGroups.length === 0 ? (
                <p className="chat-loading">No messages in this thread yet.</p>
              ) : (
                messageGroups.map((group) => (
                  <div key={group.day} className="chat-message-group">
                    <div className="chat-day-divider flex text-center items-center justify-center">{group.day}</div>
                    {toDisplayMessages(group.messages).map((item) => {
                      const isOut = item.message.direction === "outbound";
                      return (
                        <div
                          key={item.message.id}
                          className={`chat-bubble-row ${isOut ? "chat-bubble-row--out" : "chat-bubble-row--in"}`}
                        >
                          <div
                            className={`chat-bubble pt-2${
                              item.kind === "product_card"
                                ? " chat-bubble--card"
                                : item.kind === "product_catalog"
                                  ? " chat-bubble--catalog"
                                  : item.kind === "order_track" || item.kind === "order_pay"
                                    ? " chat-bubble--card"
                                    : ""
                            }`}
                          >
                            {item.kind === "product_catalog" ? (
                              <ChatCatalog catalog={item.catalog} />
                            ) : item.kind === "product_card" ? (
                              <ChatProductCard product={item.product} />
                            ) : item.kind === "order_track" ? (
                              <ChatOrderTrackCard track={item.track} />
                            ) : item.kind === "order_pay" ? (
                              <ChatOrderPayCard pay={item.pay} />
                            ) : item.kind === "text" ? (
                              <p>{item.body}</p>
                            ) : null}
                            <div className="chat-bubble__meta">
                              {item.message.auto_replied ? (
                                <span className="chat-bubble__auto">Auto</span>
                              ) : null}
                              {item.message.sent_at ? (
                                <time dateTime={item.message.sent_at}>
                                  {formatNairobiTime(item.message.sent_at)}
                                </time>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              {!threadLoading && participantIsTyping ? (
                <TypingIndicator aligned="in" label="Customer is typing" />
              ) : null}
              {!threadLoading && agentIsTyping ? (
                <TypingIndicator aligned="out" label="Auto-reply is typing" />
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-composer">
              {sendError && conversation ? (
                <p className="chat-composer__error">{sendError}</p>
              ) : null}
              {liveAgentHandoff ? (
                <p className="chat-composer__live-banner" role="status">
                  Live agent chat — you and the customer can message freely. Auto-replies
                  are paused for this conversation.
                </p>
              ) : null}
              {!agentReplyAllowed ? (
                <div className="chat-composer__blocked" role="status">
                  <p>
                    Auto-replies are handling this chat — manual ticket replies are disabled.
                    Turn off auto-replies in the sidebar to take over, or wait until the
                    customer taps &quot;Live agent&quot;.
                  </p>
                </div>
              ) : (
                <form className="chat-composer__form" onSubmit={(event) => void sendReply(event)}>
                  <textarea
                    className="chat-composer__input"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Message…"
                    rows={1}
                    aria-label="Write a message"
                    disabled={sending || threadLoading || !conversation}
                  />
                  <button
                    type="submit"
                    className="chat-composer__send"
                    disabled={sending || !reply.trim() || threadLoading || !conversation}
                    aria-label="Send message"
                  >
                    {sending ? (
                      <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
                    ) : (
                      <i className="fas fa-paper-plane" aria-hidden="true" />
                    )}
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

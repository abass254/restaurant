"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChatCatalog } from "@/components/messages/ChatCatalog";
import { ChatOrderPayCard } from "@/components/messages/ChatOrderPayCard";
import { ChatOrderTrackCard } from "@/components/messages/ChatOrderTrackCard";
import { ChatProductCard } from "@/components/messages/ChatProductCard";
import { ChatThreadSkeleton } from "@/components/messages/ChatThreadSkeleton";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { apiFetch } from "@/lib/api";
import {
  isAgentSystemFallbackMessage,
  toDisplayMessages,
} from "@/lib/chat-messages";
import { apiRoutes } from "@/lib/config";
import {
  formatNairobiDayLabel,
  formatNairobiTime,
} from "@/lib/nairobi-time";
import type {
  BotSandboxMessageResponse,
  BotSandboxResponse,
  InstagramConversation,
  InstagramMessage,
  SandboxChip,
} from "@/lib/types";

function groupMessagesByDay(messages: InstagramMessage[]) {
  const groups: { day: string; messages: InstagramMessage[] }[] = [];
  for (const message of messages) {
    const day = formatNairobiDayLabel(message.sent_at);
    const last = groups[groups.length - 1];
    if (last?.day === day) {
      last.messages.push(message);
    } else {
      groups.push({ day, messages: [message] });
    }
  }
  return groups;
}

export type BotSandboxProps = {
  merchantId: string;
  variant?: "page" | "modal";
  chrome?: "merchant" | "admin";
  onClose?: () => void;
  seedMessage?: string | null;
  subtitle?: string;
  showGuide?: boolean;
};

export function BotSandbox({
  merchantId,
  variant = "page",
  chrome = "merchant",
  onClose,
  seedMessage = null,
  subtitle,
  showGuide = true,
}: BotSandboxProps) {
  const [clientUsername, setClientUsername] = useState("dev_client");
  const [conversation, setConversation] = useState<InstagramConversation | null>(null);
  const [availableChips, setAvailableChips] = useState<SandboxChip[]>([]);
  const [freeMessaging, setFreeMessaging] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientMessage, setClientMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seedSentRef = useRef(false);
  const lastCustomerAttemptRef = useRef<string | null>(null);

  const isModal = variant === "modal";
  const isAdmin = chrome === "admin";
  const resetBtnClass = isAdmin
    ? "admin-btn admin-btn--ghost admin-btn--sm bot-sandbox__reset"
    : "btn btn-ghost btn-sm bot-sandbox__reset";

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!merchantId) {
      return;
    }
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiFetch<BotSandboxResponse>(
        apiRoutes.adminBotSandbox(merchantId),
      );
      setClientUsername(data.client_username);
      setConversation(data.conversation);
      setFreeMessaging(
        data.free_messaging === true || data.conversation?.live_agent_handoff === true,
      );
      setAvailableChips(data.available_chips ?? []);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Could not load bot sandbox.");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    seedSentRef.current = false;
  }, [seedMessage]);

  useEffect(() => {
    if (conversation?.live_agent_handoff === true) {
      setFreeMessaging(true);
    }
  }, [conversation?.live_agent_handoff, conversation?.id]);

  useEffect(() => {
    if (isModal || isAdmin) {
      return;
    }
    function refreshIfIdle() {
      if (sending || resetting) {
        return;
      }
      void load({ silent: true });
    }
    function onFocus() {
      refreshIfIdle();
    }
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(refreshIfIdle, 8000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [load, isModal, isAdmin, sending, resetting]);

  const chips = availableChips;
  const messages = conversation?.messages ?? [];
  const showCustomerChips = chips.length > 0;
  const latestMessageId = messages.at(-1)?.id;
  const messageGroups = useMemo(() => groupMessagesByDay(messages), [messages]);
  const latestOutboundMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.direction === "outbound") {
        return message;
      }
    }
    return null;
  }, [messages]);
  const latestConnectionIssue =
    latestOutboundMessage !== null &&
    isAgentSystemFallbackMessage(latestOutboundMessage.body ?? "");
  const showConnectionBanner = Boolean(error) || latestConnectionIssue;
  const liveAgentChip = chips.find((chip) => /live agent/i.test(chip.label));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  async function sendChip(chip: SandboxChip) {
    await sendClientMessage(chip.send_text.trim(), true);
  }

  async function sendClientMessage(body: string, fromChip = false) {
    if (!body || sending) {
      return;
    }

    setSending(true);
    setError(null);
    lastCustomerAttemptRef.current = body;

    try {
      const response = await apiFetch<BotSandboxMessageResponse>(
        apiRoutes.adminBotSandboxMessage(merchantId),
        {
          method: "POST",
          body: JSON.stringify({
            text: body,
            client_username: clientUsername,
            from_chip: fromChip,
          }),
        },
      );
      setConversation(response.conversation);
      setFreeMessaging(
        response.free_messaging === true ||
          response.conversation.live_agent_handoff === true,
      );
      setAvailableChips(response.available_chips ?? []);
      if (!fromChip) {
        setClientMessage("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (
      loading ||
      sending ||
      !seedMessage?.trim() ||
      seedSentRef.current ||
      !conversation
    ) {
      return;
    }
    seedSentRef.current = true;
    void sendClientMessage(seedMessage.trim(), false);
  }, [loading, sending, conversation?.id, seedMessage]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendClientMessage(clientMessage.trim(), false);
    }
  }

  async function handleReset() {
    if (resetting) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      await apiFetch(apiRoutes.adminBotSandboxReset(merchantId), { method: "POST" });
      setConversation((prev) => (prev ? { ...prev, messages: [] } : prev));
      setFreeMessaging(true);
      setAvailableChips([]);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset sandbox.");
    } finally {
      setResetting(false);
    }
  }

  function handleRetryLastMessage() {
    const body = lastCustomerAttemptRef.current?.trim();
    if (!body || sending || resetting) {
      return;
    }
    void sendClientMessage(body, false);
  }

  function renderConnectionBanner(className?: string) {
    if (!showConnectionBanner) {
      return null;
    }
    const retryBtnClass = isAdmin
      ? "admin-btn admin-btn--ghost admin-btn--sm bot-sandbox__status-retry"
      : "btn btn-ghost btn-sm bot-sandbox__status-retry";
    return (
      <div
        className={`bot-sandbox__status-banner${className ? ` ${className}` : ""}`}
        role="status"
      >
        <div className="bot-sandbox__status-banner-copy">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          <p>
            {error ??
              "TransChap could not reach the AI service. Your message was saved — try again in a moment."}
          </p>
        </div>
        <div className="bot-sandbox__status-banner-actions">
          {lastCustomerAttemptRef.current ? (
            <button
              type="button"
              className={retryBtnClass}
              onClick={() => handleRetryLastMessage()}
              disabled={sending || resetting}
            >
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
              Try again
            </button>
          ) : null}
          {liveAgentChip ? (
            <button
              type="button"
              className={retryBtnClass}
              onClick={() => void sendChip(liveAgentChip)}
              disabled={sending || resetting}
            >
              Live agent
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderChips(className?: string) {
    return (
      <div className={`bot-sandbox__quick${className ? ` ${className}` : ""}`}>
        {chips.map((chip) => (
          <button
            key={`${chip.label}-${chip.send_text}`}
            type="button"
            className="bot-sandbox__chip"
            disabled={sending || resetting}
            onClick={() => void sendChip(chip)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`chat-app chat-app--bot-sandbox${isModal ? " chat-app--bot-sandbox-modal" : ""}${isAdmin ? " chat-app--bot-sandbox-admin" : ""}`}
    >
      <div
        className={`chat-main chat-main--bot-sandbox${isModal ? " chat-main--bot-sandbox-modal" : ""}`}
      >
        <header className="chat-thread-header bot-sandbox__header">
          <div className="chat-thread-header__info">
            <strong>{isModal ? "Customer chat preview" : isAdmin ? "Live preview" : "AI agent preview"}</strong>
            <span>
              {subtitle ??
                (freeMessaging
                  ? "Type freely or use shortcuts — powered by Gemini when configured"
                  : "Preview how customers experience your AI sales agent on Instagram")}
            </span>
          </div>
          <div className="bot-sandbox__actions">
            {!isModal && !isAdmin ? (
              <label className="bot-sandbox__username">
                <span className="bot-sandbox__username-label">Client @</span>
                <input
                  type="text"
                  value={clientUsername}
                  onChange={(event) => setClientUsername(event.target.value)}
                  placeholder="dev_client"
                  maxLength={64}
                  disabled={sending || resetting}
                />
              </label>
            ) : null}
            <button
              type="button"
              className={resetBtnClass}
              onClick={() => void handleReset()}
              disabled={resetting || sending}
            >
              <i className="fa-solid fa-rotate-left" aria-hidden="true" />
              {resetting ? "Resetting…" : "Reset chat"}
            </button>
            {isModal && onClose ? (
              <button
                type="button"
                className={isAdmin ? "admin-btn admin-btn--ghost admin-btn--sm" : "btn btn-ghost btn-sm"}
                onClick={onClose}
                aria-label="Close preview"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </header>

        {!isModal && showGuide ? (
          <aside className="bot-sandbox__tips" aria-label="AI agent preview tips">
            <p className="bot-sandbox__tips-lead">
              Preview your AI sales agent here. Replies go live on Instagram when{" "}
              <strong>Auto-replies</strong> is enabled in Settings or your inbox.
            </p>
            <p className="bot-sandbox__tips-meta">
              The agent greets first, then handles free-text questions about products, orders, and payments.
            </p>
            <p className="bot-sandbox__links">
              Tune copy in{" "}
              <Link href="/tools/starters">Starters</Link>,{" "}
              <Link href="/tools/auto-reply">Auto-reply</Link>, and{" "}
              <Link href="/settings#section-auto-replies">Settings → Auto-replies</Link>.
            </p>
            {showCustomerChips ? renderChips() : null}
          </aside>
        ) : null}

        <div className="chat-messages bot-sandbox__messages" role="log" aria-live="polite">
          {loading && !isAdmin ? (
            <ChatThreadSkeleton />
          ) : messageGroups.length === 0 ? (
            <div className="bot-sandbox__empty">
              <p>No messages yet. Send the first message as the customer.</p>
            </div>
          ) : (
            messageGroups.map((group) => (
              <div key={group.day} className="chat-message-group">
                <div className="chat-day-divider flex text-center items-center justify-center">
                  {group.day}
                </div>
                {toDisplayMessages(group.messages).map((item) => {
                  const isOut = item.message.direction === "outbound";
                  const isSystemFallback =
                    isOut &&
                    item.kind === "text" &&
                    isAgentSystemFallbackMessage(item.body);
                  const showInlineChips =
                    showCustomerChips &&
                    isOut &&
                    !isSystemFallback &&
                    item.message.id === latestMessageId;
                  const bubbleClass =
                    item.kind === "product_card" || item.kind === "order_track" || item.kind === "order_pay"
                      ? " chat-bubble--card"
                      : item.kind === "product_catalog"
                        ? " chat-bubble--catalog"
                        : "";

                  if (isSystemFallback) {
                    return (
                      <div
                        key={item.message.id}
                        className="chat-system-notice"
                        role="status"
                      >
                        <div className="chat-system-notice__body">
                          <i className="fa-solid fa-plug-circle-xmark" aria-hidden="true" />
                          <p>{item.body}</p>
                        </div>
                        {item.message.sent_at ? (
                          <time
                            className="chat-system-notice__time"
                            dateTime={item.message.sent_at}
                          >
                            {formatNairobiTime(item.message.sent_at)}
                          </time>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.message.id}
                      className={`chat-bubble-row ${isOut ? "chat-bubble-row--out" : "chat-bubble-row--in"}`}
                    >
                      <div className={`chat-bubble pt-2${bubbleClass}`}>
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
                          {isOut ? (
                            <span className="chat-bubble__sender">TransChap</span>
                          ) : (
                            <span className="chat-bubble__sender">You (client)</span>
                          )}
                          {item.message.sent_at ? (
                            <time dateTime={item.message.sent_at}>
                              {formatNairobiTime(item.message.sent_at)}
                            </time>
                          ) : null}
                        </div>
                      </div>
                      {showInlineChips ? renderChips("bot-sandbox__quick--inline") : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {sending ? <TypingIndicator aligned="out" label="TransChap is typing" /> : null}
          <div ref={messagesEndRef} />
        </div>

        {renderConnectionBanner("bot-sandbox__status-banner--composer")}

        {freeMessaging ? (
          <form
            className="chat-composer bot-sandbox__composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendClientMessage(clientMessage.trim(), false);
            }}
          >
            {error && !showConnectionBanner ? (
              <p className="chat-composer__error bot-sandbox__error">{error}</p>
            ) : null}
            {showCustomerChips ? (
              <div className="bot-sandbox__chip-bar" aria-label="Shortcut replies">
                <p className="bot-sandbox__chip-bar-label">Shortcuts</p>
                {renderChips("bot-sandbox__quick--bar")}
              </div>
            ) : null}
            {!isAdmin ? (
              <p className="bot-sandbox__chip-bar-label">Type as the customer</p>
            ) : null}
            <div className="chat-composer__form">
              <textarea
                className="chat-composer__input"
                value={clientMessage}
                onChange={(event) => setClientMessage(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Message the shop…"
                rows={1}
                aria-label="Customer message"
                disabled={sending || resetting}
              />
              <button
                type="submit"
                className="chat-composer__send"
                disabled={sending || resetting || !clientMessage.trim()}
                aria-label="Send message"
              >
                {sending ? (
                  <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
                ) : (
                  <i className="fas fa-paper-plane" aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="bot-sandbox__chip-bar" aria-label="Customer chip replies">
            {error && !showConnectionBanner ? (
              <p className="chat-composer__error bot-sandbox__error">{error}</p>
            ) : null}
            <p className="bot-sandbox__chip-bar-label">Tap to reply</p>
            {renderChips("bot-sandbox__quick--bar")}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import type { BotTrainingChatResponse, BotTrainingMessage } from "@/lib/types";

const STARTER_MESSAGE: BotTrainingMessage = {
  role: "assistant",
  content:
    "Hi — I'm your training coach. Tell me how DukAI should talk to your customers: " +
    "tone, language, greetings, products to push, or phrases to avoid. I'll save " +
    "instructions as we go. Switch to the Chat tab anytime to test as a customer.",
};

type BotTrainingChatProps = {
  merchantId: string;
  merchantName?: string;
};

export function BotTrainingChat({ merchantId, merchantName }: BotTrainingChatProps) {
  const [messages, setMessages] = useState<BotTrainingMessage[]>([]);
  const [currentInstructions, setCurrentInstructions] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<BotTrainingChatResponse>(
        apiRoutes.adminBotTrainingChat(merchantId),
      );
      setMessages(data.messages.length > 0 ? data.messages : [STARTER_MESSAGE]);
      setCurrentInstructions(data.current_instructions ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load training chat.");
      setMessages([STARTER_MESSAGE]);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) {
      return;
    }

    setSending(true);
    setError(null);
    setDraft("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const data = await apiFetch<BotTrainingChatResponse>(
        apiRoutes.adminBotTrainingChat(merchantId),
        {
          method: "POST",
          body: JSON.stringify({ text }),
        },
      );
      setMessages(data.messages);
      setCurrentInstructions(data.current_instructions ?? "");
    } catch (err) {
      setMessages((prev) => prev.slice(0, -1));
      setDraft(text);
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  async function clearChat() {
    if (resetting) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      await apiFetch(apiRoutes.adminBotTrainingChatReset(merchantId), {
        method: "POST",
      });
      setMessages([STARTER_MESSAGE]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear training chat.");
    } finally {
      setResetting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (loading) {
    return (
      <div className="admin-bot-train admin-bot-train--loading" aria-busy="true">
        <p>Loading training coach…</p>
      </div>
    );
  }

  return (
    <div className="admin-bot-train admin-bot-train--chat">
      <header className="admin-bot-train__head">
        <div>
          <h2 className="admin-bot-train__title">Train with chat</h2>
          <p className="admin-bot-train__lead">
            Chat with the training coach
            {merchantName ? ` for ${merchantName}` : ""}. Your guidance is saved automatically
            and applies to the customer Chat preview and live Instagram DMs.
          </p>
        </div>
        <div className="admin-bot-train__head-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => setShowInstructions((open) => !open)}
          >
            <i className="fa-solid fa-list-check" aria-hidden="true" />
            {showInstructions ? "Hide" : "View"} saved instructions
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => void clearChat()}
            disabled={resetting || sending}
          >
            <i className="fa-solid fa-rotate-left" aria-hidden="true" />
            {resetting ? "Clearing…" : "Clear chat"}
          </button>
        </div>
      </header>

      {showInstructions ? (
        <div className="admin-bot-train__instructions-panel">
          <p className="admin-bot-train__instructions-label">Saved instructions</p>
          <pre className="admin-bot-train__instructions-body">
            {currentInstructions.trim() || "No instructions saved yet."}
          </pre>
        </div>
      ) : null}

      {error ? (
        <p className="admin-bot-train__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin-bot-train__chat">
        <div className="admin-bot-train__messages" role="log" aria-live="polite">
          {messages.map((message, index) => {
            const isCoach = message.role === "assistant";
            return (
              <div
                key={`${message.role}-${index}`}
                className={`admin-bot-train__bubble-row${
                  isCoach ? " admin-bot-train__bubble-row--coach" : " admin-bot-train__bubble-row--you"
                }`}
              >
                <div className="admin-bot-train__bubble">
                  <p>{message.content}</p>
                  <span className="admin-bot-train__bubble-meta">
                    {isCoach ? "Training coach" : "You"}
                  </span>
                </div>
              </div>
            );
          })}
          {sending ? <TypingIndicator aligned="out" label="Coach is thinking" /> : null}
          <div ref={messagesEndRef} />
        </div>

        <form className="admin-bot-train__composer" onSubmit={(e) => void sendMessage(e)}>
          <textarea
            className="admin-input admin-bot-train__composer-input"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='e.g. "Greet in Swahili when they say habari" or "Always mention free delivery in Nairobi"'
            disabled={sending}
          />
          <button
            type="submit"
            className="admin-btn admin-btn--primary admin-bot-train__send"
            disabled={sending || !draft.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

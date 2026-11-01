"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { BotSandbox } from "@/components/bot/BotSandbox";
import { BotTrainingChat } from "@/components/bot/BotTrainingChat";
import type { AdminMerchantsResponse } from "@/lib/types";

type WorkspaceTab = "chat" | "train";

export function AdminBotTestView() {
  const [merchants, setMerchants] = useState<AdminMerchantsResponse["data"]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("chat");

  useEffect(() => {
    let cancelled = false;
    void apiFetch<AdminMerchantsResponse>(apiRoutes.adminMerchants)
      .then((res) => {
        if (cancelled) return;
        setMerchants(res.data);
        if (res.data.length > 0) {
          setMerchantId(res.data[0].id);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMerchants(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = merchants.find((m) => m.id === merchantId);

  return (
    <div className="admin-bot-test">
      <aside className="admin-bot-test__sidebar" aria-label="Bot test controls">
        <div className="admin-bot-test__sidebar-inner">
          <span className="admin-chip admin-bot-test__chip">
            <i className="fa-solid fa-flask" aria-hidden="true" />
            Bot preview
          </span>

          <h1 className="admin-bot-test__title">Test customer chat</h1>
          <p className="admin-bot-test__lead">
            Choose a merchant shop and send messages as their customer. Nothing
            here reaches real Instagram DMs.
          </p>

          <label className="admin-bot-test__field">
            <span className="admin-bot-test__field-label">Merchant shop</span>
            <select
              className="admin-input admin-bot-test__select"
              value={merchantId}
              disabled={loadingMerchants || merchants.length === 0}
              onChange={(e) => setMerchantId(e.target.value)}
            >
              {merchants.length === 0 ? (
                <option value="">No merchants yet</option>
              ) : (
                merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.business_name}
                  </option>
                ))
              )}
            </select>
          </label>

          {selected ? (
            <div className="admin-bot-test__context">
              <strong>{selected.business_name}</strong>
              <span>{selected.business_location}</span>
              <span className="admin-bot-test__context-meta">
                {selected.users_count} user{selected.users_count === 1 ? "" : "s"}
                {selected.instagram_connected ? " · Instagram connected" : ""}
              </span>
            </div>
          ) : null}

          <ol className="admin-bot-test__steps">
            <li>Type a message as the customer to start the thread.</li>
            <li>Ask about products, prices, or placing an order.</li>
            <li>
              Use <strong>Train</strong> to chat with the coach and shape how TransChap replies.
            </li>
            <li>Hit <strong>Reset chat</strong> to clear the preview and start over.</li>
          </ol>

          <nav className="admin-bot-test__links" aria-label="Related admin pages">
            <Link href="/admin/settings#section-ai-agent" className="admin-bot-test__link">
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
              AI agent settings
            </Link>
            <Link href="/admin/merchants" className="admin-bot-test__link">
              <i className="fa-solid fa-store" aria-hidden="true" />
              All merchants
            </Link>
          </nav>
        </div>
      </aside>

      <section className="admin-bot-test__workspace" aria-label="Bot workspace">
        <div className="admin-bot-test__tabs" role="tablist" aria-label="Bot test views">
          <button
            type="button"
            role="tab"
            id="admin-bot-tab-chat"
            aria-selected={workspaceTab === "chat"}
            aria-controls="admin-bot-panel-chat"
            className={`admin-bot-test__tab${workspaceTab === "chat" ? " is-active" : ""}`}
            onClick={() => setWorkspaceTab("chat")}
          >
            <i className="fa-solid fa-comments" aria-hidden="true" />
            Chat
          </button>
          <button
            type="button"
            role="tab"
            id="admin-bot-tab-train"
            aria-selected={workspaceTab === "train"}
            aria-controls="admin-bot-panel-train"
            className={`admin-bot-test__tab${workspaceTab === "train" ? " is-active" : ""}`}
            onClick={() => setWorkspaceTab("train")}
          >
            <i className="fa-solid fa-graduation-cap" aria-hidden="true" />
            Train
          </button>
        </div>

        {merchantId ? (
          workspaceTab === "chat" ? (
            <div
              role="tabpanel"
              id="admin-bot-panel-chat"
              aria-labelledby="admin-bot-tab-chat"
              className="admin-bot-test__panel"
            >
              <BotSandbox
                key={merchantId}
                merchantId={merchantId}
                variant="page"
                chrome="admin"
                showGuide={false}
                subtitle={
                  selected
                    ? `Acting as a customer of ${selected.business_name}`
                    : undefined
                }
              />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="admin-bot-panel-train"
              aria-labelledby="admin-bot-tab-train"
              className="admin-bot-test__panel"
            >
              <BotTrainingChat
                key={merchantId}
                merchantId={merchantId}
                merchantName={selected?.business_name}
              />
            </div>
          )
        ) : (
          <div className="admin-bot-test__empty">
            <i className="fa-solid fa-store-slash" aria-hidden="true" />
            <p>
              {loadingMerchants
                ? "Loading merchants…"
                : "Add a merchant before testing the bot."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

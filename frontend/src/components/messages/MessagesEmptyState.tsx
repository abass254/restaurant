"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { apiRoutes, resolveSameOriginUrl } from "@/lib/config";
import type { Channel, ChannelsResponse } from "@/lib/types";

const FALLBACK_CHANNELS: Channel[] = [
  {
    platform: "instagram",
    label: "Instagram",
    tagline: "DMs, comments, and story replies via Meta.",
    icon: "fa-brands fa-instagram",
    color: "#dd2a7b",
    supports_oauth: true,
    supports_messaging: true,
    status_text: "Live messaging available.",
    connect_url: "/auth/instagram",
    connected: false,
    account: null,
  },
  {
    platform: "facebook",
    label: "Facebook",
    tagline: "Page inbox & Messenger conversations.",
    icon: "fa-brands fa-facebook",
    color: "#1877f2",
    supports_oauth: false,
    supports_messaging: false,
    status_text: "Manual link only — live messaging coming soon.",
    connect_url: null,
    connected: false,
    account: null,
  },
  {
    platform: "whatsapp",
    label: "WhatsApp",
    tagline: "Business chats via Cloud API.",
    icon: "fa-brands fa-whatsapp",
    color: "#25d366",
    supports_oauth: false,
    supports_messaging: false,
    status_text: "Manual link only — live messaging coming soon.",
    connect_url: null,
    connected: false,
    account: null,
  },
  {
    platform: "tiktok",
    label: "TikTok",
    tagline: "Business DMs & comments.",
    icon: "fa-brands fa-tiktok",
    color: "#010101",
    supports_oauth: false,
    supports_messaging: false,
    status_text: "Manual link only — live messaging coming soon.",
    connect_url: null,
    connected: false,
    account: null,
  },
];

export function MessagesEmptyState() {
  const [channels, setChannels] = useState<Channel[]>(FALLBACK_CHANNELS);
  const [canManage, setCanManage] = useState<boolean>(false);

  useEffect(() => {
    void apiFetch<ChannelsResponse>(apiRoutes.channels)
      .then((data) => {
        setChannels(data.channels);
        setCanManage(data.can_manage);
      })
      .catch(() => {
        /* keep fallback */
      });
  }, []);

  return (
    <div className="messages-empty">
      <div className="messages-empty__card">
        <div className="messages-empty__icon" aria-hidden="true">
          <i className="fa-solid fa-comments" />
        </div>
        <h1>Let's get your inbox ready</h1>
        <p className="messages-empty__lead">
          You don't have any messaging channels connected yet. Pick a platform
          below and we'll guide you through linking it. Once a channel is
          connected, all incoming conversations will land right here.
        </p>

        <ol className="messages-empty__steps">
          <li>
            <span className="messages-empty__step-num">1</span>
            <span>Choose the social platform you want to manage.</span>
          </li>
          <li>
            <span className="messages-empty__step-num">2</span>
            <span>Connect with OAuth (Instagram) or save your handle.</span>
          </li>
          <li>
            <span className="messages-empty__step-num">3</span>
            <span>Reload this page and start chatting with customers.</span>
          </li>
        </ol>

        <div className="messages-empty__channels">
          {channels.map((channel) => (
            <ChannelTile key={channel.platform} channel={channel} canManage={canManage} />
          ))}
        </div>

        <p className="messages-empty__footer">
          <Link href="/settings#section-channels" className="btn btn-primary btn-sm">
            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            Manage all channels in Settings
          </Link>
        </p>

        {!canManage ? (
          <p className="messages-empty__note">
            <i className="fa-solid fa-circle-info" aria-hidden="true" /> Only platform
            admins can connect channels. Ask one to set it up for you.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChannelTile({
  channel,
  canManage,
}: {
  channel: Channel;
  canManage: boolean;
}) {
  const isInstagramOAuth = channel.supports_oauth && channel.connect_url;

  return (
    <div className="messages-empty__tile" data-platform={channel.platform}>
      <div
        className="messages-empty__tile-logo"
        style={{ background: channel.color }}
        aria-hidden="true"
      >
        <i className={channel.icon} />
      </div>
      <div className="messages-empty__tile-body">
        <h3>{channel.label}</h3>
        <p>{channel.tagline}</p>
        <span
          className={`settings-pill ${channel.supports_messaging
              ? "settings-pill--ok"
              : "settings-pill--warn"
            }`}
        >
          {channel.supports_messaging ? "Messaging ready" : "Coming soon"}
        </span>
      </div>
      <div className="messages-empty__tile-action">
        {isInstagramOAuth ? (
          <a
            href={resolveSameOriginUrl(channel.connect_url)}
            className="btn btn-primary btn-sm"
          >
            Connect
          </a>
        ) : (
          <Link
            href={`/settings#section-channels`}
            className={`btn ${canManage ? "btn-ghost" : "btn-ghost"} btn-sm`}
          >
            {canManage ? "Link" : "View"}
          </Link>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { CHANNELS, type ChannelKey } from "@/lib/channels";

type ChannelSetupGuideProps = {
  title?: string;
  subtitle?: string;
  contextLabel?: string;
  /** Channels that are already connected (will be marked as such). */
  connectedKeys?: ChannelKey[];
  /** Where to send the user to actually set up a channel. */
  ctaHref?: string;
  ctaLabel?: string;
  compact?: boolean;
};

export function ChannelSetupGuide({
  title = "Connect your first channel",
  subtitle = "Pick a messaging app to start receiving customer conversations in one inbox.",
  contextLabel,
  connectedKeys = [],
  ctaHref = "/settings#section-channels",
  ctaLabel = "Open Settings",
  compact = false,
}: ChannelSetupGuideProps) {
  return (
    <section className={`channel-guide${compact ? " channel-guide--compact" : ""}`}>
      <div className="channel-guide__intro">
        {contextLabel ? <span className="channel-guide__eyebrow">{contextLabel}</span> : null}
        <h2 className="channel-guide__title">{title}</h2>
        <p className="channel-guide__subtitle">{subtitle}</p>
        <Link href={ctaHref} className="btn btn-primary channel-guide__cta">
          <i className="fa-solid fa-plug" aria-hidden="true" />
          {ctaLabel}
        </Link>
      </div>

      <ul className="channel-guide__grid">
        {CHANNELS.map((channel) => {
          const isConnected = connectedKeys.includes(channel.key);
          const status: "connected" | "available" | "coming_soon" = isConnected
            ? "connected"
            : channel.status;

          return (
            <li
              key={channel.key}
              className={`channel-tile channel-tile--${status}`}
              style={{ ["--channel-color" as string]: channel.brandColor }}
            >
              <span
                className="channel-tile__icon"
                style={{ background: channel.brandGradient }}
                aria-hidden="true"
              >
                <i className={channel.icon} />
              </span>
              <div className="channel-tile__body">
                <div className="channel-tile__head">
                  <strong>{channel.name}</strong>
                  <span className={`channel-tile__pill channel-tile__pill--${status}`}>
                    {status === "connected"
                      ? "Connected"
                      : status === "available"
                        ? "Ready"
                        : "Coming soon"}
                  </span>
                </div>
                <span className="channel-tile__tagline">{channel.tagline}</span>
                <p className="channel-tile__desc">{channel.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

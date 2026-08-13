/**
 * Messaging channels supported by the platform.
 *
 * Today only Instagram is fully wired into the backend. Facebook, WhatsApp and
 * TikTok are surfaced in the UI as "Coming soon" so merchants can see the
 * roadmap and request early access. Adding real connectivity later only
 * requires flipping `status: "available"` and providing the OAuth URLs.
 */
export type ChannelStatus = "available" | "coming_soon";

export type ChannelKey = "instagram" | "facebook" | "whatsapp" | "tiktok";

export type ChannelDefinition = {
  key: ChannelKey;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  brandColor: string;
  brandGradient: string;
  status: ChannelStatus;
  docsUrl?: string;
};

export const CHANNELS: readonly ChannelDefinition[] = [
  {
    key: "instagram",
    name: "Instagram",
    tagline: "DMs · Story replies · Comments",
    description:
      "Connect a Business or Creator Instagram account through Meta to receive DMs and reply right from the inbox.",
    icon: "fa-brands fa-instagram",
    brandColor: "#dd2a7b",
    brandGradient: "linear-gradient(135deg, #f58529, #dd2a7b, #8134af)",
    status: "available",
    docsUrl:
      "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login",
  },
  {
    key: "facebook",
    name: "Facebook",
    tagline: "Page messages · Comments",
    description:
      "Connect a Facebook Page so visitor messages and post comments land in your unified inbox.",
    icon: "fa-brands fa-facebook",
    brandColor: "#1877f2",
    brandGradient: "linear-gradient(135deg, #1877f2, #0a4ec6)",
    status: "coming_soon",
    docsUrl: "https://developers.facebook.com/docs/messenger-platform",
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    tagline: "Business API · Template replies",
    description:
      "Send and receive WhatsApp Business messages from the same inbox, with template support for outbound notifications.",
    icon: "fa-brands fa-whatsapp",
    brandColor: "#25d366",
    brandGradient: "linear-gradient(135deg, #25d366, #128c7e)",
    status: "coming_soon",
    docsUrl: "https://developers.facebook.com/docs/whatsapp",
  },
  {
    key: "tiktok",
    name: "TikTok",
    tagline: "DMs · Shop messages",
    description:
      "Reply to TikTok DMs and TikTok Shop questions from one inbox once approved for the TikTok Business API.",
    icon: "fa-brands fa-tiktok",
    brandColor: "#000000",
    brandGradient: "linear-gradient(135deg, #25f4ee, #000000, #fe2c55)",
    status: "coming_soon",
    docsUrl: "https://developers.tiktok.com/",
  },
] as const;

export function getChannel(key: ChannelKey): ChannelDefinition {
  const channel = CHANNELS.find((c) => c.key === key);
  if (!channel) {
    throw new Error(`Unknown channel: ${key}`);
  }
  return channel;
}

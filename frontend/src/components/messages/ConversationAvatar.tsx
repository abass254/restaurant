"use client";

import { useState } from "react";

type ConversationAvatarProps = {
  name: string;
  photoUrl?: string | null;
  className?: string;
  compact?: boolean;
};

export function ConversationAvatar({
  name,
  photoUrl,
  className = "",
  compact = false,
}: ConversationAvatarProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const letter = (name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();
  const showPhoto = Boolean(photoUrl) && !photoFailed;

  return (
    <span
      className={[
        "chat-avatar",
        compact ? "chat-avatar--compact" : "",
        showPhoto ? "chat-avatar--photo" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {showPhoto ? (
        // Instagram profile_pic URLs are temporary CDN links from Meta.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl ?? ""}
          alt=""
          className="chat-avatar__img"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <span className="chat-avatar__letter">{letter}</span>
      )}
    </span>
  );
}

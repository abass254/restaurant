"use client";

import { FeedsNewPostFlow } from "@/components/app/FeedsNewPostFlow";
import { TransChapSocial } from "@/components/trans-chap/TransChapSocial";

export default function TransChapNewPostPage() {
  return (
    <TransChapSocial>
      <FeedsNewPostFlow
        feedsHref="/trans-chap/feeds"
        settingsHref="/trans-chap/settings"
      />
    </TransChapSocial>
  );
}

"use client";

import { TransChapFeedsProfile } from "@/components/trans-chap/TransChapFeedsProfile";
import { TransChapSocial } from "@/components/trans-chap/TransChapSocial";

export default function TransChapFeedsPage() {
  return (
    <TransChapSocial>
      <TransChapFeedsProfile />
    </TransChapSocial>
  );
}
